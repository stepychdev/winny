// @ts-nocheck
/**
 * Scan all rounds, find Settled (unclaimed) ones, and auto_claim for each winner.
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=../keypar.json \
 *   npx ts-node scripts/auto_claim_all.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Jackpot } from "../target/types/jackpot";
import { PublicKey, Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const STATUS_SETTLED = 3;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Jackpot as Program<Jackpot>;
  const connection = provider.connection;

  // Fetch config to get usdcMint and treasury
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("cfg")],
    program.programId
  );
  const config = await program.account.config.fetch(configPda);
  const usdcMint: PublicKey = config.usdcMint;
  const treasuryUsdcAta: PublicKey = config.treasuryUsdcAta;

  console.log("Program:", program.programId.toBase58());
  console.log("USDC Mint:", usdcMint.toBase58());
  console.log("Treasury ATA:", treasuryUsdcAta.toBase58());
  console.log("Payer:", provider.wallet.publicKey.toBase58());
  console.log("---");

  // Scan rounds 1..MAX_ROUND to find Settled ones
  const MAX_ROUND = 200; // scan up to 200 rounds
  const DISC = 8;

  const settledRounds: { roundId: number; winner: PublicKey; vrfPayer: PublicKey; totalUsdc: bigint }[] = [];

  // Batch fetch: build all round PDAs
  const roundPdas: { roundId: number; pda: PublicKey }[] = [];
  for (let i = 1; i <= MAX_ROUND; i++) {
    const id = new BN(i);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("round"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    roundPdas.push({ roundId: i, pda });
  }

  // Fetch in batches of 100
  const BATCH = 100;
  for (let start = 0; start < roundPdas.length; start += BATCH) {
    const batch = roundPdas.slice(start, start + BATCH);
    const accounts = await connection.getMultipleAccountsInfo(
      batch.map((r) => r.pda)
    );

    for (let j = 0; j < accounts.length; j++) {
      const acc = accounts[j];
      if (!acc || !acc.data) continue;

      const d = acc.data;
      const status = d[DISC + 8];
      if (status !== STATUS_SETTLED) continue;

      // Parse winner and totalUsdc
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const totalUsdc = view.getBigUint64(DISC + 72, true);
      const winner = new PublicKey(d.subarray(DISC + 136, DISC + 168));
      const vrfPayer = new PublicKey(d.subarray(DISC + 8176, DISC + 8208));

      settledRounds.push({
        roundId: batch[j].roundId,
        winner,
        vrfPayer,
        totalUsdc,
      });
    }
  }

  if (settledRounds.length === 0) {
    console.log("No settled (unclaimed) rounds found.");
    return;
  }

  console.log(`Found ${settledRounds.length} settled round(s):\n`);
  for (const r of settledRounds) {
    const usdcAmount = Number(r.totalUsdc) / 1e6;
    console.log(`  Round #${r.roundId}: winner=${r.winner.toBase58()}, pot=$${usdcAmount.toFixed(2)}, vrfPayer=${r.vrfPayer.toBase58()}`);
  }
  console.log("");

  // Auto-claim each
  for (const r of settledRounds) {
    const roundIdBN = new BN(r.roundId);
    const [roundPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("round"), roundIdBN.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);
    const winnerUsdcAta = getAssociatedTokenAddressSync(usdcMint, r.winner);

    let vrfPayerUsdcAta = PublicKey.default;
    if (!r.vrfPayer.equals(PublicKey.default)) {
      vrfPayerUsdcAta = getAssociatedTokenAddressSync(usdcMint, r.vrfPayer);
    }

    try {
      console.log(`Claiming round #${r.roundId} for ${r.winner.toBase58()}...`);
      const tx = await program.methods
        .autoClaim(roundIdBN)
        .accounts({
          payer: provider.wallet.publicKey,
          config: configPda,
          round: roundPda,
          vaultUsdcAta,
          winnerUsdcAta,
          treasuryUsdcAta,
          vrfPayerUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log(`  ✓ Round #${r.roundId} claimed! TX: ${tx}`);
    } catch (e: any) {
      console.error(`  ✗ Round #${r.roundId} failed: ${e.message || e}`);
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
