/**
 * Create Squads V4 multisigs for Ops and Upgrade governance (2-of-3 by default).
 *
 * Naming note:
 * - Squads protocol/program = V4
 * - SDK method = `multisigCreateV2` (instruction/API version inside V4)
 *
 * Defaults:
 * - Members are loaded from `../addresses.json` (devnet.squads.members_2_of_3)
 * - Uses Squads ProgramConfig treasury automatically (required by newer SDKs)
 *
 * Recommended runtime:
 *   npx -y node@20 scripts/create_squads_multisigs.mjs
 *
 * Required env:
 *   CREATOR_KEYPAIR_PATH=./keypar.json
 *
 * Optional env:
 *   RPC_URL=https://api.devnet.solana.com
 *   MEMBERS=pk1,pk2,pk3
 *   THRESHOLD=2
 *   OPS_TIMELOCK_SEC=0
 *   UPGRADE_TIMELOCK_SEC=600
 *   OUTPUT_JSON_PATH=./squads_multisigs_out.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as multisig from "@sqds/multisig";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function loadKeypair(filePath) {
  return Keypair.fromSecretKey(Uint8Array.from(readJson(filePath)));
}

function parseMembers(raw, fallback) {
  const list = (raw || fallback || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length < 3) {
    throw new Error("Need at least 3 members (MEMBERS env or addresses.json devnet.squads.members_2_of_3)");
  }
  return list.map((s) => new PublicKey(s));
}

function asInt(v, dflt) {
  const n = Number(v ?? dflt);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value: ${v}`);
  return n;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAccount(connection, pubkey, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const info = await connection.getAccountInfo(pubkey, "confirmed");
    if (info) return true;
    await sleep(1_500);
  }
  return false;
}

async function getSquadsProtocolTreasury(connection) {
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda
  );
  return {
    programConfigPda,
    treasury: programConfig.treasury,
    multisigCreationFee: programConfig.multisigCreationFee,
  };
}

async function createMultisig({
  connection,
  creator,
  protocolTreasury,
  threshold,
  members,
  timeLock,
  cuPriceMicroLamports,
  cuLimit,
}) {
  const { Permission, Permissions } = multisig.types;
  const sdkMembers = members.map((m) => ({
    key: m,
    permissions: Permissions.fromPermissions([
      Permission.Initiate,
      Permission.Vote,
      Permission.Execute,
    ]),
  }));

  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const createKey = Keypair.generate();
    const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
    const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
    try {
      const ix = multisig.instructions.multisigCreateV2({
        treasury: protocolTreasury,
        createKey: createKey.publicKey,
        creator: creator.publicKey,
        multisigPda,
        configAuthority: null,
        threshold,
        members: sdkMembers,
        timeLock,
        rentCollector: null,
      });
      const { blockhash } = await connection.getLatestBlockhash("processed");
      const message = new TransactionMessage({
        payerKey: creator.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPriceMicroLamports }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
          ix,
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);
      tx.sign([creator, createKey]);
      const createSignature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: "processed",
        maxRetries: 30,
      });

      const created = await waitForAccount(connection, multisigPda, 90_000);
      if (!created) {
        throw new Error(`Multisig PDA not found on-chain after tx ${createSignature}`);
      }

      return {
        createKey: createKey.publicKey.toBase58(),
        multisigPda: multisigPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        vaultIndex: 0,
        threshold,
        timeLock,
        createSignature,
      };
    } catch (e) {
      lastError = e;
      if (attempt < 4) {
        await sleep(2_000 * attempt);
      }
    }
  }
  throw new Error(`Failed to create multisig after retries: ${lastError?.message || lastError}`);
}

async function main() {
  const addressesPath = path.resolve(REPO_ROOT, "addresses.json");
  const defaults = fs.existsSync(addressesPath) ? readJson(addressesPath) : null;
  const defaultMembers = defaults?.devnet?.squads?.members_2_of_3?.join(",");

  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const creatorKeypairPath = path.resolve(REPO_ROOT, process.env.CREATOR_KEYPAIR_PATH || "./keypar.json");
  const outputPath = process.env.OUTPUT_JSON_PATH
    ? path.resolve(REPO_ROOT, process.env.OUTPUT_JSON_PATH)
    : null;

  const members = parseMembers(process.env.MEMBERS, defaultMembers);
  const threshold = asInt(process.env.THRESHOLD, 2);
  const opsTimeLock = asInt(process.env.OPS_TIMELOCK_SEC, 0);
  const upgradeTimeLock = asInt(process.env.UPGRADE_TIMELOCK_SEC, 600);
  const cuPriceMicroLamports = asInt(process.env.CU_PRICE_MICROLAMPORTS, 500_000);
  const cuLimit = asInt(process.env.CU_LIMIT, 300_000);

  const connection = new Connection(rpcUrl, "confirmed");
  const creator = loadKeypair(creatorKeypairPath);
  const protocol = await getSquadsProtocolTreasury(connection);

  const ops = await createMultisig({
    connection,
    creator,
    protocolTreasury: protocol.treasury,
    threshold,
    members,
    timeLock: opsTimeLock,
    cuPriceMicroLamports,
    cuLimit,
  });
  const upgrade = await createMultisig({
    connection,
    creator,
    protocolTreasury: protocol.treasury,
    threshold,
    members,
    timeLock: upgradeTimeLock,
    cuPriceMicroLamports,
    cuLimit,
  });

  const out = {
    rpc: rpcUrl,
    creator: creator.publicKey.toBase58(),
    squadsProgramConfigPda: protocol.programConfigPda.toBase58(),
    squadsProtocolTreasury: protocol.treasury.toBase58(),
    squadsMultisigCreationFee: protocol.multisigCreationFee?.toString?.() ?? String(protocol.multisigCreationFee),
    members: members.map((m) => m.toBase58()),
    ops,
    upgrade,
    createdAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(out, null, 2));

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
    console.log(`Saved ${outputPath}`);
  }
}

main().catch((e) => {
  console.error("Failed to create Squads multisigs:", e);
  process.exit(1);
});
