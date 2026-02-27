import { jupiterFetchJson } from "./jupiterApi";

interface JupiterPriceItem {
  usdPrice?: number;
  price?: number;
}

type PriceResponse = Record<string, JupiterPriceItem | null>;

// In-memory cache: mint → { price, ts }
const priceCache = new Map<string, { price: number; ts: number }>();
const CACHE_TTL_MS = 15_000; // 15s
const PRICE_IDS_LIMIT = 50;
let lastPriceErrorLogTs = 0;

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Fetch prices for one or more token mints from Jupiter Price API.
 * Returns a Map<mint, priceInUSD>.
 */
export async function getJupiterPrices(mints: string[]): Promise<Map<string, number>> {
  const now = Date.now();
  const result = new Map<string, number>();
  const toFetch = new Set<string>();

  for (const m of mints) {
    if (!m) continue;
    const cached = priceCache.get(m);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      result.set(m, cached.price);
    } else {
      toFetch.add(m);
    }
  }

  if (toFetch.size > 0) {
    try {
      const batches = chunk(Array.from(toFetch), PRICE_IDS_LIMIT);
      for (const mintsBatch of batches) {
        const query = encodeURIComponent(mintsBatch.join(","));
        const priceByMint = await jupiterFetchJson<PriceResponse>(`/price/v3?ids=${query}`);
        for (const [mint, info] of Object.entries(priceByMint)) {
          const rawPrice = info?.usdPrice ?? info?.price;
          const price = typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : 0;
          if (price > 0) {
            priceCache.set(mint, { price, ts: now });
            result.set(mint, price);
          }
        }
      }
    } catch (error) {
      // Price calls are best-effort, but surface failures in logs at a low cadence.
      const nowTs = Date.now();
      if (nowTs - lastPriceErrorLogTs >= 30_000) {
        console.error("[JupiterPrice] Failed to fetch price data", {
          mintsRequested: toFetch.size,
          message: error instanceof Error ? error.message : "Unknown Jupiter price error",
        });
        lastPriceErrorLogTs = nowTs;
      }
    }
  }

  return result;
}

/**
 * Get a single token's price in USD.
 */
export async function getTokenPriceUsd(mint: string): Promise<number> {
  const prices = await getJupiterPrices([mint]);
  return prices.get(mint) ?? 0;
}
