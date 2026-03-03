/**
 * Pure-logic helpers extracted from degenExecutor for testability.
 * No network/filesystem/process dependencies.
 */
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { DEGEN_POOL } from "./generated/degenPool.js";

// ─── Low-level helpers ────────────────────────────────────

export function encodeU32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

export function decodeU32LE(value: Uint8Array): number {
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true);
}

export async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const payload = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    payload.set(part, offset);
    offset += part.length;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  return new Uint8Array(digest);
}

// ─── Candidate derivation ─────────────────────────────────

export async function deriveCandidates(
  randomness: Uint8Array,
  poolVersion: number,
  count: number,
  pool?: readonly string[],
): Promise<Array<{ rank: number; index: number; mint: string }>> {
  const effectivePool = pool ?? DEGEN_POOL;
  const limit = Math.min(count, effectivePool.length);
  const used = new Set<number>();
  const out: Array<{ rank: number; index: number; mint: string }> = [];

  for (let rank = 0; rank < limit; rank += 1) {
    let nonce = 0;
    while (true) {
      const digest = await sha256([
        randomness,
        encodeU32LE(poolVersion),
        encodeU32LE(rank),
        encodeU32LE(nonce),
      ]);
      const index = decodeU32LE(digest.subarray(0, 4)) % effectivePool.length;
      if (!used.has(index)) {
        used.add(index);
        out.push({ rank, index, mint: effectivePool[index] });
        break;
      }
      nonce += 1;
    }
  }

  return out;
}

// ─── Environment parsing ──────────────────────────────────

export function parseMaxAccountsSequence(raw: string | undefined): number[] {
  const values = (raw || "64,48,36,28,22")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  return [...new Set(values)];
}

export function parseSlippageSequence(raw: string | undefined): number[] {
  return (raw || "300,400,500,600")
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

// ─── Error classification ─────────────────────────────────

export function isTxTooLargeError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    message.includes("encoding overruns Uint8Array") ||
    message.includes("Transaction too large") ||
    message.includes("VersionedTransaction too large") ||
    message.includes("too large:")
  );
}

export function isSlippageError(msg: string): boolean {
  return (
    msg.includes("6046") ||
    msg.includes("DegenOutputNotReceived") ||
    msg.includes("SlippageToleranceExceeded")
  );
}

// ─── Round meta parsing ───────────────────────────────────

const DISC = 8;
const ROUND_STATUS_OFFSET = DISC + 8;
const ROUND_TOTAL_USDC_OFFSET = DISC + 72;
const ROUND_DEGEN_STATUS_OFFSET = DISC + 8209;

export function parseRoundMeta(data: Buffer): {
  status: number;
  totalUsdc: bigint;
  degenModeStatus: number;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    status: data[ROUND_STATUS_OFFSET],
    totalUsdc: view.getBigUint64(ROUND_TOTAL_USDC_OFFSET, true),
    degenModeStatus: data[ROUND_DEGEN_STATUS_OFFSET],
  };
}

// ─── Round VRF payer parsing ──────────────────────────────

const ROUND_VRF_PAYER_OFFSET = DISC + 8176;
const ROUND_VRF_REIMBURSED_OFFSET = DISC + 8208;

/**
 * Returns the vrfPayer pubkey if the round has a non-zero vrf_payer AND
 * vrf_reimbursed == 0 (meaning reimbursement hasn't happened yet).
 * Returns null otherwise.
 */
export function parseRoundVrfPayer(data: Buffer): PublicKey | null {
  const vrfPayer = new PublicKey(data.subarray(ROUND_VRF_PAYER_OFFSET, ROUND_VRF_PAYER_OFFSET + 32));
  if (vrfPayer.equals(PublicKey.default)) return null;
  const reimbursed = data[ROUND_VRF_REIMBURSED_OFFSET];
  if (reimbursed !== 0) return null;
  return vrfPayer;
}

// ─── Config fee_bps parsing ───────────────────────────────

const CONFIG_FEE_BPS_OFFSET = DISC + 96; // admin(32) + usdc_mint(32) + treasury_usdc_ata(32) = 96

export function parseConfigFeeBps(data: Buffer): number {
  return data.readUInt16LE(CONFIG_FEE_BPS_OFFSET);
}

/**
 * Compute the payout that begin_degen_execution will transfer from vault → executor ATA.
 * When the round has a vrf_payer that hasn't been reimbursed yet, the handler deducts
 * a fixed VRF_REIMBURSE amount (200_000 USDC lamports = 0.2 USDC) before computing payout.
 */
const VRF_REIMBURSE_AMOUNT = 200_000n; // matching on-chain VRF_REIMBURSEMENT_USDC

export function computeBeginDegenPayout(
  totalUsdc: bigint,
  feeBps: number,
  reimburseVrf: boolean = false,
): bigint {
  const vrfDeduct = reimburseVrf ? VRF_REIMBURSE_AMOUNT : 0n;
  const pool = totalUsdc - vrfDeduct;
  const fee = (pool * BigInt(feeBps)) / 10_000n;
  return pool - fee;
}

// ─── Route hash ───────────────────────────────────────────

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  routePlan: Array<unknown>;
}

export function routeHashFromQuote(quote: JupiterQuote): number[] {
  return Array.from(createHash("sha256").update(JSON.stringify(quote.routePlan)).digest());
}
