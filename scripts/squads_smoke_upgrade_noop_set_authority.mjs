/**
 * Squads Upgrade smoke test (no-op): execute BPF Upgradeable Loader SetAuthority
 * with the SAME authority (Upgrade vault -> Upgrade vault).
 *
 * Why this script exists:
 * - It validates the real Upgrade multisig execution path against the loader program
 * - It does NOT deploy a new binary
 * - It does NOT change your effective upgrade authority (no-op authority set)
 *
 * Uses Squads V4 multisig (SDK method naming still uses V2/VaultTransaction APIs).
 *
 * Defaults are loaded from `../addresses.json` (devnet):
 * - upgrade multisig PDA
 * - upgrade vault PDA
 * - jackpot program id
 * - programData address
 *
 * Required env:
 *   SIGNER1_KEYPAIR_PATH=./keypar.json
 *   SIGNER2_KEYPAIR_PATH=/path/to/second-upgrade-member.json
 *
 * Optional env:
 *   RPC_URL=https://api.devnet.solana.com
 *   UPGRADE_MULTISIG_PDA=...
 *   UPGRADE_VAULT_PDA=...
 *   PROGRAM_ID=...
 *   PROGRAM_DATA_PDA=...
 *   EXECUTE=1                  # default 1
 *   WAIT_FOR_TIMELOCK=0        # default 0; if 1, retries execute until timelock passes
 *   EXECUTE_RETRY_SEC=10       # polling interval while waiting timelock
 *   MAX_WAIT_SEC=900           # max wait time for timelock execution
 *
 * Recommended runtime:
 *   npx -y node@20 scripts/squads_smoke_upgrade_noop_set_authority.mjs
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

function loadKeypair(filePath, { repoRelative = true } = {}) {
  const resolved = repoRelative ? path.resolve(REPO_ROOT, filePath) : filePath;
  return (async () => {
    const { Keypair } = await import("@solana/web3.js");
    return Keypair.fromSecretKey(Uint8Array.from(readJson(resolved)));
  })();
}

function envOrDefault(name, fallback) {
  return process.env[name] || fallback;
}

function toBool(v, dflt) {
  if (v == null) return dflt;
  return v === "1" || v === "true" || v === "TRUE";
}

function toInt(v, dflt) {
  const n = Number(v ?? dflt);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${v}`);
  return n;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getDefaults() {
  const addressesPath = path.resolve(REPO_ROOT, "addresses.json");
  const addresses = readJson(addressesPath);
  const devnet = addresses.devnet;
  return {
    rpcUrl: "https://api.devnet.solana.com",
    upgradeMultisigPda: devnet.squads.upgrade.multisig_pda,
    upgradeVaultPda: devnet.squads.upgrade.vault_pda_index_0,
    programId: devnet.program.jackpot_program_id,
    programDataPda: devnet.program.program_data,
    upgradeTimelockSec: devnet.squads.upgrade.timelock_sec ?? 0,
  };
}

async function confirmOrThrow(connection, signature, label) {
  const res = await connection.confirmTransaction(signature, "confirmed");
  if (res.value.err) {
    throw new Error(`${label} failed: ${JSON.stringify(res.value.err)} (${signature})`);
  }
}

function buildNoopSetUpgradeAuthorityIx({
  TransactionInstruction,
  PublicKey,
  programDataPda,
  upgradeVaultPda,
}) {
  // Upgradeable BPF Loader program id (loader-v3 / upgradeable loader)
  const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111"
  );

  // Loader v3 interface uses bincode enum encoding, not a raw single-byte tag.
  // `UpgradeableLoaderInstruction::SetAuthority` is variant index 4 encoded as u32 LE.
  const setAuthorityData = Buffer.alloc(4);
  setAuthorityData.writeUInt32LE(4, 0);

  // `UpgradeableLoaderInstruction::SetAuthority`
  // Account metas (program authority change):
  //   0. [writable] ProgramData account
  //   1. [signer]   current authority
  //   2. []         new authority (optional) — same vault PDA for no-op smoke test
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: programDataPda, isSigner: false, isWritable: true },
      { pubkey: upgradeVaultPda, isSigner: true, isWritable: false },
      { pubkey: upgradeVaultPda, isSigner: false, isWritable: false },
    ],
    data: setAuthorityData,
  });
}

async function executeWithOptionalTimelockWait({
  multisig,
  connection,
  signer1,
  upgradeMultisigPda,
  txIndex,
  waitForTimelock,
  executeRetrySec,
  maxWaitSec,
}) {
  const tryExecute = async () =>
    multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: signer1,
      multisigPda: upgradeMultisigPda,
      transactionIndex: txIndex,
      member: signer1.publicKey,
    });

  if (!waitForTimelock) {
    const sig = await tryExecute();
    await confirmOrThrow(connection, sig, `vaultTransactionExecute(tx=${txIndex})`);
    return { executed: true, executeSignature: sig, waitedSec: 0 };
  }

  const started = Date.now();
  let lastMessage = "";
  while ((Date.now() - started) / 1000 <= maxWaitSec) {
    try {
      const sig = await tryExecute();
      await confirmOrThrow(connection, sig, `vaultTransactionExecute(tx=${txIndex})`);
      return {
        executed: true,
        executeSignature: sig,
        waitedSec: Math.round((Date.now() - started) / 1000),
      };
    } catch (e) {
      const msg = String(e?.message || e);
      lastMessage = msg;
      // Timelock or proposal-not-ready: keep waiting.
      if (
        /time.?lock|not ready|cannot execute|cooldown|transaction not ready/i.test(msg) ||
        /Cannot set property logs of Error/i.test(msg)
      ) {
        console.log(`Waiting for timelock... retry in ${executeRetrySec}s`);
        await sleep(executeRetrySec * 1000);
        continue;
      }
      throw e;
    }
  }

  return {
    executed: false,
    executeSignature: null,
    waitedSec: maxWaitSec,
    error: `Timed out waiting for timelock/execute readiness. Last error: ${lastMessage}`,
  };
}

async function main() {
  const defaults = getDefaults();

  const multisig = await import("@sqds/multisig");
  const web3 = await import("@solana/web3.js");
  const {
    Connection,
    PublicKey,
    TransactionMessage,
  } = web3;

  const rpcUrl = envOrDefault("RPC_URL", defaults.rpcUrl);
  const upgradeMultisigPda = new PublicKey(
    envOrDefault("UPGRADE_MULTISIG_PDA", defaults.upgradeMultisigPda)
  );
  const upgradeVaultPda = new PublicKey(
    envOrDefault("UPGRADE_VAULT_PDA", defaults.upgradeVaultPda)
  );
  const programId = new PublicKey(envOrDefault("PROGRAM_ID", defaults.programId));
  const programDataPda = new PublicKey(
    envOrDefault("PROGRAM_DATA_PDA", defaults.programDataPda)
  );
  const signer1Path = process.env.SIGNER1_KEYPAIR_PATH;
  const signer2Path = process.env.SIGNER2_KEYPAIR_PATH;
  const execute = toBool(process.env.EXECUTE, true);
  const waitForTimelock = toBool(process.env.WAIT_FOR_TIMELOCK, false);
  const executeRetrySec = toInt(process.env.EXECUTE_RETRY_SEC, 10);
  const maxWaitSec = toInt(process.env.MAX_WAIT_SEC, 900);

  if (!signer1Path || !signer2Path) {
    throw new Error("SIGNER1_KEYPAIR_PATH and SIGNER2_KEYPAIR_PATH are required");
  }

  const signer1 = await loadKeypair(signer1Path);
  const signer2 = await loadKeypair(signer2Path);
  const connection = new Connection(rpcUrl, "confirmed");

  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, upgradeMultisigPda);
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;

  const ix = buildNoopSetUpgradeAuthorityIx({
    TransactionInstruction: web3.TransactionInstruction,
    PublicKey,
    programDataPda,
    upgradeVaultPda,
  });

  console.log("=== Squads Upgrade Smoke Test (No-op SetAuthority) ===");
  console.log("RPC:", rpcUrl);
  console.log("Program:", programId.toBase58());
  console.log("ProgramData:", programDataPda.toBase58());
  console.log("Upgrade multisig:", upgradeMultisigPda.toBase58());
  console.log("Upgrade vault:", upgradeVaultPda.toBase58());
  console.log("Signer1:", signer1.publicKey.toBase58());
  console.log("Signer2:", signer2.publicKey.toBase58());
  console.log("Expected timelock (addresses.json):", defaults.upgradeTimelockSec, "sec");
  console.log("Will execute:", execute, "| Wait for timelock:", waitForTimelock);
  console.log();

  const { blockhash } = await connection.getLatestBlockhash();

  const sigCreateTx = await multisig.rpc.vaultTransactionCreate({
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
      instructions: [ix],
    }),
  });
  await confirmOrThrow(connection, sigCreateTx, `vaultTransactionCreate(tx=${txIndex})`);

  const sigProposal = await multisig.rpc.proposalCreate({
    connection,
    feePayer: signer1,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    creator: signer1,
  });
  await confirmOrThrow(connection, sigProposal, `proposalCreate(tx=${txIndex})`);

  const sigApprove1 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer1,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    member: signer1,
  });
  await confirmOrThrow(connection, sigApprove1, `proposalApprove#1(tx=${txIndex})`);

  const sigApprove2 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer2,
    multisigPda: upgradeMultisigPda,
    transactionIndex: txIndex,
    member: signer2,
  });
  await confirmOrThrow(connection, sigApprove2, `proposalApprove#2(tx=${txIndex})`);

  let execResult = {
    executed: false,
    executeSignature: null,
    waitedSec: 0,
    error: null,
  };
  if (execute) {
    try {
      execResult = await executeWithOptionalTimelockWait({
        multisig,
        connection,
        signer1,
        upgradeMultisigPda,
        txIndex,
        waitForTimelock,
        executeRetrySec,
        maxWaitSec,
      });
    } catch (e) {
      execResult = {
        executed: false,
        executeSignature: null,
        waitedSec: 0,
        error: String(e?.message || e),
      };
    }
  }

  const out = {
    txIndex: txIndex.toString(),
    mode: "noop_set_upgrade_authority_same_vault",
    programId: programId.toBase58(),
    programDataPda: programDataPda.toBase58(),
    upgradeMultisigPda: upgradeMultisigPda.toBase58(),
    upgradeVaultPda: upgradeVaultPda.toBase58(),
    signatures: {
      vaultTransactionCreate: sigCreateTx,
      proposalCreate: sigProposal,
      proposalApprove1: sigApprove1,
      proposalApprove2: sigApprove2,
      vaultTransactionExecute: execResult.executeSignature,
    },
    execute: execResult,
    createdAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(out, null, 2));
  if (!execResult.executed) {
    console.log();
    console.log(
      "Note: If execution is pending due to timelock, rerun this script with " +
      "WAIT_FOR_TIMELOCK=1 or execute the proposal from Squads UI after timelock expires."
    );
  }
}

main().catch((e) => {
  console.error("Upgrade smoke test failed:", e);
  process.exit(1);
});
