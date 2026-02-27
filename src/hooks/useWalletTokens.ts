import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  AccountLayout,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";
import { getJupiterPrices } from "../lib/jupiterPrice";

export interface WalletToken {
  mint: string;
  symbol: string;
  name: string;
  image: string;
  balance: number;
  decimals: number;
  usdValue: number;
}

function decodeU64ToBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  // spl-token layout may return Buffer/Uint8Array depending on bundler
  const bytes: Uint8Array =
    v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBufferLike);
  let out = 0n;
  for (let i = 0; i < 8; i++) out |= BigInt(bytes[i] ?? 0) << (8n * BigInt(i));
  return out;
}

function normalizeAccountData(data: unknown): Uint8Array | null {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  // Some RPC wrappers may return [base64, encoding]
  if (Array.isArray(data) && typeof data[0] === "string") {
    const [b64, encRaw] = data as unknown as [string, string?];
    const enc = encRaw === "base64" || encRaw === "base64+zstd" ? "base64" : "base64";
    // Buffer is available via vite polyfills in this project.
    // eslint-disable-next-line no-undef
    return Buffer.from(b64, enc);
  }
  if (typeof data === "string") {
    // eslint-disable-next-line no-undef
    return Buffer.from(data, "base64");
  }
  return null;
}

function toUiAmount(raw: bigint, decimals: number): number {
  if (decimals <= 0) return Number(raw);
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  // Keep it fast: enough precision for UI, avoid giant float conversions.
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 6); // up to 6 dp
  return Number(whole.toString()) + Number(`0.${fracStr || "0"}`);
}

async function getMultipleAccountsInfoChunked(
  connection: Connection,
  pubkeys: PublicKey[],
  chunkSize = 100
): Promise<(AccountInfo<Buffer> | null)[]> {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < pubkeys.length; i += chunkSize) {
    // eslint-disable-next-line no-await-in-loop
    const part = await connection.getMultipleAccountsInfo(pubkeys.slice(i, i + chunkSize));
    out.push(...part);
  }
  return out;
}

// Jupiter Tokens v2 API (the old tokens.jup.ag endpoint is deprecated)
const JUPITER_API_BASE = "https://api.jup.ag";
const JUPITER_API_KEY = (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_JUPITER_API_KEY || "") : "").trim();

// Cache for all verified tokens (bulk)
let jupiterTokensCache: Record<string, { symbol: string; name: string; logoURI: string }> | null = null;
let fetchingJupiterTokens: Promise<void> | null = null;

const jupiterHeaders: Record<string, string> = {
  ...(JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
};

/**
 * Fetch verified tokens from Jupiter v2 tag endpoint.
 * Falls back gracefully — wallet tokens still show even without metadata.
 */
async function getJupiterTokens(): Promise<Record<string, { symbol: string; name: string; logoURI: string }>> {
  if (jupiterTokensCache) return jupiterTokensCache;
  if (fetchingJupiterTokens) {
    await fetchingJupiterTokens;
    return jupiterTokensCache || {};
  }

  fetchingJupiterTokens = (async () => {
    try {
      const res = await fetch(`${JUPITER_API_BASE}/tokens/v2/tag?query=verified`, {
        headers: jupiterHeaders,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any[] = await res.json();
      const cache: Record<string, { symbol: string; name: string; logoURI: string }> = {};
      for (const t of data) {
        const addr = t.id || t.address;
        if (!addr) continue;
        cache[addr] = {
          symbol: t.symbol || "",
          name: t.name || "",
          logoURI: t.icon || t.logoURI || "",
        };
      }
      jupiterTokensCache = cache;
    } catch (e) {
      console.warn("Failed to fetch Jupiter verified tokens list:", e);
    }
  })();

  await fetchingJupiterTokens;
  return jupiterTokensCache || {};
}

/**
 * Batch-lookup token metadata for specific mints via Jupiter v2 /search endpoint.
 * Max 100 comma-separated mints per call.
 * Used as a fallback when wallet tokens aren't in the verified list.
 */
async function lookupJupiterMints(
  mints: string[]
): Promise<Record<string, { symbol: string; name: string; logoURI: string }>> {
  if (mints.length === 0) return {};
  const result: Record<string, { symbol: string; name: string; logoURI: string }> = {};
  // Process in chunks of 100 (API limit)
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    try {
      const res = await fetch(
        `${JUPITER_API_BASE}/tokens/v2/search?query=${chunk.join(",")}`,
        { headers: jupiterHeaders }
      );
      if (!res.ok) continue;
      const data: any[] = await res.json();
      for (const t of data) {
        const addr = t.id || t.address;
        if (!addr) continue;
        result[addr] = {
          symbol: t.symbol || "",
          name: t.name || "",
          logoURI: t.icon || t.logoURI || "",
        };
      }
    } catch {
      // non-fatal — tokens will just have generic names
    }
  }
  return result;
}

// WSOL Mint (used as the canonical representation of SOL in Jupiter)
const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function useWalletTokens() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTokens = useCallback(async () => {
    if (!publicKey) {
      setTokens([]);
      return;
    }

    try {
      setLoading(true);

      // Start fetching Jupiter token metadata in parallel
      const jupTokensPromise = getJupiterTokens();

      // Use raw accounts instead of jsonParsed to work with stricter RPC providers.
      const [v1, v2022, solBalanceRaw] = await Promise.allSettled([
        connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
        connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
        connection.getBalance(publicKey)
      ]);

      const tokenAccounts = [
        ...(v1.status === "fulfilled" ? v1.value.value : []),
        ...(v2022.status === "fulfilled" ? v2022.value.value : []),
      ];

      // Aggregate raw amount by mint (wallet may have multiple token accounts per mint).
      const byMintRaw = new Map<string, bigint>();

      // Add Native SOL
      if (solBalanceRaw.status === "fulfilled" && solBalanceRaw.value > 0) {
        // We track native SOL internally using a pseudo-mint to distinguish it from WSOL ATA
        byMintRaw.set("SOL", BigInt(solBalanceRaw.value));
      }

      for (const acc of tokenAccounts) {
        const data = normalizeAccountData(acc.account.data);
        if (!data || data.length < AccountLayout.span) continue;
        const decoded = AccountLayout.decode(data) as unknown as {
          mint: Uint8Array;
          amount: Uint8Array;
        };
        const mint = new PublicKey(decoded.mint).toBase58();
        const raw = decodeU64ToBigInt(decoded.amount);
        if (raw <= 0n) continue;
        byMintRaw.set(mint, (byMintRaw.get(mint) ?? 0n) + raw);
      }

      if (byMintRaw.size === 0) {
        setTokens([]);
        return;
      }

      // Fetch mint decimals in batch for SPL tokens
      const splMintKeys = Array.from(byMintRaw.keys()).filter(m => m !== "SOL").map((m) => new PublicKey(m));
      const mintInfos = await getMultipleAccountsInfoChunked(connection, splMintKeys, 100);
      const decimalsByMint = new Map<string, number>();

      // Native SOL has 9 decimals
      decimalsByMint.set("SOL", 9);

      for (let i = 0; i < splMintKeys.length; i++) {
        const info = mintInfos[i];
        const data = normalizeAccountData(info?.data);
        if (!data) continue;
        if (data.length < MintLayout.span) continue;
        const decoded = MintLayout.decode(data) as unknown as { decimals: number };
        decimalsByMint.set(splMintKeys[i].toBase58(), Number(decoded.decimals ?? 0));
      }

      const jupTokens = await jupTokensPromise;

      // Find wallet mints that are NOT in the verified list and try per-mint lookup
      const unknownMints = Array.from(byMintRaw.keys())
        .filter(m => m !== "SOL" && !jupTokens[m]);
      let extraMeta: Record<string, { symbol: string; name: string; logoURI: string }> = {};
      if (unknownMints.length > 0) {
        extraMeta = await lookupJupiterMints(unknownMints);
      }

      // Merge both sources into a combined lookup
      const allMeta = { ...jupTokens, ...extraMeta };

      const walletTokens: WalletToken[] = Array.from(byMintRaw.entries()).map(
        ([mint, raw]) => {
          const decimals = decimalsByMint.get(mint) ?? 0;

          if (mint === "SOL") {
            const solData = allMeta[WSOL_MINT]; // Use WSOL metadata for native SOL
            return {
              mint: WSOL_MINT, // IMPORTANT: Jupiter requires WSOL mint for swaps, not "SOL"
              symbol: "SOL",
              name: "Solana",
              image: solData?.logoURI || "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
              balance: toUiAmount(raw, decimals),
              decimals,
              usdValue: 0,
            };
          }

          const meta = allMeta[mint];
          return {
            mint,
            symbol: meta?.symbol || mint.slice(0, 4),
            name: meta?.name || "Unknown Token",
            image: meta?.logoURI || "",
            balance: toUiAmount(raw, decimals),
            decimals,
            usdValue: 0,
          };
        }
      );

      // Deduplicate: If user has Native SOL and WSOL ATA, combine them under WSOL mint
      const tokenMap = new Map<string, WalletToken>();

      for (const token of walletTokens) {
        if (tokenMap.has(token.mint)) {
          const existing = tokenMap.get(token.mint)!;
          existing.balance += token.balance;
        } else {
          tokenMap.set(token.mint, token);
        }
      }

      const finalTokens = Array.from(tokenMap.values());

      // Fetch USD prices to sort by value (most valuable first)
      try {
        const mints = finalTokens.map((t) => t.mint);
        const prices = await getJupiterPrices(mints);
        for (const t of finalTokens) {
          const price = prices.get(t.mint) ?? 0;
          t.usdValue = t.balance * price;
        }
      } catch {
        // Best-effort — fall back to 0 usdValue
      }

      finalTokens.sort((a, b) => b.usdValue - a.usdValue);
      setTokens(finalTokens);
    } catch (e) {
      console.warn("Failed to fetch wallet tokens:", e);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  // Fetch once on mount / wallet change. No automatic polling —
  // callers use refetch() after deposits or other actions.
  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  return { tokens, loading, refetch: fetchTokens };
}
