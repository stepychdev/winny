try {
  await import("dotenv/config");
} catch {
  // Optional dotenv support.
}

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import IDL from "../src/idl/jackpot.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC = process.env.RPC_URL || "http://ams.rpc.gadflynode.com:80";
const PROGRAM_ID_STR = process.env.PROGRAM_ID || "3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj";
const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR_PATH || resolve(__dirname, "../deployer_keypair.bytes.json");
const NEW_ADMIN_STR = process.env.NEW_ADMIN;

const SEED_CFG = Buffer.from("cfg");

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!NEW_ADMIN_STR) throw new Error("Missing NEW_ADMIN env var");

  const programId = new PublicKey(PROGRAM_ID_STR);
  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);
  const newAdmin = new PublicKey(NEW_ADMIN_STR);
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const idl = { ...(IDL as any), address: programId.toBase58() };
  const program = new Program(idl as any, provider);

  const [configPda] = PublicKey.findProgramAddressSync([SEED_CFG], programId);
  const cfgBefore = await (program.account as any).config.fetch(configPda);
  const currentAdmin = new PublicKey(cfgBefore.admin);
  if (!currentAdmin.equals(admin.publicKey)) {
    throw new Error(
      `Signer ${admin.publicKey.toBase58()} is not current admin ${currentAdmin.toBase58()}`
    );
  }
  if (currentAdmin.equals(newAdmin)) {
    console.log("Already transferred:", newAdmin.toBase58());
    return;
  }

  const transferIx = await (program.methods as any)
    .transferAdmin(newAdmin)
    .accounts({
      admin: admin.publicKey,
      config: configPda,
    })
    .instruction();

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    transferIx
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = admin.publicKey;
  tx.sign(admin);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 80,
  });

  let changed = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    try {
      const cfg = await (program.account as any).config.fetch(configPda);
      const liveAdmin = new PublicKey(cfg.admin);
      if (liveAdmin.equals(newAdmin)) {
        changed = true;
        break;
      }
    } catch {
      // retry
    }
    await sleep(2_000);
  }

  if (!changed) {
    throw new Error(`transfer_admin state change not observed in time. tx=${signature}`);
  }

  try {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "processed"
    );
  } catch {
    // Non-fatal when state already observed.
  }

  console.log(
    JSON.stringify(
      {
        rpc: RPC,
        programId: programId.toBase58(),
        configPda: configPda.toBase58(),
        oldAdmin: currentAdmin.toBase58(),
        newAdmin: newAdmin.toBase58(),
        signature,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("transfer_admin_mainnet failed:", e);
  process.exit(1);
});

