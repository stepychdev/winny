/**
 * Create and approve a Squads Upgrade proposal that executes
 * BPF Upgradeable Loader `Upgrade` from a prepared buffer account.
 *
 * This script does NOT bypass timelock. It can optionally try execute once.
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

function toBool(v, dflt) {
  if (v == null) return dflt;
  return v === "1" || v === "true" || v === "TRUE";
}

const multisig = await import("@sqds/multisig");
const web3 = await import("@solana/web3.js");
const {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} = web3;

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

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

function buildUpgradeIx({
  programId,
  programDataPda,
  bufferPubkey,
  spillPubkey,
  authorityPubkey,
}) {
  // bincode enum variant index for UpgradeableLoaderInstruction::Upgrade
  const data = Buffer.alloc(4);
  data.writeUInt32LE(3, 0);

  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: programDataPda, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: true },
      { pubkey: bufferPubkey, isSigner: false, isWritable: true },
      { pubkey: spillPubkey, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: authorityPubkey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const rpcUrl = envOr("RPC_URL", "http://ams.rpc.gadflynode.com:80");
  const upgradeMultisigPda = new PublicKey(envRequired("UPGRADE_MULTISIG_PDA"));
  const upgradeVaultPda = new PublicKey(envRequired("UPGRADE_VAULT_PDA"));
  const programId = new PublicKey(envRequired("PROGRAM_ID"));
  const programDataPda = new PublicKey(envRequired("PROGRAM_DATA_PDA"));
  const bufferPubkey = new PublicKey(envRequired("BUFFER_PUBKEY"));
  const spillPubkey = new PublicKey(envRequired("SPILL_PUBKEY"));
  const signer1 = loadKeypair(envRequired("SIGNER1_KEYPAIR_PATH"));
  const signer2 = loadKeypair(envRequired("SIGNER2_KEYPAIR_PATH"));
  const tryExecute = toBool(process.env.TRY_EXECUTE, false);

  const connection = new Connection(rpcUrl, "confirmed");
  const sendOptions = {
    skipPreflight: true,
    preflightCommitment: "processed",
    maxRetries: 80,
  };

  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, upgradeMultisigPda);
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;

  const upgradeIx = buildUpgradeIx({
    programId,
    programDataPda,
    bufferPubkey,
    spillPubkey,
    authorityPubkey: upgradeVaultPda,
  });

  const { blockhash } = await connection.getLatestBlockhash("processed");

  const sigCreate = await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: signer1,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    creator: signer1.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: new TransactionMessage({
      payerKey: upgradeVaultPda,
      recentBlockhash: blockhash,
      instructions: [upgradeIx],
    }),
    sendOptions,
  });
  await confirmOrThrow(connection, sigCreate, `vaultTransactionCreate(tx=${txIndex})`);

  const sigProposal = await multisig.rpc.proposalCreate({
    connection,
    feePayer: signer1,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    creator: signer1,
    sendOptions,
  });
  await confirmOrThrow(connection, sigProposal, `proposalCreate(tx=${txIndex})`);

  const sigApprove1 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer1,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    member: signer1,
    sendOptions,
  });
  await confirmOrThrow(connection, sigApprove1, `proposalApprove#1(tx=${txIndex})`);

  const sigApprove2 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer2,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    member: signer2,
    sendOptions,
  });
  await confirmOrThrow(connection, sigApprove2, `proposalApprove#2(tx=${txIndex})`);

  let sigExecute = null;
  let executeError = null;
  if (tryExecute) {
    try {
      sigExecute = await multisig.rpc.vaultTransactionExecute({
        connection,
        feePayer: signer1,
        multisigPda: upgradeMultisigPda,
        transactionIndex: txIndex,
        member: signer1.publicKey,
        sendOptions,
      });
      await confirmOrThrow(connection, sigExecute, `vaultTransactionExecute(tx=${txIndex})`, 120_000);
    } catch (e) {
      executeError = String(e?.message || e);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        rpc: rpcUrl,
        txIndex: txIndex.toString(),
        programId: programId.toBase58(),
        programDataPda: programDataPda.toBase58(),
        bufferPubkey: bufferPubkey.toBase58(),
        spillPubkey: spillPubkey.toBase58(),
        upgradeMultisigPda: upgradeMultisigPda.toBase58(),
        upgradeVaultPda: upgradeVaultPda.toBase58(),
        signatures: {
          vaultTransactionCreate: sigCreate,
          proposalCreate: sigProposal,
          proposalApprove1: sigApprove1,
          proposalApprove2: sigApprove2,
          vaultTransactionExecute: sigExecute,
        },
        executeError,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("squads_upgrade_from_buffer failed:", e);
  process.exit(1);
});
