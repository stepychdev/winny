/**
 * One-shot: extend existing ALT 2XMREs6Fd9PK1J3py6qv8niw1akSbjFhBCpvrexRj1Hk
 * with Jackpot stable addresses.
 *
 * Usage: npx tsx --env-file=.env.mainnet scripts/extend_alt.ts
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

async function main() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.DEGEN_EXECUTOR_KEYPAIR_PATH!, "utf8")))
  );
  const executorUsdcAta = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);

  const altAddress = new PublicKey("2XMREs6Fd9PK1J3py6qv8niw1akSbjFhBCpvrexRj1Hk");

  const addresses: PublicKey[] = [
    PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    new PublicKey("ComputeBudget111111111111111111111111111111"),
    new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
    getConfigPda(),
    getDegenConfigPda(),
    USDC_MINT,
    TREASURY_USDC_ATA,
    executorUsdcAta,
    payer.publicKey,
  ];

  console.log(`Extending ALT ${altAddress.toBase58()} with ${addresses.length} addresses...`);

  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: altAddress,
    addresses,
  });

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    extendIx,
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(payer);

  const sig = await connection.sendTransaction(tx, [payer], { skipPreflight: true, maxRetries: 5 });
  console.log("extend sent:", sig);

  // Poll for confirmation
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await connection.getSignatureStatuses([sig]);
    const s = status.value[0];
    if (s) {
      if (s.err) { console.error("TX failed:", s.err); process.exit(1); }
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
        console.log("confirmed! slot:", s.slot);
        break;
      }
    }
    if (i === 29) { console.error("timeout waiting for confirmation"); process.exit(1); }
  }

  // Verify
  const result = await connection.getAddressLookupTable(altAddress);
  console.log("ALT addresses:", result.value?.state.addresses.length);
  result.value?.state.addresses.forEach((a, i) => console.log(`  [${i}]`, a.toBase58()));
  console.log(`\nJACKPOT_ALT=${altAddress.toBase58()}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
