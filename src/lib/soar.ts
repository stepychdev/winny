import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { SoarProgram } from "@magicblock-labs/soar-sdk";
import { SOAR_LEADERBOARD_PK } from "./constants";

export interface LeaderboardEntry {
  player: string;
  score: number;
  rank: number;
}

/**
 * Check whether a player's SOAR account is initialized and registered
 * for our leaderboard.  Pure read — no transaction needed.
 */
export async function checkSoarPlayerStatus(
  connection: Connection,
  playerPk: PublicKey
): Promise<{ initialized: boolean; registered: boolean }> {
  const soar = SoarProgram.getFromConnection(connection, playerPk);

  const [playerAccountPda] = soar.utils.derivePlayerAddress(playerPk);
  const playerAccountInfo = await connection.getAccountInfo(playerAccountPda);
  const initialized = !!playerAccountInfo;

  if (!initialized) return { initialized: false, registered: false };

  const [playerScoresPda] = soar.utils.derivePlayerScoresListAddress(
    playerPk,
    SOAR_LEADERBOARD_PK
  );
  const scoresInfo = await connection.getAccountInfo(playerScoresPda);
  return { initialized, registered: !!scoresInfo };
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
  console.log("[SOAR] Submitting volume score:", { player, totalVolumeCents });
  try {
    const res = await fetch("/api/soar/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player, totalVolumeCents }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[SOAR] Submit API error:", res.status, data);
    } else {
      console.log("[SOAR] Submit API success:", data);
    }
  } catch (err) {
    console.error("[SOAR] Submit API fetch failed:", err);
    throw err;
  }
}

/**
 * Ensure the player's SOAR account is initialized and registered for our
 * leaderboard.  These instructions require the player's wallet signature,
 * so they MUST happen client-side.
 *
 * @param connection  Solana connection
 * @param playerPk    Player's public key
 * @param signAndSend A callback (typically from wallet adapter) that signs the
 *                    transaction with the player's wallet and sends it.  Should
 *                    return the tx signature.
 * @returns true if a tx was sent (init/register), false if already set up.
 */
export async function ensureSoarPlayerInitialized(
  connection: Connection,
  playerPk: PublicKey,
  signAndSend: (tx: Transaction) => Promise<string>
): Promise<boolean> {
  const soar = SoarProgram.getFromConnection(connection, playerPk);
  const instructions: any[] = [];

  // 1. Check if player account exists
  const [playerAccountPda] = soar.utils.derivePlayerAddress(playerPk);
  const playerAccountInfo = await connection.getAccountInfo(playerAccountPda);
  if (!playerAccountInfo) {
    const initResult = await soar.initializePlayerAccount(
      playerPk,
      playerPk.toBase58().slice(0, 16),
      PublicKey.default
    );
    instructions.push(...initResult.transaction.instructions);
    console.log("[SOAR] Will init player account");
  }

  // 2. Check if registered for our leaderboard
  const [playerScoresPda] = soar.utils.derivePlayerScoresListAddress(
    playerPk,
    SOAR_LEADERBOARD_PK
  );
  const scoresInfo = await connection.getAccountInfo(playerScoresPda);
  if (!scoresInfo) {
    const regResult = await soar.registerPlayerEntryForLeaderBoard(
      playerPk,
      SOAR_LEADERBOARD_PK
    );
    instructions.push(...regResult.transaction.instructions);
    console.log("[SOAR] Will register player for leaderboard");
  }

  if (instructions.length === 0) {
    console.log("[SOAR] Player already initialized & registered");
    return false;
  }

  const tx = new Transaction().add(...instructions);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = playerPk;

  const signature = await signAndSend(tx);
  console.log("[SOAR] Init/register tx sent:", signature);

  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  console.log("[SOAR] Init/register tx confirmed:", signature);
  return true;
}
