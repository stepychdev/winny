#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/scumcheck/jackpot/xyzcasino";
const API_URL = "https://api.jup.ag/tokens/v2/tag?query=verified";
const API_KEY = (process.env.JUP_API_KEY || "").trim();
const POOL_VERSION = Number.parseInt(process.env.DEGEN_POOL_VERSION || "1", 10);

if (!API_KEY) {
  console.error("Missing JUP_API_KEY");
  process.exit(1);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toRustByteArray(base58) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const char of base58) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error(`Invalid base58 char in mint: ${base58}`);
    num = num * 58n + BigInt(index);
  }

  const bytes = [];
  while (num > 0n) {
    bytes.push(Number(num & 0xffn));
    num >>= 8n;
  }
  bytes.reverse();

  let leadingZeros = 0;
  for (const char of base58) {
    if (char === "1") leadingZeros++;
    else break;
  }

  const out = new Uint8Array(32);
  const full = [...new Array(leadingZeros).fill(0), ...bytes];
  if (full.length > 32) {
    throw new Error(`Mint too long after base58 decode: ${base58}`);
  }
  out.set(full, 32 - full.length);
  return `[${Array.from(out).join(", ")}]`;
}

async function fetchVerified() {
  const response = await fetch(API_URL, {
    headers: {
      "x-api-key": API_KEY,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Jupiter API failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.tokens ?? [];
  return rows
    .map((row) => ({
      mint: row.id || row.address || row.mint,
      symbol: row.symbol || null,
      name: row.name || null,
      logoURI: row.logoURI || row.icon || null,
    }))
    .filter((row) => typeof row.mint === "string" && row.mint.length > 0);
}

function normalizeTokens(rows) {
  const byMint = new Map();
  for (const row of rows) {
    if (!byMint.has(row.mint)) {
      byMint.set(row.mint, row);
    }
  }
  return [...byMint.values()].sort((a, b) => a.mint.localeCompare(b.mint));
}

async function main() {
  const tokens = normalizeTokens(await fetchVerified());
  const minted = tokens.map((token) => token.mint);
  const rawSnapshot = JSON.stringify(minted);
  const snapshotSha256 = sha256Hex(rawSnapshot);
  const generatedAt = new Date().toISOString();

  const manifest = {
    poolVersion: POOL_VERSION,
    source: "jupiter-verified",
    generatedAt,
    tokenCount: tokens.length,
    snapshotSha256,
    tokens,
  };

  writeFile(
    path.join(ROOT, "degen-pool-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const tsFile = [
    `export const DEGEN_POOL_VERSION = ${POOL_VERSION};`,
    `export const DEGEN_POOL_SNAPSHOT_SHA256 = "${snapshotSha256}";`,
    `export const DEGEN_POOL = ${JSON.stringify(minted, null, 2)} as const;`,
    "",
    "export type DegenPoolMint = (typeof DEGEN_POOL)[number];",
    "",
  ].join("\n");
  writeFile(path.join(ROOT, "src/generated/degenPool.ts"), tsFile);

  const rustFile = [
    `pub const DEGEN_POOL_VERSION: u32 = ${POOL_VERSION};`,
    `pub const DEGEN_POOL_SNAPSHOT_SHA256: &str = "${snapshotSha256}";`,
    `pub const DEGEN_POOL: [[u8; 32]; ${minted.length}] = [`,
    ...minted.map((mint) => `    ${toRustByteArray(mint)},`),
    "];",
    "",
  ].join("\n");
  writeFile(
    path.join(ROOT, "jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs"),
    rustFile
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        poolVersion: POOL_VERSION,
        tokenCount: tokens.length,
        snapshotSha256,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
