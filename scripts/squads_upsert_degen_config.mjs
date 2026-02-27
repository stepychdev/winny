/* eslint-env node */
/**
 * Squads Ops: upsert_degen_config(executor, fallback_timeout_sec).
 *
 * Uses the Ops Squads multisig because config.admin on mainnet is the Ops vault.
 *
 * Required env:
 *   SIGNER1_KEYPAIR_PATH=./multisig-signer1.json
 *   SIGNER2_KEYPAIR_PATH=./multisig-signer2.json
 *   DEGEN_EXECUTOR_PUBKEY=<executor wallet pubkey>
 *
 * Optional env:
 *   RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
 *   DEGEN_FALLBACK_TIMEOUT_SEC=300
 *   OPS_MULTISIG_PDA=...
 *   OPS_VAULT_PDA=...
 *   PROGRAM_ID=...
 *   CONFIG_PDA=...
 *   DEGEN_CONFIG_PDA=...
 *
 * Recommended runtime:
 *   npx -y node@20 scripts/squads_upsert_degen_config.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

async function importOrExit(specifier, hint) {
  try {
    return await import(specifier);
  } catch (e) {
    console.error(`Failed to import ${specifier}: ${e?.message}`);
    if (hint) console.error(hint);
    process.exit(1);
  }
}

const multisig = await importOrExit("@sqds/multisig");
const web3 = await importOrExit("@solana/web3.js");
const anchor = await importOrExit("@coral-xyz/anchor");

const { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage } = web3;
const anchorMod = anchor.default || anchor;
const { AnchorProvider, Program, Wallet } = anchorMod;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function loadKeypair(filePath) {
  return Keypair.fromSecretKey(Uint8Array.from(readJson(filePath)));
}

function envOr(name, fallback) {
  return process.env[name] || fallback;
}

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function getDefaults() {
  let addrPath = path.resolve(REPO_ROOT, "addresses.mainnet.json");
  let prefix = "mainnet";
  if (!fs.existsSync(addrPath)) {
    addrPath = path.resolve(REPO_ROOT, "addresses.json");
    prefix = "devnet";
  }

  const addresses = readJson(addrPath);
  const idl = readJson(path.resolve(REPO_ROOT, "src/idl/jackpot.json"));
  const net = addresses[prefix];

  const programId = net.program.jackpot_program_id || idl.address;
  const [degenConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("degen_cfg")],
    new PublicKey(programId)
  );

  return {
    rpcUrl:
      prefix === "mainnet"
        ? "https://api.mainnet-beta.solana.com"
        : "https://api.devnet.solana.com",
    opsMultisigPda: net.squads.ops.multisig_pda,
    opsVaultPda: net.squads.ops.vault_pda_index_0,
    programId,
    configPda: net.protocol_config.config_pda,
    degenConfigPda: degenConfigPda.toBase58(),
    idl,
  };
}

async function confirmTx(connection, signature, label, timeoutMs = 120_000) {
  console.log(`  ⏳ Confirming ${label} …  sig=${signature.slice(0, 20)}…`);
  const t0 = Date.now();
  let lastStatus = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const s = res?.value?.[0];
      if (s) {
        lastStatus = s.confirmationStatus;
        if (s.err) {
          throw new Error(
            `${label} FAILED on-chain: ${JSON.stringify(s.err)}  sig=${signature}`
          );
        }
        if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`  ✅ ${label} ${s.confirmationStatus} in ${elapsed}s`);
          return;
        }
      }
    } catch (e) {
      if (e.message.includes("FAILED on-chain")) throw e;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `${label} NOT confirmed after ${timeoutMs / 1000}s. lastStatus=${lastStatus}  sig=${signature}`
  );
}

async function buildUpsertDegenConfigIx({
  program,
  admin,
  configPda,
  degenConfigPda,
  executor,
  fallbackTimeoutSec,
}) {
  return program.methods
    .upsertDegenConfig({
      executor,
      fallbackTimeoutSec,
    })
    .accounts({
      admin,
      config: configPda,
      degenConfig: degenConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

async function main() {
  const defaults = getDefaults();

  const rpcUrl = envOr("RPC_URL", defaults.rpcUrl);
  const opsMultisigPda = new PublicKey(envOr("OPS_MULTISIG_PDA", defaults.opsMultisigPda));
  const opsVaultPda = new PublicKey(envOr("OPS_VAULT_PDA", defaults.opsVaultPda));
  const programId = new PublicKey(envOr("PROGRAM_ID", defaults.programId));
  const configPda = new PublicKey(envOr("CONFIG_PDA", defaults.configPda));
  const degenConfigPda = new PublicKey(envOr("DEGEN_CONFIG_PDA", defaults.degenConfigPda));

  const signer1 = loadKeypair(envOr("SIGNER1_KEYPAIR_PATH", path.resolve(REPO_ROOT, "multisig-signer1.json")));
  const signer2 = loadKeypair(envOr("SIGNER2_KEYPAIR_PATH", path.resolve(REPO_ROOT, "multisig-signer2.json")));
  const executor = new PublicKey(mustEnv("DEGEN_EXECUTOR_PUBKEY"));
  const fallbackTimeoutSec = Number(envOr("DEGEN_FALLBACK_TIMEOUT_SEC", "300"));
  if (!Number.isFinite(fallbackTimeoutSec) || fallbackTimeoutSec < 0) {
    throw new Error("DEGEN_FALLBACK_TIMEOUT_SEC must be a non-negative integer");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(signer1), {
    commitment: "confirmed",
  });
  const idl = { ...(defaults.idl), address: programId.toBase58() };
  const program = new Program(idl, provider);

  console.log("RPC:", rpcUrl);
  console.log("Ops multisig:", opsMultisigPda.toBase58());
  console.log("Ops vault:", opsVaultPda.toBase58());
  console.log("Program:", programId.toBase58());
  console.log("Config:", configPda.toBase58());
  console.log("Degen config:", degenConfigPda.toBase58());
  console.log("Executor:", executor.toBase58());
  console.log("Fallback timeout sec:", fallbackTimeoutSec);
  console.log("Signer1:", signer1.publicKey.toBase58());
  console.log("Signer2:", signer2.publicKey.toBase58());

  const sendOptions = {
    skipPreflight: false,
    preflightCommitment: "processed",
    maxRetries: 10,
  };

  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, opsMultisigPda);
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;
  console.log(`\n── Step 1: vaultTransactionCreate  (Squads tx #${txIndex}) ──`);

  const ix = await buildUpsertDegenConfigIx({
    program,
    admin: opsVaultPda,
    configPda,
    degenConfigPda,
    executor,
    fallbackTimeoutSec,
  });

  const { blockhash } = await connection.getLatestBlockhash("finalized");

  const sig1 = await multisig.rpc.vaultTransactionCreate({
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
  await confirmTx(connection, sig1, "vaultTransactionCreate");

  console.log("── Step 2: proposalCreate ──");
  const sig2 = await multisig.rpc.proposalCreate({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    creator: signer1,
    sendOptions,
  });
  await confirmTx(connection, sig2, "proposalCreate");

  console.log("── Step 3: proposalApprove (signer1) ──");
  const sig3 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer1,
    sendOptions,
  });
  await confirmTx(connection, sig3, "proposalApprove#1");

  console.log("── Step 4: proposalApprove (signer2) ──");
  const sig4 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer2,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer2,
    sendOptions,
  });
  await confirmTx(connection, sig4, "proposalApprove#2");

  console.log("── Step 5: vaultTransactionExecute ──");
  const sig5 = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer1.publicKey,
    sendOptions,
  });
  await confirmTx(connection, sig5, "vaultTransactionExecute");

  const degenCfg = await program.account.degenConfig.fetch(degenConfigPda);

  console.log(
    JSON.stringify(
      {
        txIndex: txIndex.toString(),
        executor: new PublicKey(degenCfg.executor).toBase58(),
        fallbackTimeoutSec: Number(degenCfg.fallbackTimeoutSec),
        signatures: {
          vaultTransactionCreate: sig1,
          proposalCreate: sig2,
          approve1: sig3,
          approve2: sig4,
          execute: sig5,
        },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("squads_upsert_degen_config failed:", e);
  process.exit(1);
});
