try {
  await import("dotenv/config");
} catch {
  // Optional dotenv support.
}

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import IDL from "../src/idl/jackpot.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC = process.env.RPC_URL || "http://ams.rpc.gadflynode.com:80";
const PROGRAM_ID_STR = process.env.PROGRAM_ID || "3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj";
const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR_PATH || resolve(__dirname, "../deployer_keypair.bytes.json");
const TREASURY_USDC_ATA_STR = process.env.TREASURY_USDC_ATA;
const USDC_MINT_STR =
  process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const FEE_BPS = Number(process.env.FEE_BPS || 25);
const TICKET_UNIT = BigInt(process.env.TICKET_UNIT || "1000000");
const ROUND_DURATION_SEC = Number(process.env.ROUND_DURATION_SEC || 60);
const MIN_PARTICIPANTS = Number(process.env.MIN_PARTICIPANTS || 2);
const MIN_TOTAL_TICKETS = BigInt(process.env.MIN_TOTAL_TICKETS || "2");
const MAX_DEPOSIT_PER_USER = BigInt(process.env.MAX_DEPOSIT_PER_USER || "0");

const SEED_CFG = Buffer.from("cfg");

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!TREASURY_USDC_ATA_STR) {
    throw new Error("Missing TREASURY_USDC_ATA env var");
  }

  const programId = new PublicKey(PROGRAM_ID_STR);
  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);
  const usdcMint = new PublicKey(USDC_MINT_STR);
  const treasuryUsdcAta = new PublicKey(TREASURY_USDC_ATA_STR);

  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const idl = { ...(IDL as any), address: programId.toBase58() };
  const program = new Program(idl as any, provider);

  const [configPda] = PublicKey.findProgramAddressSync([SEED_CFG], programId);

  const existing = await connection.getAccountInfo(configPda, "processed");
  if (existing) {
    console.log("Config already exists:", configPda.toBase58());
    return;
  }

  const ix = await (program.methods as any)
    .initConfig({
      usdcMint,
      treasuryUsdcAta,
      feeBps: FEE_BPS,
      ticketUnit: new BN(TICKET_UNIT.toString()),
      roundDurationSec: ROUND_DURATION_SEC,
      minParticipants: MIN_PARTICIPANTS,
      minTotalTickets: new BN(MIN_TOTAL_TICKETS.toString()),
      maxDepositPerUser: new BN(MAX_DEPOSIT_PER_USER.toString()),
    })
    .accounts({
      payer: admin.publicKey,
      admin: admin.publicKey,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ix
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = admin.publicKey;
  tx.sign(admin);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 80,
  });

  let created = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const info = await connection.getAccountInfo(configPda, "processed");
    if (info) {
      created = true;
      break;
    }
    await sleep(2_000);
  }

  if (!created) {
    throw new Error(`Config PDA was not observed on-chain in time. tx=${signature}`);
  }

  try {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "processed"
    );
  } catch {
    // Non-fatal when state existence is already confirmed.
  }

  const cfg = await (program.account as any).config.fetch(configPda);
  console.log(
    JSON.stringify(
      {
        rpc: RPC,
        programId: programId.toBase58(),
        configPda: configPda.toBase58(),
        signature,
        admin: new PublicKey(cfg.admin).toBase58(),
        usdcMint: new PublicKey(cfg.usdcMint).toBase58(),
        treasuryUsdcAta: new PublicKey(cfg.treasuryUsdcAta).toBase58(),
        feeBps: cfg.feeBps,
        roundDurationSec: cfg.roundDurationSec,
        minParticipants: cfg.minParticipants,
        minTotalTickets: cfg.minTotalTickets.toString(),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("init_mainnet_config failed:", e);
  process.exit(1);
});

