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
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import IDL from "../src/idl/jackpot.json";

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj"
);
const SEED_CFG = Buffer.from("cfg");
const SEED_DEGEN_CFG = Buffer.from("degen_cfg");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR_PATH || resolve(__dirname, "../deployer_keypair.bytes.json");
const DEGEN_EXECUTOR_PUBKEY = process.env.DEGEN_EXECUTOR_PUBKEY;
const DEGEN_FALLBACK_TIMEOUT_SEC = Number(process.env.DEGEN_FALLBACK_TIMEOUT_SEC || 300);

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEED_CFG], PROGRAM_ID);
  return pda;
}

function getDegenConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEED_DEGEN_CFG], PROGRAM_ID);
  return pda;
}

async function main() {
  if (!DEGEN_EXECUTOR_PUBKEY) {
    throw new Error("Missing DEGEN_EXECUTOR_PUBKEY env var");
  }
  if (!Number.isFinite(DEGEN_FALLBACK_TIMEOUT_SEC) || DEGEN_FALLBACK_TIMEOUT_SEC < 0) {
    throw new Error("DEGEN_FALLBACK_TIMEOUT_SEC must be a non-negative integer");
  }

  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);
  const executor = new PublicKey(DEGEN_EXECUTOR_PUBKEY);
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const idl = { ...(IDL as any), address: PROGRAM_ID.toBase58() };
  const program = new Program(idl as any, provider);

  const configPda = getConfigPda();
  const degenConfigPda = getDegenConfigPda();

  const cfg = await (program.account as any).config.fetch(configPda);
  const currentAdmin = new PublicKey(cfg.admin);
  if (!currentAdmin.equals(admin.publicKey)) {
    throw new Error(
      `Signer ${admin.publicKey.toBase58()} is not config.admin ${currentAdmin.toBase58()}`
    );
  }

  const ix = await (program.methods as any)
    .upsertDegenConfig({
      executor,
      fallbackTimeoutSec: DEGEN_FALLBACK_TIMEOUT_SEC,
    })
    .accounts({
      admin: admin.publicKey,
      config: configPda,
      degenConfig: degenConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ix
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = admin.publicKey;
  tx.sign(admin);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  const degenCfg = await (program.account as any).degenConfig.fetch(degenConfigPda);

  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        programId: PROGRAM_ID.toBase58(),
        configPda: configPda.toBase58(),
        degenConfigPda: degenConfigPda.toBase58(),
        admin: admin.publicKey.toBase58(),
        executor: new PublicKey(degenCfg.executor).toBase58(),
        fallbackTimeoutSec: Number(degenCfg.fallbackTimeoutSec),
        signature,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("upsert_degen_config failed:", error);
  process.exit(1);
});
