import { PublicKey } from "@solana/web3.js";
import { DEGEN_POOL, DEGEN_POOL_VERSION } from "../generated/degenPool";
import { jupiterFetchJson } from "./jupiterApi";

export interface DegenToken {
  mint: string;
  symbol: string;
  name?: string | null;
  logoURI?: string | null;
}

export interface DerivedDegenCandidate {
  rank: number;
  index: number;
  mint: string;
}

const DEVNET_DEGEN_POOL = [
  "So11111111111111111111111111111111111111112",
] as const;

const tokenMetaCache = new Map<string, Promise<DegenToken>>();

function encodeU32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function decodeU32LE(value: Uint8Array): number {
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true);
}

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
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

function normalizeTokenMetadata(mint: string, payload: any): DegenToken {
  return {
    mint,
    symbol: payload?.symbol || `${mint.slice(0, 4)}…`,
    name: payload?.name || null,
    logoURI: payload?.logoURI || payload?.icon || null,
  };
}

export function getDegenPool(isMainnet: boolean): readonly string[] {
  return isMainnet ? DEGEN_POOL : DEVNET_DEGEN_POOL;
}

export function getDegenPoolVersion(isMainnet: boolean): number {
  return isMainnet ? DEGEN_POOL_VERSION : 0;
}

export async function deriveDegenCandidates(
  randomness: Uint8Array,
  poolVersion: number,
  count: number,
  isMainnet: boolean,
): Promise<DerivedDegenCandidate[]> {
  const pool = getDegenPool(isMainnet);
  const limit = Math.min(count, pool.length);
  const used = new Set<number>();
  const out: DerivedDegenCandidate[] = [];

  for (let rank = 0; rank < limit; rank += 1) {
    let nonce = 0;

    while (true) {
      const digest = await sha256([
        randomness,
        encodeU32LE(poolVersion),
        encodeU32LE(rank),
        encodeU32LE(nonce),
      ]);
      const index = decodeU32LE(digest.subarray(0, 4)) % pool.length;

      if (!used.has(index)) {
        used.add(index);
        out.push({
          rank,
          index,
          mint: pool[index],
        });
        break;
      }

      nonce += 1;
    }
  }

  return out;
}

export async function fetchDegenTokenMeta(mint: string): Promise<DegenToken> {
  if (!tokenMetaCache.has(mint)) {
    tokenMetaCache.set(
      mint,
      jupiterFetchJson<any[]>(`/tokens/v2/search?query=${encodeURIComponent(mint)}`, {
        timeoutMs: 5_000,
      })
        .then((rows) => {
          const token = Array.isArray(rows) ? rows.find((row) => (row.id || row.address || row.mint) === mint) : null;
          return normalizeTokenMetadata(mint, token);
        })
        .catch(() => normalizeTokenMetadata(mint, null))
    );
  }

  return tokenMetaCache.get(mint)!;
}

export function isUsdcCandidate(mint: string, usdcMint: PublicKey): boolean {
  return mint === usdcMint.toBase58();
}
