/**
 * Initialize jackpot Config on devnet.
 * Creates a test USDC mint, treasury ATA, and calls init_config.
 *
 * Usage:
 *   npx tsx scripts/init_devnet.ts
 *
 * Requires: keypair at ../keypar.json (admin + payer)
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import IDL from "../src/idl/jackpot.json";
import { PROGRAM_ID, SEED_CFG } from "../src/lib/constants";

const RPC = process.env.RPC_URL || "http://ash.rpc.gadflynode.com:80";

async function main() {
  // Load admin keypair
  const keypairPath = resolve(__dirname, "../keypar.json");
  const secret = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log("Admin:", admin.publicKey.toBase58());

  const connection = new Connection(RPC, "confirmed");
  const balance = await connection.getBalance(admin.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  // Check if config already exists
  const [configPda] = PublicKey.findProgramAddressSync([SEED_CFG], PROGRAM_ID);
  const existingConfig = await connection.getAccountInfo(configPda);
  if (existingConfig) {
    console.log("Config already initialized at:", configPda.toBase58());
    console.log("Owner:", existingConfig.owner.toBase58());
    // Decode and show config
    const provider = new AnchorProvider(
      connection,
      new Wallet(admin),
      { commitment: "confirmed" }
    );
    const program = new Program(IDL as any, provider);
    const cfg = await (program.account as any).config.fetch(configPda);
    console.log("Config data:", {
      admin: cfg.admin.toBase58(),
      usdcMint: cfg.usdcMint.toBase58(),
      treasuryUsdcAta: cfg.treasuryUsdcAta.toBase58(),
      feeBps: cfg.feeBps,
      ticketUnit: cfg.ticketUnit.toString(),
      roundDurationSec: cfg.roundDurationSec,
      minParticipants: cfg.minParticipants,
      minTotalTickets: cfg.minTotalTickets.toString(),
      paused: cfg.paused,
    });
    return;
  }

  // 1. Create test USDC mint (6 decimals, admin as authority)
  console.log("Creating test USDC mint...");
  const usdcMint = await createMint(
    connection,
    admin,       // payer
    admin.publicKey, // mint authority
    null,        // freeze authority
    6            // decimals
  );
  console.log("Test USDC mint:", usdcMint.toBase58());

  // 2. Create treasury ATA (owned by admin for now)
  console.log("Creating treasury ATA...");
  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    usdcMint,
    admin.publicKey
  );
  console.log("Treasury ATA:", treasuryAta.address.toBase58());

  // 3. Mint some test USDC to admin for testing (10,000 USDC)
  console.log("Minting 10,000 test USDC to admin...");
  await mintTo(
    connection,
    admin,
    usdcMint,
    treasuryAta.address,
    admin,
    10_000 * 1e6 // 10k USDC
  );

  // 4. Call init_config
  console.log("Calling init_config...");
  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );
  const program = new Program(IDL as any, provider);

  const tx = await program.methods
    .initConfig({
      usdcMint,
      treasuryUsdcAta: treasuryAta.address,
      feeBps: 500,              // 5%
      ticketUnit: new BN(1_000_000), // 1 USDC = 1 ticket
      roundDurationSec: 60,     // 60 seconds
      minParticipants: 2,
      minTotalTickets: new BN(2),
      maxDepositPerUser: new BN(0), // 0 = unlimited
    })
    .accounts({
      payer: admin.publicKey,
      admin: admin.publicKey,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc({ skipPreflight: true });

  console.log("init_config tx:", tx);
  console.log("\n=== DEVNET CONFIG ===");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Config PDA:", configPda.toBase58());
  console.log("USDC Mint:", usdcMint.toBase58());
  console.log("Treasury ATA:", treasuryAta.address.toBase58());
  console.log("Admin:", admin.publicKey.toBase58());
  console.log("\nSave the USDC mint address — you'll need it in constants.ts!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
