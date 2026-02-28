/**
 * Execute an already-approved Squads vault transaction.
 *
 * Env:
 *   MULTISIG_PDA  — the multisig PDA (Ops or Upgrade)
 *   TX_INDEX      — the transaction index to execute
 *   RPC_URL       — RPC endpoint
 *   SIGNER_KEYPAIR_PATH — keypair of a multisig member (fee payer)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const multisig = await import("@sqds/multisig");
const web3 = await import("@solana/web3.js");
const { Connection, Keypair, PublicKey } = web3;

function loadKeypair(filePath) {
  const arr = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, filePath), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

function envRequired(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function envOr(name, fallback) {
  return process.env[name] || fallback;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function confirmOrThrow(connection, signature, label, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const s = st?.value?.[0];
    if (s) {
      if (s.err) throw new Error(`${label} failed: ${JSON.stringify(s.err)} (${signature})`);
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
        console.log(`${label} ${s.confirmationStatus}`);
        return;
      }
    }
    await sleep(1500);
  }
  throw new Error(`${label} not confirmed in time (${signature})`);
}

async function main() {
  const rpcUrl = envOr("RPC_URL", "https://api.mainnet-beta.solana.com");
  const multisigPda = new PublicKey(envRequired("MULTISIG_PDA"));
  const signer = loadKeypair(envRequired("SIGNER_KEYPAIR_PATH"));
  const txIndex = BigInt(envRequired("TX_INDEX"));

  const connection = new Connection(rpcUrl, "confirmed");
  const sendOptions = {
    skipPreflight: true,
    preflightCommitment: "processed",
    maxRetries: 80,
  };

  console.log(`Executing tx=${txIndex} as ${signer.publicKey.toBase58()}...`);

  const sigExecute = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: signer,
    multisigPda: multisigPda,
    transactionIndex: txIndex,
    member: signer.publicKey,
    sendOptions,
  });
  await confirmOrThrow(connection, sigExecute, `vaultTransactionExecute(tx=${txIndex})`, 120_000);
  console.log(`Executed: ${sigExecute}`);
}

main().catch((e) => {
  console.error("squads_execute_only failed:", e);
  process.exit(1);
});
