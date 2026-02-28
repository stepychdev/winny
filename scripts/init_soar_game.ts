try {
  await import("dotenv/config");
} catch {
  // Optional dotenv support.
}

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { SoarProgram, GameType, Genre } from "@magicblock-labs/soar-sdk";
import BN from "bn.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC = process.env.RPC_URL || "http://ams.rpc.gadflynode.com:80";
const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR_PATH || resolve(__dirname, "../deployer_keypair.bytes.json");

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);
  const connection = new Connection(RPC, "confirmed");

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("RPC:", RPC);

  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const soar = SoarProgram.get(provider);

  // 1. Create a new Game
  const gameKeypair = Keypair.generate();
  console.log("\nCreating SOAR Game...");
  console.log("Game keypair:", gameKeypair.publicKey.toBase58());

  const initGameResult = await soar.initializeNewGame(
    gameKeypair.publicKey,
    "Winny",
    "Provably fair on-chain jackpot",
    Genre.Casual,
    GameType.Web,
    PublicKey.default, // no NFT metadata
    [admin.publicKey]
  );

  const gameSig = await soar.sendAndConfirmTransaction(
    initGameResult.transaction,
    [gameKeypair]
  );
  console.log("Game created! Signature:", gameSig);
  console.log("Game PK:", initGameResult.newGame.toBase58());

  // Wait for confirmation
  await sleep(2000);

  // 2. Add a Leaderboard
  console.log("\nAdding Leaderboard...");
  const addLbResult = await soar.addNewGameLeaderBoard(
    initGameResult.newGame,
    admin.publicKey,
    "Total Volume",
    PublicKey.default, // no NFT metadata
    100,               // scoresToRetain
    false              // scoresOrder: false = descending (highest first)
  );

  const lbSig = await soar.sendAndConfirmTransaction(
    addLbResult.transaction
  );
  console.log("Leaderboard created! Signature:", lbSig);
  console.log("Leaderboard PK:", addLbResult.newLeaderBoard.toBase58());
  console.log("Top Entries PK:", addLbResult.topEntries?.toBase58() ?? "null");

  // Output constants for src/lib/constants.ts
  console.log("\n" + "=".repeat(60));
  console.log("Add these to src/lib/constants.ts:");
  console.log("=".repeat(60));
  console.log(`export const SOAR_GAME_PK = new PublicKey("${initGameResult.newGame.toBase58()}");`);
  console.log(`export const SOAR_LEADERBOARD_PK = new PublicKey("${addLbResult.newLeaderBoard.toBase58()}");`);
  console.log("\nAdd these to Vercel env vars:");
  console.log(`SOAR_GAME_PK=${initGameResult.newGame.toBase58()}`);
  console.log(`SOAR_LEADERBOARD_PK=${addLbResult.newLeaderBoard.toBase58()}`);
}

main().catch((e) => {
  console.error("init_soar_game failed:", e);
  process.exit(1);
});
