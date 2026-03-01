#!/usr/bin/env npx tsx
/**
 * create_jackpot_alt.ts — Create & populate a Jackpot Address Lookup Table.
 *
 * Run once per environment to create an ALT containing stable accounts
 * used by the degen executor. This reduces degen execution tx size by
 * ~370 bytes (from 1228 → ~860), leaving room for 3-4 hop Jupiter routes.
 *
 * Usage:
 *   npx tsx --env-file=.env.mainnet scripts/create_jackpot_alt.ts
 *
 * After creation, add the printed address to your .env file:
 *   JACKPOT_ALT=<address>
 */
import fs from "fs";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  PROGRAM_ID,
  USDC_MINT,
  TREASURY_USDC_ATA,
  getConfigPda,
  getDegenConfigPda,
} from "../src/constants.js";

// ─── Helpers ──────────────────────────────────────────────

function envRequired(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8")))
  );
}

/** Send tx with skipPreflight and poll for confirmation (robust for slow RPCs). */
async function sendAndPoll(
  connection: Connection,
  tx: Transaction,
  payer: Keypair,
  label: string,
): Promise<string> {
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(payer);
  const sig = await connection.sendTransaction(tx, [payer], { skipPreflight: true, maxRetries: 5 });
  console.log(`  ${label} sent: ${sig}`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await connection.getSignatureStatuses([sig]);
    const s = status.value[0];
    if (s) {
      if (s.err) throw new Error(`${label} tx failed: ${JSON.stringify(s.err)}`);
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
        console.log(`  ${label} confirmed (slot ${s.slot})`);
        return sig;
      }
    }
  }
  throw new Error(`${label} tx not confirmed after 60s`);
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  const rpcUrl = envRequired("RPC_URL");
  const connection = new Connection(rpcUrl, "confirmed");

  const payerPath = process.env.DEGEN_EXECUTOR_KEYPAIR_PATH || process.env.CRANK_KEYPAIR_PATH;
  if (!payerPath) throw new Error("Need DEGEN_EXECUTOR_KEYPAIR_PATH or CRANK_KEYPAIR_PATH");
  const payer = loadKeypair(payerPath);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  const executorUsdcAta = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);
  const PRIORITY_FEE = Number(process.env.CRANK_PRIORITY_FEE_MICROLAMPORTS || 500_000);

  // All stable accounts we want in the ALT
  const addresses: PublicKey[] = [
    PROGRAM_ID,                                                          // Jackpot program
    TOKEN_PROGRAM_ID,                                                    // SPL Token
    ASSOCIATED_TOKEN_PROGRAM_ID,                                         // AToken
    SystemProgram.programId,                                             // System
    new PublicKey("ComputeBudget111111111111111111111111111111"),          // ComputeBudget
    new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),       // Jupiter V6
    getConfigPda(),                                                      // config PDA
    getDegenConfigPda(),                                                 // degen_config PDA
    USDC_MINT,                                                           // USDC mint
    TREASURY_USDC_ATA,                                                   // treasury fee vault
    executorUsdcAta,                                                     // executor USDC ATA
    payer.publicKey,                                                     // executor wallet
  ];

  console.log(`\nAddresses to include (${addresses.length}):`);
  addresses.forEach((a, i) => console.log(`  [${i}] ${a.toBase58()}`));

  // Step 1: Create the lookup table
  const slot = await connection.getSlot("confirmed");
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  console.log(`\nCreating ALT at: ${altAddress.toBase58()} (priority=${PRIORITY_FEE} µlamp)`);

  const createTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    createIx,
  );
  await sendAndPoll(connection, createTx, payer, "create");

  // Step 2: Extend with addresses
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: altAddress,
    addresses,
  });

  const extendTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    extendIx,
  );
  await sendAndPoll(connection, extendTx, payer, "extend");

  // Step 3: Wait for activation
  console.log("\nWaiting for ALT activation...");
  await new Promise((r) => setTimeout(r, 2000));

  // Verify
  const altAccount = await connection.getAddressLookupTable(altAddress);
  if (!altAccount.value) {
    console.error("ERROR: ALT not found after creation!");
    process.exit(1);
  }
  console.log(`\nALT verified: ${altAccount.value.state.addresses.length} addresses`);
  altAccount.value.state.addresses.forEach((a, i) =>
    console.log(`  [${i}] ${a.toBase58()}`)
  );

  console.log("\n════════════════════════════════════════════");
  console.log(`  JACKPOT_ALT=${altAddress.toBase58()}`);
  console.log("════════════════════════════════════════════");
  console.log("\nAdd this to your .env.mainnet file.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
