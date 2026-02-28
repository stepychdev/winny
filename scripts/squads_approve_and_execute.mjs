/**
 * Approve an existing Squads proposal (2nd signer) and execute it.
 *
 * Env:
 *   UPGRADE_MULTISIG_PDA, UPGRADE_VAULT_PDA, PROGRAM_ID, PROGRAM_DATA_PDA,
 *   BUFFER_PUBKEY, SPILL_PUBKEY, RPC_URL, SIGNER_KEYPAIR_PATH, TX_INDEX
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

const multisig = await import("@sqds/multisig");
const web3 = await import("@solana/web3.js");
const { Connection, Keypair, PublicKey } = web3;

function loadKeypair(filePath) {
  const arr = readJson(path.resolve(REPO_ROOT, filePath));
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
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return;
    }
    await sleep(1500);
  }
  throw new Error(`${label} not confirmed in time (${signature})`);
}

async function main() {
  const rpcUrl = envOr("RPC_URL", "http://ams.rpc.gadflynode.com:80");
  const upgradeMultisigPda = new PublicKey(envRequired("UPGRADE_MULTISIG_PDA"));
  const signer = loadKeypair(envRequired("SIGNER_KEYPAIR_PATH"));
  const txIndex = BigInt(envRequired("TX_INDEX"));

  const connection = new Connection(rpcUrl, "confirmed");
  const sendOptions = {
    skipPreflight: true,
    preflightCommitment: "processed",
    maxRetries: 80,
  };

  console.log(`Approving tx=${txIndex} as ${signer.publicKey.toBase58()}...`);

  const sigApprove = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    member: signer,
    sendOptions,
  });
  await confirmOrThrow(connection, sigApprove, `proposalApprove(tx=${txIndex})`);
  console.log(`Approved: ${sigApprove}`);

  console.log(`Executing tx=${txIndex}...`);

  const sigExecute = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: signer,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    member: signer.publicKey,
    sendOptions,
  });
  await confirmOrThrow(connection, sigExecute, `vaultTransactionExecute(tx=${txIndex})`, 120_000);
  console.log(`Executed: ${sigExecute}`);

  console.log(JSON.stringify({
    ok: true,
    txIndex: txIndex.toString(),
    signer: signer.publicKey.toBase58(),
    signatures: {
      approve: sigApprove,
      execute: sigExecute,
    },
  }, null, 2));
}

main().catch((e) => {
  console.error("squads_approve_and_execute failed:", e);
  process.exit(1);
});
