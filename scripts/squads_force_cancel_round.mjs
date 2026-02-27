/* eslint-env node */
/**
 * Squads Ops: admin_force_cancel(round_id) — force cancel a round and let
 * participants claim refunds via claim_refund.
 *
 * Usage:
 *   ROUND_ID=90 \
 *   SIGNER1_KEYPAIR_PATH=./multisig-signer1.json \
 *   SIGNER2_KEYPAIR_PATH=./multisig-signer2.json \
 *   node scripts/squads_force_cancel_round.mjs
 *
 * Optional env:
 *   RPC_URL=https://api.mainnet-beta.solana.com
 *   OPS_MULTISIG_PDA=...
 *   OPS_VAULT_PDA=...
 *   PROGRAM_ID=...
 *   CONFIG_PDA=...
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

const { Connection, Keypair, PublicKey, TransactionMessage } = web3;
const anchorMod = anchor.default || anchor;
const { AnchorProvider, Program, Wallet, BN } = anchorMod;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function loadKeypair(filePath) {
  return Keypair.fromSecretKey(Uint8Array.from(readJson(filePath)));
}

function envOr(name, fallback) {
  return process.env[name] || fallback;
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

  return {
    rpcUrl: prefix === "mainnet"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com",
    opsMultisigPda: net.squads.ops.multisig_pda,
    opsVaultPda: net.squads.ops.vault_pda_index_0,
    programId: net.program.jackpot_program_id || idl.address,
    configPda: net.protocol_config.config_pda,
    idl,
  };
}

/* ── Confirmation helper ────────────────────────────────────────────────── */

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
        if (
          s.confirmationStatus === "confirmed" ||
          s.confirmationStatus === "finalized"
        ) {
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

/* ── Build admin_force_cancel instruction ─────────────────────────────── */

async function buildForceCancelIx(program, admin, configPda, roundId) {
  const roundIdBn = new BN(roundId);
  const [roundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), roundIdBn.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  return program.methods
    .adminForceCancel(roundIdBn)
    .accounts({
      admin,
      config: configPda,
      round: roundPda,
    })
    .instruction();
}

/* ── Submit Squads proposal ──────────────────────────────────────────── */

async function submitSquadsForceCancel({
  connection,
  program,
  opsMultisigPda,
  opsVaultPda,
  configPda,
  signer1,
  signer2,
  roundId,
}) {
  const sendOptions = {
    skipPreflight: true,
    preflightCommitment: "processed",
    maxRetries: 10,
  };

  /* 1. Read current tx index */
  const ms = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    opsMultisigPda
  );
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;
  console.log(`\n── Step 1: vaultTransactionCreate  (Squads tx #${txIndex}) ──`);

  const ix = await buildForceCancelIx(program, opsVaultPda, configPda, roundId);

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

  /* 2. Proposal create */
  console.log(`── Step 2: proposalCreate ──`);
  const sig2 = await multisig.rpc.proposalCreate({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    creator: signer1,
    sendOptions,
  });
  await confirmTx(connection, sig2, "proposalCreate");

  /* 3. Approve #1 */
  console.log(`── Step 3: proposalApprove (signer1) ──`);
  const sig3 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer1,
    sendOptions,
  });
  await confirmTx(connection, sig3, "proposalApprove#1");

  /* 4. Approve #2 */
  console.log(`── Step 4: proposalApprove (signer2) ──`);
  const sig4 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer2,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer2,
    sendOptions,
  });
  await confirmTx(connection, sig4, "proposalApprove#2");

  /* 5. Execute */
  console.log(`── Step 5: vaultTransactionExecute ──`);
  const sig5 = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: signer1,
    multisigPda: opsMultisigPda,
    transactionIndex: txIndex,
    member: signer1.publicKey,
    sendOptions,
  });
  await confirmTx(connection, sig5, "vaultTransactionExecute");

  return {
    txIndex: txIndex.toString(),
    signatures: {
      vaultTransactionCreate: sig1,
      proposalCreate: sig2,
      approve1: sig3,
      approve2: sig4,
      execute: sig5,
    },
  };
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main() {
  const roundId = parseInt(process.env.ROUND_ID, 10);
  if (!roundId || isNaN(roundId)) {
    throw new Error("Set ROUND_ID env variable (e.g. ROUND_ID=90)");
  }

  const defaults = getDefaults();

  const rpcUrl = envOr("RPC_URL", defaults.rpcUrl);
  const opsMultisigPda = new PublicKey(envOr("OPS_MULTISIG_PDA", defaults.opsMultisigPda));
  const opsVaultPda = new PublicKey(envOr("OPS_VAULT_PDA", defaults.opsVaultPda));
  const programId = new PublicKey(envOr("PROGRAM_ID", defaults.programId));
  const configPda = new PublicKey(envOr("CONFIG_PDA", defaults.configPda));

  const signer1Path = process.env.SIGNER1_KEYPAIR_PATH;
  const signer2Path = process.env.SIGNER2_KEYPAIR_PATH;
  if (!signer1Path || !signer2Path) {
    throw new Error("Set SIGNER1_KEYPAIR_PATH and SIGNER2_KEYPAIR_PATH");
  }

  const signer1 = loadKeypair(path.resolve(signer1Path));
  const signer2 = loadKeypair(path.resolve(signer2Path));

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 120_000,
  });
  const provider = new AnchorProvider(connection, new Wallet(signer1), {
    commitment: "confirmed",
  });
  const idl = { ...defaults.idl, address: programId.toBase58() };
  const program = new Program(idl, provider);

  // Derive round PDA to check current state
  const roundIdBn = new BN(roundId);
  const [roundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), roundIdBn.toArrayLike(Buffer, "le", 8)],
    programId
  );

  console.log(`=== Force Cancel Round #${roundId} ===`);
  console.log("RPC:", rpcUrl);
  console.log("Program:", programId.toBase58());
  console.log("Round PDA:", roundPda.toBase58());
  console.log("Ops multisig:", opsMultisigPda.toBase58());
  console.log("Ops vault (admin):", opsVaultPda.toBase58());
  console.log("Signer1:", signer1.publicKey.toBase58());
  console.log("Signer2:", signer2.publicKey.toBase58());
  console.log();

  // Fetch current round state
  try {
    const roundData = await program.account.round.fetch(roundPda);
    const statusMap = { 0: "Open", 1: "Locked", 2: "VrfRequested", 3: "Settled", 4: "Claimed", 5: "Cancelled" };
    const statusName = statusMap[roundData.status] || `Unknown(${roundData.status})`;
    console.log("Round state BEFORE:");
    console.log("  status:", statusName);
    console.log("  participants:", roundData.participantsCount?.toString());
    console.log("  total_usdc:", roundData.totalUsdc?.toString());
    console.log("  total_tickets:", roundData.totalTickets?.toString());
    console.log();

    if (roundData.status === 5) {
      console.log("⚠ Round is already cancelled. Nothing to do.");
      return;
    }
    if (roundData.status === 4) {
      console.log("⚠ Round is already claimed. Cannot force cancel.");
      return;
    }
  } catch (e) {
    console.error(`⚠ Could not fetch round #${roundId}:`, e.message);
    console.error("Round PDA may not exist or already closed.");
    return;
  }

  const result = await submitSquadsForceCancel({
    connection,
    program,
    opsMultisigPda,
    opsVaultPda,
    configPda,
    signer1,
    signer2,
    roundId,
  });

  // Verify
  try {
    const roundAfter = await program.account.round.fetch(roundPda);
    const statusMap = { 0: "Open", 1: "Locked", 2: "VrfRequested", 3: "Settled", 4: "Claimed", 5: "Cancelled" };
    console.log("\nRound state AFTER:");
    console.log("  status:", statusMap[roundAfter.status] || roundAfter.status);
    console.log("  total_usdc:", roundAfter.totalUsdc?.toString());
    console.log();
  } catch (e) {
    console.log("⚠ Could not verify round state:", e.message);
  }

  console.log("✅ Round force-cancelled. Participants can now call claim_refund.");
  console.log("   The crank will handle cleanup (close PDAs + close round) automatically.");
  console.log(JSON.stringify({ ok: true, roundId, result }, null, 2));
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e.message || e);
  if (e.logs) console.error("Logs:", e.logs);
  process.exit(1);
});
