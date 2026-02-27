import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createActionHeaders, createPostResponse } from "@solana/actions";
import { parseParticipant, parseRound } from "../../crank/src/parser.ts";
import IDL from "../../src/idl/jackpot.json" with { type: "json" };

const DEFAULT_RPC: string = (() => {
  const rpc = process.env.ACTIONS_RPC_URL || process.env.SOLANA_RPC_UPSTREAM;
  if (!rpc) throw new Error("ACTIONS_RPC_URL or SOLANA_RPC_UPSTREAM env var is required");
  return rpc;
})();

function inferActionsNetwork(rpc: string): "mainnet" | "devnet" {
  if (process.env.NETWORK === "mainnet" || process.env.NETWORK === "devnet") {
    return process.env.NETWORK;
  }
  const lower = rpc.toLowerCase();
  if (lower.includes("devnet")) return "devnet";
  return "mainnet";
}

const ACTIONS_NETWORK = inferActionsNetwork(DEFAULT_RPC);
// Keep process.env.NETWORK aligned for any downstream imports that still read it.
if (!process.env.NETWORK) process.env.NETWORK = ACTIONS_NETWORK;
const CURRENT_ROUND_CACHE_TTL_MS = 5_000;
const ROUND_SCAN_BATCH = 20;
const ROUND_SCAN_MAX = 200;
const ROUND_SCAN_NULL_STREAK_LIMIT = 20;
const ELIGIBILITY_LOOKBACK_ROUNDS = 300;

let currentRoundCache: {
  tsMs: number;
  activeRoundId?: number;
  joinableRoundId?: number;
} = { tsMs: 0 };

const NETWORK_CONFIG = {
  devnet: {
    programId: "4PhNzNQ7XZAPrFmwcBFMe2ZY8ZaQWos8nJjcsjv1CHyh",
    usdcMint: "GXJV8YiRpXpbUHdf3q6n4hEKNeBPXK9Kn9uGjm6gZksq",
    treasuryUsdcAta: "HukbjaCBAJz5VmzkiDcpNjF2BUsxo8z9WwgSzHgGACMd",
  },
  mainnet: {
    programId: process.env.PROGRAM_ID || "3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    treasuryUsdcAta: process.env.TREASURY_ATA || "8dccLsxnj9jwfEeokJrQH2wioJz4sS3mEQGd3miWB5YE",
  },
} as const;

const ACTIVE_CFG = NETWORK_CONFIG[ACTIONS_NETWORK];
export const PROGRAM_ID = new PublicKey(ACTIVE_CFG.programId);
export const USDC_MINT = new PublicKey(ACTIVE_CFG.usdcMint);
export const TREASURY_USDC_ATA = new PublicKey(ACTIVE_CFG.treasuryUsdcAta);

export const RoundStatus = {
  Open: 0,
  Locked: 1,
  VrfRequested: 2,
  Settled: 3,
  Claimed: 4,
  Cancelled: 5,
} as const;

const SEED_CFG = Buffer.from("cfg");
const SEED_ROUND = Buffer.from("round");
const SEED_PARTICIPANT = Buffer.from("p");

export function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEED_CFG], PROGRAM_ID);
  return pda;
}

export function getRoundPda(roundId: number): PublicKey {
  const id = new BN(roundId);
  const [pda] = PublicKey.findProgramAddressSync([SEED_ROUND, id.toArrayLike(Buffer, "le", 8)], PROGRAM_ID);
  return pda;
}

export function getParticipantPda(round: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEED_PARTICIPANT, round.toBuffer(), user.toBuffer()], PROGRAM_ID);
  return pda;
}

export function setActionHeaders(res: any) {
  const headers = createActionHeaders({
    chainId: ACTIONS_NETWORK,
    actionVersion: "1",
    headers: {
      "x-winny-action": "1",
    },
  });
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v as string);
  res.setHeader("Cache-Control", "no-store");
}

export function maybeHandleOptions(req: any, res: any): boolean {
  if (req.method === "OPTIONS") {
    setActionHeaders(res);
    res.status(204).end();
    return true;
  }
  return false;
}

export function jsonError(res: any, status: number, code: string, message: string, details?: unknown) {
  setActionHeaders(res);
  res.status(status).json({
    error: { code, message, details: details ?? null },
  });
}

export function getConnection() {
  return new Connection(DEFAULT_RPC, "confirmed");
}

export function getReadOnlyProgram(connection: Connection) {
  // Read-only Anchor Program instance for building instructions / decoding accounts server-side.
  const payer = Keypair.generate();
  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  };
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  const idlWithAddress = { ...IDL, address: PROGRAM_ID.toBase58() };
  return new Program(idlWithAddress as unknown as Idl, provider);
}

export function parseBody(req: any) {
  if (req.body == null) return {};
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body;
}

export function requireAccount(body: any): PublicKey {
  const raw = body?.account;
  if (!raw || typeof raw !== "string") {
    throw Object.assign(new Error("Missing body.account"), { code: "MISSING_ACCOUNT", status: 400 });
  }
  try {
    return new PublicKey(raw);
  } catch {
    throw Object.assign(new Error("Invalid account pubkey"), { code: "INVALID_ACCOUNT", status: 400 });
  }
}

export function parseOptionalAccountQuery(req: any): PublicKey | undefined {
  const raw = req.query?.account;
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw Object.assign(new Error("Invalid account query param"), {
      code: "INVALID_ACCOUNT",
      status: 400,
    });
  }
  try {
    return new PublicKey(raw);
  } catch {
    throw Object.assign(new Error("Invalid account query param"), {
      code: "INVALID_ACCOUNT",
      status: 400,
    });
  }
}

export function parseRoundId(req: any): number {
  const raw = req.query?.roundId;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw Object.assign(new Error("roundId query param is required"), {
      code: "INVALID_ROUND_ID",
      status: 400,
    });
  }
  return n;
}

export function parseOptionalRoundId(req: any): number | undefined {
  if (req.query?.roundId == null || req.query?.roundId === "") return undefined;
  return parseRoundId(req);
}

export function parseUsdcAmountRaw(req: any): bigint {
  const raw = req.query?.amount;
  if (raw == null) {
    throw Object.assign(new Error("amount query param is required"), {
      code: "INVALID_AMOUNT",
      status: 400,
    });
  }
  const s = String(raw).replace(",", ".").trim();
  const num = Number(s);
  if (!Number.isFinite(num) || num <= 0) {
    throw Object.assign(new Error("Amount must be > 0"), { code: "INVALID_AMOUNT", status: 400 });
  }
  // 6 decimals for USDC, floor to avoid over-asking relative to visible balance.
  const rawInt = BigInt(Math.floor(num * 1_000_000));
  if (rawInt <= 0n) {
    throw Object.assign(new Error("Amount too small"), { code: "INVALID_AMOUNT", status: 400 });
  }
  return rawInt;
}

export async function buildUnsignedTxBase64(params: {
  connection: Connection;
  payer: PublicKey;
  instructions: any[];
}): Promise<string> {
  const { connection, payer, instructions } = params;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  return Buffer.from(tx.serialize()).toString("base64");
}

export async function buildActionTxResponse(params: {
  connection: Connection;
  payer: PublicKey;
  instructions: any[];
  message: string;
  links?: any;
}) {
  const { connection, payer, instructions, message, links } = params;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  return createPostResponse({
    fields: {
      type: "transaction" as const,
      transaction: tx,
      message,
      ...(links ? { links } : {}),
    },
  });
}

export function actionUrl(req: any, pathname: string, qs?: Record<string, string | number>) {
  const xfProto = req.headers["x-forwarded-proto"];
  const host = req.headers.host;
  const proto =
    (typeof xfProto === "string" && xfProto) ||
    (typeof host === "string" && (host.includes("localhost") || host.includes("127.0.0.1")) ? "http" : "https");
  const origin = `${proto}://${host}`;
  const url = new URL(pathname, origin);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export function actionIconUrl(req: any) {
  return actionUrl(req, "/metadata/w_logo.svg");
}

export function isJoinableRoundStatus(status: number): boolean {
  return status === RoundStatus.Open;
}

export function isActiveRoundStatus(status: number): boolean {
  return (
    status === RoundStatus.Open ||
    status === RoundStatus.Locked ||
    status === RoundStatus.VrfRequested ||
    status === RoundStatus.Settled
  );
}

export type ParsedRoundLike = ReturnType<typeof parseRound>;
export interface ParsedConfigLike {
  admin: PublicKey;
  usdcMint: PublicKey;
  treasuryUsdcAta: PublicKey;
  feeBps: number;
  ticketUnit: bigint;
  roundDurationSec: number;
  minParticipants: number;
  minTotalTickets: bigint;
  paused: boolean;
  bump: number;
  maxDepositPerUser: bigint;
}

const CONFIG_DISC = 8;

export function parseConfig(data: Buffer): ParsedConfigLike {
  const d = data;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);

  const admin = new PublicKey(d.subarray(CONFIG_DISC + 0, CONFIG_DISC + 32));
  const usdcMint = new PublicKey(d.subarray(CONFIG_DISC + 32, CONFIG_DISC + 64));
  const treasuryUsdcAta = new PublicKey(d.subarray(CONFIG_DISC + 64, CONFIG_DISC + 96));
  const feeBps = view.getUint16(CONFIG_DISC + 96, true);
  const ticketUnit = view.getBigUint64(CONFIG_DISC + 98, true);
  const roundDurationSec = view.getUint32(CONFIG_DISC + 106, true);
  const minParticipants = view.getUint16(CONFIG_DISC + 110, true);
  const minTotalTickets = view.getBigUint64(CONFIG_DISC + 112, true);
  const paused = d[CONFIG_DISC + 120] !== 0;
  const bump = d[CONFIG_DISC + 121];
  const maxDepositPerUser = view.getBigUint64(CONFIG_DISC + 122, true);

  return {
    admin,
    usdcMint,
    treasuryUsdcAta,
    feeBps,
    ticketUnit,
    roundDurationSec,
    minParticipants,
    minTotalTickets,
    paused,
    bump,
    maxDepositPerUser,
  };
}

export async function fetchParsedConfig(connection: Connection) {
  const info = await connection.getAccountInfo(getConfigPda(), "confirmed");
  if (!info) {
    const err: any = new Error("Config not found");
    err.status = 500;
    err.code = "CONFIG_NOT_FOUND";
    throw err;
  }
  try {
    return parseConfig(Buffer.from(info.data));
  } catch {
    const err: any = new Error("Failed to parse config account");
    err.status = 500;
    err.code = "CONFIG_PARSE_ERROR";
    throw err;
  }
}

export async function fetchParsedRound(connection: Connection, roundId: number): Promise<ParsedRoundLike | null> {
  const info = await connection.getAccountInfo(getRoundPda(roundId), "confirmed");
  if (!info) return null;
  try {
    return parseRound(Buffer.from(info.data));
  } catch {
    return null;
  }
}

async function scanRoundIds(connection: Connection, mode: "active" | "joinable"): Promise<number> {
  const now = Date.now();
  if (now - currentRoundCache.tsMs < CURRENT_ROUND_CACHE_TTL_MS) {
    const cached = mode === "joinable" ? currentRoundCache.joinableRoundId : currentRoundCache.activeRoundId;
    if (cached && cached > 0) return cached;
  }

  const seedRoundId =
    mode === "joinable"
      ? currentRoundCache.joinableRoundId ?? currentRoundCache.activeRoundId ?? 1
      : currentRoundCache.activeRoundId ?? currentRoundCache.joinableRoundId ?? 1;
  const scanStart = Math.max(1, seedRoundId - 2);

  let maxExisting = 0;
  let activeRound = 0;
  let joinableRound = 0;
  let nullStreak = 0;

  for (let base = scanStart; base <= scanStart + ROUND_SCAN_MAX; base += ROUND_SCAN_BATCH) {
    const ids: number[] = [];
    for (let i = 0; i < ROUND_SCAN_BATCH; i++) ids.push(base + i);
    const infos = await connection.getMultipleAccountsInfo(ids.map((id) => getRoundPda(id)), "confirmed");

    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const id = ids[i];
      if (!info) {
        nullStreak++;
        if (maxExisting > 0 && nullStreak >= ROUND_SCAN_NULL_STREAK_LIMIT) break;
        continue;
      }

      nullStreak = 0;
      let parsed: ParsedRoundLike;
      try {
        parsed = parseRound(Buffer.from(info.data));
      } catch {
        continue;
      }

      maxExisting = id;
      if (isActiveRoundStatus(parsed.status)) activeRound = id;
      if (isJoinableRoundStatus(parsed.status)) joinableRound = id;
    }

    if (maxExisting > 0 && nullStreak >= ROUND_SCAN_NULL_STREAK_LIMIT) break;
  }

  currentRoundCache = {
    tsMs: now,
    activeRoundId: activeRound > 0 ? activeRound : Math.max(1, maxExisting),
    joinableRoundId: joinableRound > 0 ? joinableRound : undefined,
  };

  const result = mode === "joinable" ? currentRoundCache.joinableRoundId : currentRoundCache.activeRoundId;
  if (!result || result <= 0) {
    const err: any = new Error(mode === "joinable" ? "No open round found" : "No active round found");
    err.status = 404;
    err.code = mode === "joinable" ? "NO_OPEN_ROUND" : "NO_ACTIVE_ROUND";
    throw err;
  }
  return result;
}

export async function resolveRoundId(
  req: any,
  connection: Connection,
  mode: "active" | "joinable" = "active"
): Promise<{ roundId: number; source: "query" | "auto" }> {
  const queryRoundId = parseOptionalRoundId(req);
  if (queryRoundId != null) return { roundId: queryRoundId, source: "query" };
  const roundId = await scanRoundIds(connection, mode);
  return { roundId, source: "auto" };
}

async function getLatestKnownRoundId(connection: Connection): Promise<number> {
  const id = await scanRoundIds(connection, "active");
  return Math.max(1, id);
}

function descendingBatches(start: number, endInclusive: number, batchSize: number): number[][] {
  const batches: number[][] = [];
  let current = start;
  while (current >= endInclusive) {
    const ids: number[] = [];
    for (let i = 0; i < batchSize && current - i >= endInclusive; i++) {
      ids.push(current - i);
    }
    batches.push(ids);
    current -= batchSize;
  }
  return batches;
}

export async function findLatestClaimableRoundId(connection: Connection, winner: PublicKey): Promise<number> {
  const latest = await getLatestKnownRoundId(connection);
  const minRound = Math.max(1, latest - ELIGIBILITY_LOOKBACK_ROUNDS);

  for (const ids of descendingBatches(latest, minRound, ROUND_SCAN_BATCH)) {
    const infos = await connection.getMultipleAccountsInfo(ids.map((id) => getRoundPda(id)), "confirmed");
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (!info) continue;
      try {
        const round = parseRound(Buffer.from(info.data));
        if (round.status !== RoundStatus.Settled) continue;
        if (round.winner.equals(winner)) return ids[i];
      } catch {
        continue;
      }
    }
  }

  const err: any = new Error("No claimable prize found in recent rounds");
  err.status = 404;
  err.code = "NO_UNCLAIMED_PRIZE";
  throw err;
}

export async function findLatestRefundableRoundId(connection: Connection, user: PublicKey): Promise<number> {
  const latest = await getLatestKnownRoundId(connection);
  const minRound = Math.max(1, latest - ELIGIBILITY_LOOKBACK_ROUNDS);

  for (const ids of descendingBatches(latest, minRound, ROUND_SCAN_BATCH)) {
    const roundInfos = await connection.getMultipleAccountsInfo(ids.map((id) => getRoundPda(id)), "confirmed");

    const cancelledIds: number[] = [];
    for (let i = 0; i < roundInfos.length; i++) {
      const info = roundInfos[i];
      if (!info) continue;
      try {
        const round = parseRound(Buffer.from(info.data));
        if (round.status === RoundStatus.Cancelled) cancelledIds.push(ids[i]);
      } catch {
        continue;
      }
    }

    if (cancelledIds.length === 0) continue;

    const participantInfos = await connection.getMultipleAccountsInfo(
      cancelledIds.map((rid) => getParticipantPda(getRoundPda(rid), user)),
      "confirmed"
    );

    for (let i = 0; i < participantInfos.length; i++) {
      const pInfo = participantInfos[i];
      if (!pInfo) continue;
      try {
        const p = parseParticipant(Buffer.from(pInfo.data));
        if (p.user.equals(user) && p.usdcTotal > 0n) return cancelledIds[i];
      } catch {
        continue;
      }
    }
  }

  const err: any = new Error("No refundable cancelled round found in recent rounds");
  err.status = 404;
  err.code = "NO_REFUND_AVAILABLE";
  throw err;
}

export function formatUsdcRaw(raw: bigint) {
  return (Number(raw) / 1_000_000).toFixed(2);
}

export function actionEnvelope(params: {
  req: any;
  title: string;
  description: string;
  label: string;
  links?: any;
  extra?: Record<string, unknown>;
}) {
  return {
    type: "action",
    icon: actionIconUrl(params.req),
    title: params.title,
    description: params.description,
    label: params.label,
    ...(params.links ? { links: params.links } : {}),
    ...(params.extra ?? {}),
  };
}

export function serializeEligibilityError(e: any, fallbackCode: string) {
  const code = e?.code || fallbackCode;
  const retryable = code === "NO_UNCLAIMED_PRIZE" || code === "NO_REFUND_AVAILABLE";
  return {
    eligible: false,
    code,
    message: e?.message || "Eligibility unknown",
    retryable,
  };
}

export async function withHandler(_req: any, res: any, fn: () => Promise<void>) {
  try {
    setActionHeaders(res);
    await fn();
  } catch (e: any) {
    const status = Number(e?.status || 500);
    const code = e?.code || "INTERNAL_ERROR";
    const message = e?.message || String(e);
    jsonError(res, status, code, message);
  }
}
