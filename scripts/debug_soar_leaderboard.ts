/**
 * Debug script: inspect SOAR leaderboard on-chain state.
 * Usage: npx ts-node --esm scripts/debug_soar_leaderboard.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { SoarProgram } from "@magicblock-labs/soar-sdk";

const RPC = process.env.SOLANA_RPC_UPSTREAM || "https://api.mainnet-beta.solana.com";
const LEADERBOARD_PK = new PublicKey("5mSCXFNAxiHjxDsmvMnJVstAdT5uiiDJ4gRhHM5rNfUB");
const GAME_PK = new PublicKey("GX2oS4iPJr2rZYGmp9V8WVVuabfQhwE4b5MESrBaozgy");

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const soar = SoarProgram.getFromConnection(connection, PublicKey.default);

  console.log("=== SOAR Leaderboard Debug ===");
  console.log("RPC:", RPC.slice(0, 40) + "...");
  console.log("Leaderboard PK:", LEADERBOARD_PK.toBase58());

  // 1. Fetch leaderboard account
  console.log("\n--- Leaderboard Account ---");
  let leaderboard: any;
  try {
    leaderboard = await soar.fetchLeaderBoardAccount(LEADERBOARD_PK);
    console.log("Game:", leaderboard.game.toBase58());
    console.log("Description:", leaderboard.description);
    console.log("NftMeta:", leaderboard.nftMeta.toBase58());
    console.log("Decimals:", leaderboard.decimals);
    console.log("MinScore:", leaderboard.minScore?.toString());
    console.log("MaxScore:", leaderboard.maxScore?.toString());
    console.log("scoresToRetain:", leaderboard.scoresToRetain);
    console.log("scoresOrder:", leaderboard.scoresOrder);
    console.log("topEntries:", leaderboard.topEntries?.toBase58() ?? "NULL");
    console.log("isActive:", leaderboard.isActive);
  } catch (e: any) {
    console.error("Failed to fetch leaderboard:", e.message);
    return;
  }

  // 2. Fetch topEntries
  if (leaderboard.topEntries) {
    console.log("\n--- Top Entries Account ---");
    try {
      const topEntries = await soar.fetchLeaderBoardTopEntriesAccount(leaderboard.topEntries);
      console.log("isAscending:", topEntries.isAscending);
      console.log("Total entries:", topEntries.topScores.length);
      console.log("Non-zero entries:", topEntries.topScores.filter((s: any) => s.entry.score.toNumber() > 0).length);
      
      console.log("\nAll entries with score > 0:");
      topEntries.topScores
        .filter((s: any) => s.entry.score.toNumber() > 0)
        .forEach((s: any, i: number) => {
          console.log(`  #${i + 1}: player=${s.player.toBase58()}, score=${s.entry.score.toString()}, timestamp=${s.entry.timestamp.toString()}`);
        });

      console.log("\nFirst 5 entries (including zero scores):");
      topEntries.topScores.slice(0, 5).forEach((s: any, i: number) => {
        console.log(`  [${i}]: player=${s.player.toBase58()}, score=${s.entry.score.toString()}`);
      });
    } catch (e: any) {
      console.error("Failed to fetch topEntries:", e.message);
    }
  } else {
    console.log("\n!!! topEntries is NULL — no top entries account linked to leaderboard");
  }

  // 3. Fetch game account
  console.log("\n--- Game Account ---");
  try {
    const game = await soar.fetchGameAccount(GAME_PK);
    console.log("Meta:", JSON.stringify(game.meta, null, 2));
    console.log("Authorities:", game.auth.map((a: any) => a.toBase58()));
    console.log("Leaderboard count:", game.leaderboardCount?.toString());
  } catch (e: any) {
    console.error("Failed to fetch game:", e.message);
  }

  // 4. Check a few known wallets' player accounts
  const walletsToCheck = process.argv.slice(2);
  if (walletsToCheck.length > 0) {
    console.log("\n--- Player Account Checks ---");
    for (const w of walletsToCheck) {
      try {
        const pk = new PublicKey(w);
        const [playerPda] = soar.utils.derivePlayerAddress(pk);
        const [scoresPda] = soar.utils.derivePlayerScoresListAddress(pk, LEADERBOARD_PK);
        
        const playerInfo = await connection.getAccountInfo(playerPda);
        const scoresInfo = await connection.getAccountInfo(scoresPda);
        
        console.log(`\nWallet: ${w}`);
        console.log(`  Player PDA: ${playerPda.toBase58()} — exists: ${!!playerInfo}`);
        console.log(`  Scores PDA: ${scoresPda.toBase58()} — exists: ${!!scoresInfo}`);

        if (scoresInfo) {
          try {
            const scoresList = await soar.fetchPlayerScoresListAccount(scoresPda);
            console.log(`  Scores: ${JSON.stringify(scoresList.scores?.map((s: any) => ({ score: s.score.toString(), ts: s.timestamp.toString() })))}`);
          } catch (e: any) {
            console.log(`  (Could not decode scores: ${e.message})`);
          }
        }
      } catch (e: any) {
        console.log(`  Error checking ${w}: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
