/* eslint-env node */
/**
 * Squads Ops helper: force-cancel a jackpot round via `admin_force_cancel(round_id)`.
 *
 * Uses Squads V4 ops multisig (2-of-3) to call jackpot admin instruction.
 * This is intended for cases where `config.admin` is the Ops vault PDA.
 *
 * Defaults are loaded from `addresses.mainnet.json` (mainnet) or `addresses.json` (devnet),
 * depending on NETWORK.
 *
 * Required env:
 *   SIGNER1_KEYPAIR_PATH=./keypar.json
 *   SIGNER2_KEYPAIR_PATH=/path/to/second-ops-member.json
 *   ROUND_ID=1
 *
 * Optional env:
 *   NETWORK=mainnet|devnet            # default: mainnet
 *   RPC_URL=...
 *   OPS_MULTISIG_PDA=...
 *   OPS_VAULT_PDA=...
 *   PROGRAM_ID=...
 *   CONFIG_PDA=...
 *   EXECUTE=1                         # default: 1
 *
 * Recommended runtime:
 *   npx -y node@20 scripts/squads_force_cancel_round.mjs
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

function toBool(v, defaultValue) {
  if (v == null) return defaultValue;
  return v === "1" || v === "true" || v === "TRUE";
}

function toBigIntRoundId(v) {
  if (v == null) throw new Error("ROUND_ID is required");
  const n = BigInt(v);
  if (n < 0n) throw new Error(`ROUND_ID must be >= 0, got ${v}`);
  return n;
}

function u64LeBuffer(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function loadKeypairFromPathFactory(web3) {
  return function loadKeypair(filePath) {
    const resolved = path.resolve(REPO_ROOT, filePath);
    const arr = readJson(resolved);
    return web3.Keypair.fromSecretKey(Uint8Array.from(arr));
  };
}

function getDefaults(network) {
  const idlPath = path.resolve(REPO_ROOT, "src/idl/jackpot.json");
  const idl = readJson(idlPath);

  if (network === "devnet") {
    const addresses = readJson(path.resolve(REPO_ROOT, "addresses.json"));
    const a = addresses.devnet;
    return {
      rpcUrl: "https://api.devnet.solana.com",
      opsMultisigPda: a.squads.ops.multisig_pda,
      opsVaultPda: a.squads.ops.vault_pda_index_0,
      programId: a.program.jackpot_program_id || idl.address,
      configPda: a.protocol_config.config_pda,
      idl,
    };
  }

  const addresses = readJson(path.resolve(REPO_ROOT, "addresses.mainnet.json"));
  const a = addresses.mainnet;
  return {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    opsMultisigPda: a.squads.ops.multisig_pda,
    opsVaultPda: a.squads.ops.vault_pda_index_0,
    programId: a.program.jackpot_program_id || idl.address,
    configPda: a.protocol_config.config_pda,
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

function findInstruction(idl, name) {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`Instruction ${name} not found in IDL`);
  return ix;
}

function buildAdminForceCancelIx({ web3, programId, opsVaultPda, configPda, roundPda, roundId, idl }) {
  const { PublicKey, TransactionInstruction } = web3;
  const ixDef = findInstruction(idl, "admin_force_cancel");
  const discriminator = Buffer.from(ixDef.discriminator);
  const data = Buffer.concat([discriminator, u64LeBuffer(roundId)]);

  // Accounts order must match the IDL:
  // 1) admin (signer)
  // 2) config
  // 3) round (writable)
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(opsVaultPda), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(configPda), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(roundPda), isSigner: false, isWritable: true },
    ],
    data,
  });
}

async function main() {
  const multisig = await importOrExit(
    "@sqds/multisig",
    "Install @sqds/multisig in the runtime environment used for this script."
  );
  const web3 = await importOrExit("@solana/web3.js");
  const { Connection, PublicKey, TransactionMessage } = web3;
  const loadKeypair = loadKeypairFromPathFactory(web3);

  const network = (process.env.NETWORK || "mainnet").toLowerCase();
  if (network !== "mainnet" && network !== "devnet") {
    throw new Error(`NETWORK must be mainnet or devnet, got ${network}`);
  }
  const defaults = getDefaults(network);

  const signer1Path = process.env.SIGNER1_KEYPAIR_PATH;
  const signer2Path = process.env.SIGNER2_KEYPAIR_PATH;
  if (!signer1Path || !signer2Path) {
    throw new Error("SIGNER1_KEYPAIR_PATH and SIGNER2_KEYPAIR_PATH are required");
  }

  const roundId = toBigIntRoundId(process.env.ROUND_ID);
  const execute = toBool(process.env.EXECUTE, true);

  const rpcUrl = envOrDefault("RPC_URL", defaults.rpcUrl);
  const rpcWsUrl = process.env.RPC_WS_URL || deriveWsEndpoint(rpcUrl);
  const opsMultisigPda = new PublicKey(envOrDefault("OPS_MULTISIG_PDA", defaults.opsMultisigPda));
  const opsVaultPda = new PublicKey(envOrDefault("OPS_VAULT_PDA", defaults.opsVaultPda));
  const programId = new PublicKey(envOrDefault("PROGRAM_ID", defaults.programId));
  const configPda = new PublicKey(envOrDefault("CONFIG_PDA", defaults.configPda));

  const roundPda = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), u64LeBuffer(roundId)],
    programId
  )[0];

  const signer1 = loadKeypair(signer1Path);
  const signer2 = loadKeypair(signer2Path);

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: rpcWsUrl,
  });
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, opsMultisigPda);
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;

  const ix = buildAdminForceCancelIx({
    web3,
    programId,
    opsVaultPda,
    configPda,
    roundPda,
    roundId,
    idl: defaults.idl,
  });

  console.log("=== Squads Force-Cancel Round ===");
  console.log("Network:", network);
  console.log("RPC:", rpcUrl);
  console.log("WS RPC:", rpcWsUrl || "(auto)");
  console.log("Program:", programId.toBase58());
  console.log("Ops multisig:", opsMultisigPda.toBase58());
  console.log("Ops vault (admin):", opsVaultPda.toBase58());
  console.log("Config PDA:", configPda.toBase58());
  console.log("Round ID:", roundId.toString());
  console.log("Round PDA:", roundPda.toBase58());
  console.log("Signer1:", signer1.publicKey.toBase58());
  console.log("Signer2:", signer2.publicKey.toBase58());
  console.log("Execute now:", execute);
  console.log();

  const sendOptions = {
    skipPreflight: true,
    preflightCommitment: "processed",
    maxRetries: 80,
  };

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

  let sigExecute = null;
  if (execute) {
    console.log(`Executing txIndex=${txIndex}...`);
    sigExecute = await multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: signer1,
      multisigPda: opsMultisigPda,
      transactionIndex: txIndex,
      member: signer1.publicKey,
      sendOptions,
    });
    console.log(`Sent execute tx: ${sigExecute}`);
    await confirmOrThrow(connection, sigExecute, `vaultTransactionExecute(tx=${txIndex})`);
  }

  console.log(
    JSON.stringify(
      {
        network,
        roundId: roundId.toString(),
        roundPda: roundPda.toBase58(),
        txIndex: txIndex.toString(),
        signatures: {
          vaultTransactionCreate: sigCreateTx,
          proposalCreate: sigProposal,
          proposalApprove1: sigApprove1,
          proposalApprove2: sigApprove2,
          vaultTransactionExecute: sigExecute,
        },
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
