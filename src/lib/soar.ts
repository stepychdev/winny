import { Connection, PublicKey } from "@solana/web3.js";
import { SoarProgram } from "@magicblock-labs/soar-sdk";
import { SOAR_LEADERBOARD_PK } from "./constants";

export interface LeaderboardEntry {
  player: string;
  score: number;
  rank: number;
}

/**
 * Fetch the top entries from the SOAR leaderboard.
 * Returns entries sorted by score (descending) with rank.
 */
export async function fetchLeaderboard(
  connection: Connection
): Promise<LeaderboardEntry[]> {
  const soar = SoarProgram.getFromConnection(connection, PublicKey.default);
  const leaderboard = await soar.fetchLeaderBoardAccount(SOAR_LEADERBOARD_PK);
  if (!leaderboard.topEntries) return [];

  const topEntries = await soar.fetchLeaderBoardTopEntriesAccount(
    leaderboard.topEntries
  );

  return topEntries.topScores
    .filter((s) => s.entry.score.toNumber() > 0)
    .map((s, i) => ({
      player: s.player.toBase58(),
      score: s.entry.score.toNumber(),
      rank: i + 1,
    }));
}

/**
 * Fetch a specific player's rank on the leaderboard.
 * Returns null if the player is not on the leaderboard.
 */
export async function fetchPlayerRank(
  connection: Connection,
  wallet: PublicKey
): Promise<LeaderboardEntry | null> {
  const entries = await fetchLeaderboard(connection);
  const walletStr = wallet.toBase58();
  return entries.find((e) => e.player === walletStr) ?? null;
}

/**
 * Submit a volume score via the API endpoint (fire-and-forget from client).
 */
export async function submitVolumeScoreViaApi(
  player: string,
  totalVolumeCents: number
): Promise<void> {
  await fetch("/api/soar/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player, totalVolumeCents }),
  });
}
