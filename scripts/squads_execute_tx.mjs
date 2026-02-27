/* eslint-env node */
/**
 * Execute an already-created Squads V4 vault transaction.
 *
 * Intended for recovery flows where create/proposal/approvals already succeeded
 * but execute did not complete (e.g. RPC issue / SDK hang).
 *
 * Required env:
 *   TX_INDEX=5
 *   SIGNER_KEYPAIR_PATH=./keypar.json
 *
 * Optional env:
 *   NETWORK=mainnet|devnet            # default: mainnet
 *   RPC_URL=...
 *   MULTISIG_PDA=...                  # defaults to Ops multisig for selected network
 *
 * Recommended runtime (host Node 24 may segfault with @sqds/multisig):
 *   npx -y node@20 scripts/squads_execute_tx.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function importOrExit(specifier, installHint) {
  try {
    return await import(specifier);
  } catch (e) {
    console.error(`Failed to import ${specifier}:`, e?.message || e);
    if (installHint) console.error(installHint);
    process.exit(1);
  }
}

function envOrDefault(name, fallback) {
  return process.env[name] || fallback;
}

function deriveWsEndpoint(rpcUrl) {
  if (!rpcUrl) return undefined;
  if (rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://")) return rpcUrl;
  if (rpcUrl.startsWith("https://")) return rpcUrl.replace(/^https:\/\//, "wss://");
  if (rpcUrl.startsWith("http://")) return rpcUrl.replace(/^http:\/\//, "ws://");
  return undefined;
}

function parseRequiredBigInt(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return BigInt(v);
}

function getDefaults(network) {
  if (network === "devnet") {
    const a = readJson(path.resolve(REPO_ROOT, "addresses.json")).devnet;
    return {
      rpcUrl: "https://api.devnet.solana.com",
      multisigPda: a.squads.ops.multisig_pda,
    };
  }

  const a = readJson(path.resolve(REPO_ROOT, "addresses.mainnet.json")).mainnet;
  return {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    multisigPda: a.squads.ops.multisig_pda,
  };
}

function loadKeypairFactory(web3) {
  return function loadKeypair(filePath) {
    const resolved = path.resolve(REPO_ROOT, filePath);
    const arr = readJson(resolved);
    return web3.Keypair.fromSecretKey(Uint8Array.from(arr));
  };
}

async function confirmOrThrow(connection, signature, label) {
  const startedAt = Date.now();
  let lastErr = null;
  while (Date.now() - startedAt < 180_000) {
    try {
      const st = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const s = st?.value?.[0];
      if (s) {
        if (s.err) throw new Error(`${label} failed: ${JSON.stringify(s.err)} (${signature})`);
        if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return;
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `${label} not confirmed in time (${signature})${lastErr ? `; lastErr=${lastErr}` : ""}`
  );
}

async function confirmWithTimeout(connection, signature, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const st = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const s = st?.value?.[0];
    if (s) {
      if (s.err) throw new Error(`execute failed: ${JSON.stringify(s.err)} (${signature})`);
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
        return { confirmed: true, status: s };
      }
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return { confirmed: false };
}

async function main() {
  const multisig = await importOrExit(
    "@sqds/multisig",
    "Install @sqds/multisig in the runtime environment used for this script."
  );
  const web3 = await importOrExit("@solana/web3.js");
  const { Connection, PublicKey } = web3;
  const loadKeypair = loadKeypairFactory(web3);

  const network = (process.env.NETWORK || "mainnet").toLowerCase();
  if (network !== "mainnet" && network !== "devnet") {
    throw new Error(`NETWORK must be mainnet or devnet, got ${network}`);
  }

  const defaults = getDefaults(network);
  const rpcUrl = envOrDefault("RPC_URL", defaults.rpcUrl);
  const rpcWsUrl = process.env.RPC_WS_URL || deriveWsEndpoint(rpcUrl);
  const multisigPda = new PublicKey(envOrDefault("MULTISIG_PDA", defaults.multisigPda));
  const txIndex = parseRequiredBigInt("TX_INDEX");
  const executeAttempts = Number.parseInt(process.env.EXECUTE_ATTEMPTS || "5", 10);
  const perAttemptConfirmMs = Number.parseInt(process.env.EXECUTE_CONFIRM_TIMEOUT_MS || "30000", 10);
  const signerPath = process.env.SIGNER_KEYPAIR_PATH;
  if (!signerPath) throw new Error("SIGNER_KEYPAIR_PATH is required");
  const signer = loadKeypair(signerPath);

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: rpcWsUrl,
  });
  const sendOptions = {
    skipPreflight: true,
    preflightCommitment: "processed",
    maxRetries: 80,
  };

  console.log("=== Squads Execute Existing Tx ===");
  console.log("Network:", network);
  console.log("RPC:", rpcUrl);
  console.log("WS RPC:", rpcWsUrl || "(auto)");
  console.log("Multisig:", multisigPda.toBase58());
  console.log("Tx index:", txIndex.toString());
  console.log("Executor:", signer.publicKey.toBase58());
  console.log("Execute attempts:", executeAttempts);
  console.log("Per-attempt confirm timeout (ms):", perAttemptConfirmMs);
  console.log();

  let sig = null;
  let confirmed = false;
  for (let attempt = 1; attempt <= executeAttempts; attempt += 1) {
    console.log(`Executing txIndex=${txIndex} (attempt ${attempt}/${executeAttempts})...`);
    sig = await multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: signer,
      multisigPda,
      transactionIndex: txIndex,
      member: signer.publicKey,
      sendOptions,
    });
    console.log(`Sent execute tx: ${sig}`);
    try {
      const res = await confirmWithTimeout(connection, sig, perAttemptConfirmMs);
      if (res.confirmed) {
        confirmed = true;
        break;
      }
      console.log(`Not confirmed in ${perAttemptConfirmMs}ms, retrying...`);
    } catch (e) {
      const msg = e?.message || String(e);
      // If already executed by a previous landed tx, another execute attempt can fail; we'll surface later.
      console.log(`Execute attempt returned on-chain error: ${msg}`);
      throw e;
    }
  }

  if (!confirmed) {
    throw new Error(
      `vaultTransactionExecute(tx=${txIndex}) not observed after ${executeAttempts} attempts; last signature=${sig}`
    );
  }

  console.log(
    JSON.stringify(
      {
        network,
        multisigPda: multisigPda.toBase58(),
        txIndex: txIndex.toString(),
        executeSignature: sig,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
