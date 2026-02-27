/**
 * Round archive — saves settled/claimed round data to Firebase Realtime Database
 * so that History still works after close_round deallocates on-chain accounts.
 */
import { ref, set, get, child, query, orderByKey, limitToLast } from "firebase/database";
import { db } from "./firebase";
import type { HistoryRound } from "../hooks/useRoundHistory";

/**
 * Save a round snapshot to Firebase RTDB at `rounds/{roundId}`.
 * Write-once: if the key already exists, the DB rules will reject the write (silently OK).
 */
export async function saveRoundToFirebase(round: HistoryRound): Promise<void> {
  if (!db) {
    console.warn("Firebase not initialized — skipping round archive");
    return;
  }
  try {
    const roundRef = ref(db, `rounds/${round.roundId}`);
    await set(roundRef, {
      roundId: round.roundId,
      status: round.status,
      totalUsdc: round.totalUsdc,
      totalTickets: round.totalTickets,
      participantsCount: round.participantsCount,
      winner: round.winner,
      winningTicket: round.winningTicket.toString(),
      randomness: round.randomness,
      startTs: round.startTs,
      endTs: round.endTs,
      claimTx: round.claimTx || null,
      vaultUsdcAta: round.vaultUsdcAta,
      participants: round.participants,
      participantDeposits: round.participantDeposits || [],
      archivedAt: Date.now(),
    });
  } catch (e: any) {
    // PERMISSION_DENIED means it already exists (write-once rule) — that's fine
    if (e?.code === "PERMISSION_DENIED" || e?.message?.includes("PERMISSION_DENIED")) {
      return;
    }
    console.error("Failed to save round to Firebase:", e);
    throw e;
  }
}

/**
 * Fetch a single round from Firebase by ID.
 * Returns null if not found.
 */
export async function fetchRoundFromFirebase(
  roundId: number
): Promise<HistoryRound | null> {
  if (!db) return null;
  try {
    const snapshot = await get(child(ref(db), `rounds/${roundId}`));
    if (!snapshot.exists()) return null;
    const val = snapshot.val();
    return {
      roundId: val.roundId,
      status: val.status,
      totalUsdc: val.totalUsdc,
      totalTickets: val.totalTickets || 0,
      participantsCount: val.participantsCount,
      winner: val.winner,
      winningTicket: BigInt(val.winningTicket || "0"),
      randomness: val.randomness || "",
      startTs: val.startTs,
      endTs: val.endTs,
      claimTx: val.claimTx || undefined,
      vaultUsdcAta: val.vaultUsdcAta || "",
      participants: val.participants || [],
      participantDeposits: val.participantDeposits || [],
    };
  } catch (e) {
    console.error(`Failed to fetch round ${roundId} from Firebase:`, e);
    return null;
  }
}

/**
 * Fetch multiple rounds from Firebase by IDs.
 * Returns only found rounds (skips missing).
 */
export async function fetchRoundsFromFirebase(
  roundIds: number[]
): Promise<HistoryRound[]> {
  if (!db || roundIds.length === 0) return [];
  const results: HistoryRound[] = [];
  // Firebase RTDB doesn't have native multi-get, so fetch in parallel
  const promises = roundIds.map((id) => fetchRoundFromFirebase(id));
  const settled = await Promise.allSettled(promises);
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      results.push(result.value);
    }
  }
  return results;
}

/**
 * Get the highest archived round ID from Firebase.
 * Uses orderByKey + limitToLast(1) for efficiency.
 * Returns 0 if no archived rounds exist.
 */
export async function getMaxArchivedRoundId(): Promise<number> {
  if (!db) return 0;
  try {
    const roundsRef = ref(db, "rounds");
    const q = query(roundsRef, orderByKey(), limitToLast(1));
    const snapshot = await get(q);
    if (!snapshot.exists()) return 0;
    const keys = Object.keys(snapshot.val());
    return keys.length > 0 ? Number(keys[0]) : 0;
  } catch (e) {
    console.warn("Failed to get max archived round ID:", e);
    return 0;
  }
}

/**
 * Fetch the N most recent settled/claimed rounds from Firebase.
 * Zero RPC calls — purely a Firebase read.
 */
export async function fetchRecentWinnersFromFirebase(
  count: number
): Promise<HistoryRound[]> {
  if (!db) return [];
  try {
    const roundsRef = ref(db, "rounds");
    const q = query(roundsRef, orderByKey(), limitToLast(count));
    const snapshot = await get(q);
    if (!snapshot.exists()) return [];
    const val = snapshot.val() as Record<string, any>;
    return Object.values(val)
      .map((r: any) => ({
        roundId: Number(r.roundId),
        status: r.status,
        totalUsdc: r.totalUsdc,
        totalTickets: r.totalTickets,
        participantsCount: r.participantsCount,
        winner: r.winner,
        winningTicket: BigInt(r.winningTicket ?? 0),
        randomness: r.randomness ?? "",
        startTs: r.startTs,
        endTs: r.endTs,
        claimTx: r.claimTx,
        vaultUsdcAta: r.vaultUsdcAta ?? "",
        participants: r.participants ?? [],
        participantDeposits: r.participantDeposits,
      } as HistoryRound))
      .filter((r) => r.winner && r.winner !== "11111111111111111111111111111111")
      .sort((a, b) => b.roundId - a.roundId);
  } catch (e) {
    console.warn("Failed to fetch recent winners from Firebase:", e);
    return [];
  }
}
