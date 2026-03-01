import { Connection, PublicKey } from "@solana/web3.js";
import { jupiterFetchJson } from "./jupiterApi";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export interface TokenMetadataResult {
  name: string;
  symbol: string;
  image: string;
  uri: string;
}

// In-memory cache
const cache = new Map<string, TokenMetadataResult>();

function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * Parse on-chain Metaplex metadata account data.
 * Layout (simplified):
 *   [0..4]   — key (u8) + update_authority (32) ... but actually:
 *   [0]      — key (u8, = 4 for MetadataV1)
 *   [1..33]  — update authority (Pubkey)
 *   [33..65] — mint (Pubkey)
 *   [65..]   — data: name (string), symbol (string), uri (string), ...
 *
 * Strings are borsh-encoded: u32 length prefix + utf8 bytes
 */
function parseMetadataAccount(data: Buffer): {
  name: string;
  symbol: string;
  uri: string;
} | null {
  try {
    let offset = 1 + 32 + 32; // key + update_authority + mint

    // Read name
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data
      .subarray(offset, offset + nameLen)
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();
    offset += nameLen;

    // Read symbol
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data
      .subarray(offset, offset + symbolLen)
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();
    offset += symbolLen;

    // Read uri
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const uri = data
      .subarray(offset, offset + uriLen)
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();

    return { name, symbol, uri };
  } catch {
    return null;
  }
}

/**
 * Fetch token metadata from on-chain Metaplex metadata account.
 * Returns cached result if available.
 */
export async function fetchTokenMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<TokenMetadataResult | null> {
  const mintStr = mint.toBase58();

  // Check cache
  const cached = cache.get(mintStr);
  if (cached) return cached;

  try {
    const metadataPda = getMetadataPda(mint);
    const accountInfo = await connection.getAccountInfo(metadataPda);

    if (!accountInfo || !accountInfo.data) return null;

    const parsed = parseMetadataAccount(accountInfo.data as Buffer);
    if (!parsed || !parsed.uri) return null;

    // Race: try Jupiter logo (fast CDN) and Metaplex URI in parallel
    let image = "";
    try {
      const [jupLogo, metaplexResult] = await Promise.allSettled([
        fetchTokenLogoViaJupiter(mintStr),
        fetch(parsed.uri, { signal: AbortSignal.timeout(6_000) })
          .then(r => r.ok ? r.json() : null)
          .then(json => json?.image || "")
          .catch(() => ""),
      ]);

      const jupImage = jupLogo.status === "fulfilled" ? jupLogo.value : "";
      const metaplexImage = metaplexResult.status === "fulfilled" ? metaplexResult.value : "";
      image = jupImage || metaplexImage;
    } catch {
      // Both failed
    }

    const result: TokenMetadataResult = {
      name: parsed.name,
      symbol: parsed.symbol,
      uri: parsed.uri,
      image,
    };

    cache.set(mintStr, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Batch fetch metadata for multiple mints.
 * Uses getMultipleAccountsInfo for efficiency.
 */
export async function fetchTokenMetadataBatch(
  connection: Connection,
  mints: PublicKey[]
): Promise<Map<string, TokenMetadataResult>> {
  const results = new Map<string, TokenMetadataResult>();
  const uncachedMints: PublicKey[] = [];
  const uncachedPdas: PublicKey[] = [];

  // Separate cached from uncached
  for (const mint of mints) {
    const mintStr = mint.toBase58();
    const cached = cache.get(mintStr);
    if (cached) {
      results.set(mintStr, cached);
    } else {
      uncachedMints.push(mint);
      uncachedPdas.push(getMetadataPda(mint));
    }
  }

  if (uncachedPdas.length === 0) return results;

  // Batch fetch metadata accounts
  const accounts = await connection.getMultipleAccountsInfo(uncachedPdas);

  // Parse and fetch URIs
  const uriPromises: Promise<void>[] = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const mint = uncachedMints[i];
    const mintStr = mint.toBase58();

    if (!account || !account.data) continue;

    const parsed = parseMetadataAccount(account.data as Buffer);
    if (!parsed || !parsed.uri) continue;

    uriPromises.push(
      (async () => {
        // Race: try Jupiter logo (fast CDN) and Metaplex URI in parallel
        let image = "";
        try {
          const [jupLogo, metaplexResult] = await Promise.allSettled([
            fetchTokenLogoViaJupiter(mintStr),
            fetch(parsed.uri, { signal: AbortSignal.timeout(6_000) })
              .then(r => r.ok ? r.json() : null)
              .then(json => json?.image || "")
              .catch(() => ""),
          ]);

          const jupImage = jupLogo.status === "fulfilled" ? jupLogo.value : "";
          const metaplexImage = metaplexResult.status === "fulfilled" ? metaplexResult.value : "";
          // Prefer Jupiter (CDN-backed, faster loading in browser) over Metaplex URI
          image = jupImage || metaplexImage;
        } catch {
          // Both failed
        }

        const result: TokenMetadataResult = {
          name: parsed.name,
          symbol: parsed.symbol,
          uri: parsed.uri,
          image,
        };

        cache.set(mintStr, result);
        results.set(mintStr, result);
      })()
    );
  }

  await Promise.allSettled(uriPromises);
  return results;
}

/**
 * Fetch token logos from Jupiter Token API (fast CDN-backed images).
 * Uses /tokens/v2/search endpoint per mint. Results are merged into the cache.
 */
const jupiterLogoCache = new Map<string, string>();
const jupiterLogoInflight = new Map<string, Promise<string>>();

export async function fetchTokenLogoViaJupiter(mint: string): Promise<string> {
  const cached = jupiterLogoCache.get(mint);
  if (cached !== undefined) return cached;

  // De-duplicate in-flight requests
  const existing = jupiterLogoInflight.get(mint);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const rows = await jupiterFetchJson<any[]>(
        `/tokens/v2/search?query=${encodeURIComponent(mint)}`,
        { timeoutMs: 4_000, retries: 1 },
      );
      const token = Array.isArray(rows)
        ? rows.find((r) => (r.id || r.address || r.mint) === mint)
        : null;
      const logo = token?.logoURI || token?.icon || "";
      jupiterLogoCache.set(mint, logo);
      return logo;
    } catch {
      jupiterLogoCache.set(mint, "");
      return "";
    } finally {
      jupiterLogoInflight.delete(mint);
    }
  })();

  jupiterLogoInflight.set(mint, promise);
  return promise;
}

/**
 * Batch-fetch token logos from Jupiter for multiple mints.
 * Fires requests in parallel (capped at 5 concurrency).
 */
export async function fetchTokenLogosBatchViaJupiter(
  mints: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const toFetch: string[] = [];

  for (const m of mints) {
    const cached = jupiterLogoCache.get(m);
    if (cached !== undefined) {
      results.set(m, cached);
    } else {
      toFetch.push(m);
    }
  }

  if (toFetch.length === 0) return results;

  // Cap concurrency at 5
  const CONCURRENCY = 5;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((m) => fetchTokenLogoViaJupiter(m).then((logo) => ({ mint: m, logo }))),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.set(r.value.mint, r.value.logo);
      }
    }
  }

  return results;
}

/**
 * Clear the metadata cache (useful for testing).
 */
export function clearMetadataCache() {
  cache.clear();
  jupiterLogoCache.clear();
}
