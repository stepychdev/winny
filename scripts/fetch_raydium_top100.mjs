#!/usr/bin/env node
/**
 * Fetch top 100 memecoins by liquidity from Raydium pools.
 * Output: flat JSON array of mint addresses → degen-pool-raydium-top100.json
 *
 * Safety: filters out tokens with active freeze authority (scam risk).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "degen-pool-raydium-top100.json");

const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",     // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",   // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",    // USDT
]);

const EXCLUDE = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
  "AvwGsMMmDagnyYkYUQ2Wn1w4XjMai8vKbo9BcpcjKWGc",
  "Y87nfiS1yyPqmdHoaNc4NGoonNaF1SexXBYVYkTZdk2",
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",  // RAY
  "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",   // HNT
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ",  // W (wormhole)
]);

async function fetchPage(page) {
  const url = `https://api-v3.raydium.io/pools/info/list?poolType=all&poolSortField=liquidity&sortType=desc&pageSize=100&page=${page}`;
  const resp = await globalThis.fetch(url);
  return resp.json();
}

// ─── On-chain freeze authority check ──────────────────────
// SPL Token Mint layout: [..36 bytes..][freeze_authority option at offset 46]
// Offset 46: 1 byte COption tag (0=None, 1=Some) + 32 byte pubkey
// If tag == 1, the mint has an active freeze authority → scam risk.
const ALL_ZERO_32 = "0".repeat(64);

/**
 * Check which mints have active freeze authority via getMultipleAccounts RPC.
 * Returns a Set of mints that HAVE freeze authority (should be excluded).
 */
async function findMintsWithFreezeAuthority(mintAddresses) {
  const hasFreezeAuth = new Set();
  // RPC supports max 100 accounts per call
  const BATCH = 100;
  for (let i = 0; i < mintAddresses.length; i += BATCH) {
    const batch = mintAddresses.slice(i, i + BATCH);
    const resp = await globalThis.fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getMultipleAccounts",
        params: [batch, { encoding: "base64" }],
      }),
    });
    const json = await resp.json();
    const accounts = json.result?.value || [];
    for (let j = 0; j < accounts.length; j++) {
      const acc = accounts[j];
      if (!acc?.data?.[0]) continue;
      const buf = Buffer.from(acc.data[0], "base64");
      // SPL Token Mint: freeze_authority COption at offset 46
      // byte 46 = 1 means Some(pubkey), byte 46 = 0 means None
      if (buf.length >= 82 && buf[46] === 1) {
        // Double-check it's not all zeros (shouldn't happen but be safe)
        const freezePubkeyHex = buf.slice(47, 79).toString("hex");
        if (freezePubkeyHex !== ALL_ZERO_32) {
          hasFreezeAuth.add(batch[j]);
        }
      }
    }
  }
  return hasFreezeAuth;
}

async function main() {
  const seen = new Map();

  for (let page = 1; page <= 15; page++) {
    const resp = await fetchPage(page);
    if (!resp.success || !resp.data?.data?.length) break;

    for (const pool of resp.data.data) {
      const aAddr = pool.mintA.address;
      const bAddr = pool.mintB.address;

      let memeMint, memeSymbol, memeName, tvl;
      if (QUOTE_MINTS.has(aAddr) && !QUOTE_MINTS.has(bAddr)) {
        memeMint = bAddr;
        memeSymbol = pool.mintB.symbol;
        memeName = pool.mintB.name;
      } else if (QUOTE_MINTS.has(bAddr) && !QUOTE_MINTS.has(aAddr)) {
        memeMint = aAddr;
        memeSymbol = pool.mintA.symbol;
        memeName = pool.mintA.name;
      } else {
        continue;
      }

      if (EXCLUDE.has(memeMint)) continue;
      tvl = pool.tvl || 0;
      if (tvl < 50_000) continue; // skip dust pools

      const existing = seen.get(memeMint);
      if (!existing || existing.tvl < tvl) {
        seen.set(memeMint, { mint: memeMint, symbol: memeSymbol, name: memeName, tvl });
      }
    }

    console.log(`page ${page}: ${seen.size} unique tokens so far`);
    if (seen.size >= 200) break;
  }

  // ── Filter out mints with active freeze authority (scam protection) ──
  const candidateMints = [...seen.keys()];
  console.log(`\nChecking ${candidateMints.length} mints for freeze authority on-chain...`);
  const freezeSet = await findMintsWithFreezeAuthority(candidateMints);
  if (freezeSet.size > 0) {
    console.log(`⚠ Excluding ${freezeSet.size} token(s) with active freeze authority:`);
    for (const mint of freezeSet) {
      const info = seen.get(mint);
      console.log(`  - ${info.symbol.padEnd(10)} ${mint}`);
      seen.delete(mint);
    }
  } else {
    console.log("✓ No tokens with active freeze authority found");
  }

  const top100 = [...seen.values()]
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 100);

  const mints = top100.map((t) => t.mint);
  fs.writeFileSync(OUT, JSON.stringify(mints, null, 2));

  console.log(`\nSaved ${mints.length} mints → ${OUT}`);
  console.log("\nTop 15:");
  top100.slice(0, 15).forEach((t, i) =>
    console.log(`${String(i + 1).padStart(3)}. ${t.symbol.padEnd(10)} TVL $${(t.tvl / 1e6).toFixed(1)}M  ${t.mint}`)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
