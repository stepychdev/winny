/* eslint-env node */
/**
 * Squads Upgrade multisig: update timeLock (timelock) via ConfigTransaction.
 *
 * This updates the Upgrade Squads multisig configuration (NOT the jackpot program).
 * Flow: configTransactionCreate -> proposalCreate -> approve x2 -> configTransactionExecute
 *
 * Typical use:
 *   # Temporarily disable upgrade timelock for fast iteration (will still respect current timelock)
 *   TARGET_TIMELOCK_SEC=0
 *
 *   # Restore production timelock after upgrade sprint
 *   TARGET_TIMELOCK_SEC=43200
 *
 * Required env:
 *   SIGNER1_KEYPAIR_PATH=./multisig-signer1.json
 *   SIGNER2_KEYPAIR_PATH=./multisig-signer2.json
 *
 * Optional env:
 *   RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
 *   UPGRADE_MULTISIG_PDA=...
 *   TARGET_TIMELOCK_SEC=0
 *   EXECUTE=1
 *   WAIT_FOR_TIMELOCK=0        # if 1, retries execute until timelock passes
 *   EXECUTE_RETRY_SEC=15
 *   MAX_WAIT_SEC=900
 *   SKIP_PREFLIGHT=false
 *   EXECUTE_ONLY_TX_INDEX=3     # execute existing approved config tx only (skip create/propose/approve)
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

function loadKeypair(filePath, Keypair) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
  return Keypair.fromSecretKey(Uint8Array.from(readJson(resolved)));
}

function envOr(name, fallback) {
  return process.env[name] || fallback;
}

function toBool(v, dflt) {
  if (v == null) return dflt;
  return v === "1" || v === "true" || v === "TRUE";
}

function toInt(v, dflt) {
  const n = Number(v ?? dflt);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer: ${v}`);
  return n;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getDefaults() {
  const mainnetPath = path.resolve(REPO_ROOT, "addresses.mainnet.json");
  if (!fs.existsSync(mainnetPath)) {
    throw new Error(`Missing ${mainnetPath}`);
  }
  const addresses = readJson(mainnetPath);
  const m = addresses.mainnet;
  return {
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=0e2371ae-b591-4662-b358-d47ccdb77906",
    upgradeMultisigPda: m.squads.upgrade.multisig_pda,
    expectedCurrentTimelockSec: m.squads.upgrade.timelock_sec ?? null,
  };
}

async function confirmStatus(connection, signature, label, timeoutMs = 180_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const res = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const s = res?.value?.[0];
    if (s) {
      last = s.confirmationStatus ?? "processed";
      if (s.err) throw new Error(`${label} failed: ${JSON.stringify(s.err)} (${signature})`);
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
        return s.confirmationStatus;
      }
    }
    await sleep(1500);
  }
  throw new Error(`${label} not confirmed in ${timeoutMs / 1000}s (last=${last}) sig=${signature}`);
}

async function tryExecuteWithOptionalWait({
  multisig,
  connection,
  feePayer,
  member,
  rentPayer,
  multisigPda,
  txIndex,
  sendOptions,
  waitForTimelock,
  executeRetrySec,
  maxWaitSec,
}) {
  const started = Date.now();
  let lastErr = "";
  while (true) {
    try {
      const sig = await multisig.rpc.configTransactionExecute({
        connection,
        feePayer,
        multisigPda,
        transactionIndex: txIndex,
        member,
        rentPayer,
        sendOptions,
      });
      await confirmStatus(connection, sig, "configTransactionExecute");
      return { executed: true, signature: sig, waitedSec: Math.round((Date.now() - started) / 1000) };
    } catch (e) {
      const msg = String(e?.message || e);
      lastErr = msg;
      if (!waitForTimelock) throw e;
      if ((Date.now() - started) / 1000 > maxWaitSec) {
        return {
          executed: false,
          signature: null,
          waitedSec: maxWaitSec,
          error: `Timed out waiting for timelock. Last error: ${lastErr}`,
        };
      }
      if (/time.?lock|not ready|cannot execute|cooldown|TimeLockNotReleased/i.test(msg)) {
        console.log(`  Waiting for timelock... retry in ${executeRetrySec}s`);
        await sleep(executeRetrySec * 1000);
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  const defaults = getDefaults();
  const multisig = await import("@sqds/multisig");
  const web3 = await import("@solana/web3.js");

  const { Connection, PublicKey, Keypair } = web3;

  const rpcUrl = envOr("RPC_URL", defaults.rpcUrl);
  const upgradeMultisigPda = new PublicKey(
    envOr("UPGRADE_MULTISIG_PDA", defaults.upgradeMultisigPda)
  );
  const targetTimelockSec = toInt(process.env.TARGET_TIMELOCK_SEC, 0);
  const execute = toBool(process.env.EXECUTE, true);
  const waitForTimelock = toBool(process.env.WAIT_FOR_TIMELOCK, false);
  const executeRetrySec = toInt(process.env.EXECUTE_RETRY_SEC, 15);
  const maxWaitSec = toInt(process.env.MAX_WAIT_SEC, 900);
  const skipPreflight = toBool(process.env.SKIP_PREFLIGHT, false);
  const executeOnlyTxIndex = process.env.EXECUTE_ONLY_TX_INDEX
    ? BigInt(process.env.EXECUTE_ONLY_TX_INDEX)
    : null;

  const signer1Path = process.env.SIGNER1_KEYPAIR_PATH;
  const signer2Path = process.env.SIGNER2_KEYPAIR_PATH;
  if (!signer1Path || !signer2Path) {
    throw new Error("SIGNER1_KEYPAIR_PATH and SIGNER2_KEYPAIR_PATH are required");
  }

  const signer1 = loadKeypair(signer1Path, Keypair);
  const signer2 = loadKeypair(signer2Path, Keypair);
  const connection = new Connection(rpcUrl, "confirmed");

  const sendOptions = {
    skipPreflight,
    preflightCommitment: "processed",
    maxRetries: 10,
  };

  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, upgradeMultisigPda);
  const currentTimelock = Number(ms.timeLock);
  const txIndex = executeOnlyTxIndex ?? (BigInt(ms.transactionIndex.toString()) + 1n);

  console.log("=== Update Upgrade Multisig Timelock ===");
  console.log("RPC:", rpcUrl);
  console.log("Upgrade multisig:", upgradeMultisigPda.toBase58());
  console.log("Signer1:", signer1.publicKey.toBase58());
  console.log("Signer2:", signer2.publicKey.toBase58());
  console.log("Current timelock (on-chain):", currentTimelock, "sec");
  if (defaults.expectedCurrentTimelockSec != null) {
    console.log("Expected timelock (addresses.mainnet.json):", defaults.expectedCurrentTimelockSec, "sec");
  }
  if (!executeOnlyTxIndex) {
    console.log("Target timelock:", targetTimelockSec, "sec");
  }
  console.log("Squads tx index:", txIndex.toString());
  console.log("Execute-only mode:", Boolean(executeOnlyTxIndex));
  console.log("Will execute:", execute, "| Wait for timelock:", waitForTimelock);
  console.log();

  if (!executeOnlyTxIndex && currentTimelock === targetTimelockSec) {
    console.log("No-op: current timelock already equals target.");
    return;
  }

  const actions = [
    {
      __kind: "SetTimeLock",
      newTimeLock: targetTimelockSec,
    },
  ];

  let sig1 = null;
  let sig2 = null;
  let sig3 = null;
  let sig4 = null;

  if (!executeOnlyTxIndex) {
    console.log("[1/5] configTransactionCreate...");
    sig1 = await multisig.rpc.configTransactionCreate({
      connection,
      feePayer: signer1,
      multisigPda: upgradeMultisigPda,
      transactionIndex: txIndex,
      creator: signer1.publicKey,
      actions,
      sendOptions,
    });
    console.log("  sig:", sig1);
    await confirmStatus(connection, sig1, "configTransactionCreate");
    console.log("  ✓ confirmed");

    console.log("[2/5] proposalCreate...");
    sig2 = await multisig.rpc.proposalCreate({
      connection,
      feePayer: signer1,
      multisigPda: upgradeMultisigPda,
      transactionIndex: txIndex,
      creator: signer1,
      sendOptions,
    });
    console.log("  sig:", sig2);
    await confirmStatus(connection, sig2, "proposalCreate");
    console.log("  ✓ confirmed");

    console.log("[3/5] approve(signer1)...");
    sig3 = await multisig.rpc.proposalApprove({
      connection,
      feePayer: signer1,
      multisigPda: upgradeMultisigPda,
      transactionIndex: txIndex,
      member: signer1,
      sendOptions,
    });
    console.log("  sig:", sig3);
    await confirmStatus(connection, sig3, "proposalApprove#1");
    console.log("  ✓ confirmed");

    console.log("[4/5] approve(signer2)...");
    sig4 = await multisig.rpc.proposalApprove({
      connection,
      feePayer: signer2,
      multisigPda: upgradeMultisigPda,
      transactionIndex: txIndex,
      member: signer2,
      sendOptions,
    });
    console.log("  sig:", sig4);
    await confirmStatus(connection, sig4, "proposalApprove#2");
    console.log("  ✓ confirmed");
  } else {
    console.log("[execute-only] Skipping create/proposal/approve");
  }

  let executeResult = null;
  if (execute) {
    console.log("[5/5] configTransactionExecute...");
    executeResult = await tryExecuteWithOptionalWait({
      multisig,
      connection,
      feePayer: signer1,
      member: signer1,
      rentPayer: signer1,
      multisigPda: upgradeMultisigPda,
      txIndex,
      sendOptions,
      waitForTimelock,
      executeRetrySec,
      maxWaitSec,
    });
    if (executeResult.executed) {
      console.log("  sig:", executeResult.signature);
      console.log("  ✓ executed");
    } else {
      console.log("  ⚠ execute pending:", executeResult.error);
    }
  }

  const msAfter = await multisig.accounts.Multisig.fromAccountAddress(connection, upgradeMultisigPda);
  console.log();
  console.log("AFTER:");
  console.log("  timelock:", Number(msAfter.timeLock), "sec");
  console.log();
  console.log("Summary:");
  console.log(JSON.stringify({
    multisig: upgradeMultisigPda.toBase58(),
    targetTimelockSec: executeOnlyTxIndex ? null : targetTimelockSec,
    txIndex: txIndex.toString(),
    signatures: {
      configTransactionCreate: sig1,
      proposalCreate: sig2,
      approve1: sig3,
      approve2: sig4,
      execute: executeResult?.signature ?? null,
    },
    executed: executeResult?.executed ?? false,
  }, null, 2));
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
