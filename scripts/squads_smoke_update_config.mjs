/* eslint-env node */
/**
 * Squads Ops smoke test for jackpot `update_config(paused=...)`.
 *
 * Uses Squads V4 multisig, but note the SDK method naming:
 * - protocol/program = Squads V4
 * - create method = `multisigCreateV2` (instruction schema version inside V4)
 *
 * This script confirms the Ops vault is wired correctly as `config.admin` by:
 *  1) setting paused=true via Squads proposal (2-of-3)
 *  2) setting paused=false via Squads proposal (2-of-3)
 *
 * Defaults are loaded from `../addresses.json` (devnet).
 *
 * Required env:
 *   SIGNER1_KEYPAIR_PATH=./keypar.json
 *   SIGNER2_KEYPAIR_PATH=/path/to/second-ops-member.json
 *
 * Optional env:
 *   RPC_URL=https://api.devnet.solana.com
 *   RUN_BOTH=1                      # default 1; if 0, runs one target only
 *   TARGET_PAUSED=true|false        # used only if RUN_BOTH=0
 *   OPS_MULTISIG_PDA=...
 *   OPS_VAULT_PDA=...
 *   PROGRAM_ID=...
 *   CONFIG_PDA=...
 *
 * Known runtime note:
 *   `@sqds/multisig` may crash under some Node 24 setups. Node 20 is recommended:
 *   npx -y node@20 scripts/squads_smoke_update_config.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

async function importOrExit(specifier, installHint) {
  try {
    return await import(specifier);
  } catch (e) {
    console.error(`Failed to import ${specifier}:`, e?.message || e);
    if (installHint) console.error(installHint);
    process.exit(1);
  }
}

const multisig = await importOrExit(
  "@sqds/multisig",
  "Install @sqds/multisig in the runtime environment used for this script."
);
const web3 = await importOrExit("@solana/web3.js");
const anchor = await importOrExit("@coral-xyz/anchor");

const {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
} = web3;
const { AnchorProvider, Program, Wallet } = anchor;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function loadKeypair(filePath) {
  const arr = readJson(filePath);
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

function toBool(v, defaultValue) {
  if (v == null) return defaultValue;
  return v === "1" || v === "true" || v === "TRUE";
}

function envOrDefault(name, fallback) {
  return process.env[name] || fallback;
}

function getDefaults() {
  const addressesPath = path.resolve(REPO_ROOT, "addresses.json");
  const idlPath = path.resolve(REPO_ROOT, "src/idl/jackpot.json");

  const addresses = readJson(addressesPath);
  const idl = readJson(idlPath);
  const devnet = addresses.devnet;

  return {
    rpcUrl: "https://api.devnet.solana.com",
    opsMultisigPda: devnet.squads.ops.multisig_pda,
    opsVaultPda: devnet.squads.ops.vault_pda_index_0,
    programId: devnet.program.jackpot_program_id || idl.address || idl?.metadata?.address,
    configPda: devnet.protocol_config.config_pda,
    idl,
  };
}

async function confirmOrThrow(connection, signature, label) {
  const startedAt = Date.now();
  let lastErr = null;
  while (Date.now() - startedAt < 180_000) {
    try {
      const st = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
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
  throw new Error(`${label} not confirmed in time (${signature})${lastErr ? `; lastErr=${lastErr}` : ""}`);
}

async function fetchPaused(program, configPda) {
  const cfg = await program.account.config.fetch(configPda);
  return !!cfg.paused;
}

async function buildUpdateConfigIx(program, opsVaultPda, configPda, paused) {
  return program.methods
    .updateConfig({
      feeBps: null,
      ticketUnit: null,
      roundDurationSec: null,
      minParticipants: null,
      minTotalTickets: null,
      paused,
      maxDepositPerUser: null,
    })
    .accounts({
      admin: opsVaultPda,
      config: configPda,
    })
    .instruction();
}

async function submitSquadsUpdate({
  connection,
  program,
  opsMultisigPda,
  opsVaultPda,
  configPda,
  signer1,
  signer2,
  paused,
}) {
  const sendOptions = {
    skipPreflight: true,
    preflightCommitment: "processed",
    maxRetries: 80,
  };
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, opsMultisigPda);
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;

  const ix = await buildUpdateConfigIx(program, opsVaultPda, configPda, paused);
  const { blockhash } = await connection.getLatestBlockhash();

  const sigCreateTx = await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    creator: signer1.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: new TransactionMessage({
      payerKey: opsVaultPda,
      recentBlockhash: blockhash,
      instructions: [ix],
    }),
    sendOptions,
  });
  await confirmOrThrow(connection, sigCreateTx, `vaultTransactionCreate(tx=${txIndex})`);

  const sigProposal = await multisig.rpc.proposalCreate({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    creator: signer1,
    sendOptions,
  });
  await confirmOrThrow(connection, sigProposal, `proposalCreate(tx=${txIndex})`);

  const sigApprove1 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer1,
    sendOptions,
  });
  await confirmOrThrow(connection, sigApprove1, `proposalApprove#1(tx=${txIndex})`);

  const sigApprove2 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer2,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer2,
    sendOptions,
  });
  await confirmOrThrow(connection, sigApprove2, `proposalApprove#2(tx=${txIndex})`);

  const sigExecute = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer1.publicKey,
    sendOptions,
  });
  await confirmOrThrow(connection, sigExecute, `vaultTransactionExecute(tx=${txIndex})`);

  return {
    txIndex: txIndex.toString(),
    paused,
    signatures: {
      vaultTransactionCreate: sigCreateTx,
      proposalCreate: sigProposal,
      proposalApprove1: sigApprove1,
      proposalApprove2: sigApprove2,
      vaultTransactionExecute: sigExecute,
    },
  };
}

async function main() {
  const defaults = getDefaults();

  const rpcUrl = envOrDefault("RPC_URL", defaults.rpcUrl);
  const opsMultisigPda = new PublicKey(envOrDefault("OPS_MULTISIG_PDA", defaults.opsMultisigPda));
  const opsVaultPda = new PublicKey(envOrDefault("OPS_VAULT_PDA", defaults.opsVaultPda));
  const programId = new PublicKey(envOrDefault("PROGRAM_ID", defaults.programId));
  const configPda = new PublicKey(envOrDefault("CONFIG_PDA", defaults.configPda));
  const signer1Path = process.env.SIGNER1_KEYPAIR_PATH;
  const signer2Path = process.env.SIGNER2_KEYPAIR_PATH;
  const runBoth = toBool(process.env.RUN_BOTH, true);

  if (!signer1Path || !signer2Path) {
    throw new Error("SIGNER1_KEYPAIR_PATH and SIGNER2_KEYPAIR_PATH are required");
  }

  const signer1 = loadKeypair(path.resolve(REPO_ROOT, signer1Path));
  const signer2 = loadKeypair(path.resolve(REPO_ROOT, signer2Path));

  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(signer1), { commitment: "confirmed" });
  const idl = { ...defaults.idl, address: programId.toBase58() };
  const program = new Program(idl, provider);

  console.log("=== Squads Ops Smoke Test ===");
  console.log("RPC:", rpcUrl);
  console.log("Program:", programId.toBase58());
  console.log("Ops multisig:", opsMultisigPda.toBase58());
  console.log("Ops vault:", opsVaultPda.toBase58());
  console.log("Config PDA:", configPda.toBase58());
  console.log("Signer1:", signer1.publicKey.toBase58());
  console.log("Signer2:", signer2.publicKey.toBase58());
  console.log();

  const before = await fetchPaused(program, configPda);
  console.log("paused before:", before);

  const results = [];
  if (runBoth) {
    results.push(await submitSquadsUpdate({
      connection,
      program,
      opsMultisigPda,
      opsVaultPda,
      configPda,
      signer1,
      signer2,
      paused: true,
    }));
    console.log("paused after true:", await fetchPaused(program, configPda));

    results.push(await submitSquadsUpdate({
      connection,
      program,
      opsMultisigPda,
      opsVaultPda,
      configPda,
      signer1,
      signer2,
      paused: false,
    }));
    console.log("paused after false:", await fetchPaused(program, configPda));
  } else {
    const targetPaused = toBool(process.env.TARGET_PAUSED, true);
    results.push(await submitSquadsUpdate({
      connection,
      program,
      opsMultisigPda,
      opsVaultPda,
      configPda,
      signer1,
      signer2,
      paused: targetPaused,
    }));
    console.log("paused after single run:", await fetchPaused(program, configPda));
  }

  console.log();
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error("Smoke test failed:", e);
  process.exit(1);
});
