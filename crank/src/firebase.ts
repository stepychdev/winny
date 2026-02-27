/**
 * Firebase archive — saves round data to Firebase RTDB via REST API.
 * No service account needed — uses unauthenticated access
 * (database rules allow write-once to rounds/$roundId).
 */
import { USDC_DECIMALS, getParticipantPda, getRoundPda } from "./constants.js";
import type { RoundData } from "./parser.js";
import type { Program } from "@coral-xyz/anchor";

let dbUrl: string | null = null;

export function initFirebase(): boolean {
  const url = process.env.FIREBASE_DATABASE_URL;
  if (!url) {
    console.warn("[firebase] FIREBASE_DATABASE_URL not set — archive disabled");
    return false;
  }
  dbUrl = url.replace(/\/$/, ""); // strip trailing slash
  console.log("[firebase] Connected to", dbUrl);
  return true;
}

export interface ParticipantDeposit {
  address: string;
  usdc: number;
  tickets: number;
}

export interface HistoryRound {
  roundId: number;
  status: number;
  totalUsdc: number;
  totalTickets: number;
  participantsCount: number;
  winner: string;
  winningTicket: string;
  randomness: string;
  startTs: number;
  endTs: number;
  vaultUsdcAta: string;
  participants: string[];
  participantDeposits: ParticipantDeposit[];
  archivedAt: number;
}

/**
 * Build a HistoryRound with per-participant deposits from on-chain PDAs.
 */
export async function buildHistoryRound(
  rd: RoundData,
  program: Program,
  roundId: number
): Promise<HistoryRound> {
  const roundPda = getRoundPda(roundId);
  const deposits: ParticipantDeposit[] = [];

  for (let i = 0; i < rd.participantsCount; i++) {
    const addr = rd.participants[i];
    const addrStr = addr.toBase58();
    try {
      const partPda = getParticipantPda(roundPda, addr);
      const pData = await (program.account as any).participant.fetch(partPda);
      deposits.push({
        address: addrStr,
        usdc: Number(pData.usdcTotal.toString()) / 10 ** USDC_DECIMALS,
        tickets: Number(pData.ticketsTotal.toString()),
      });
    } catch {
      // Fallback: PDA already closed
      deposits.push({
        address: addrStr,
        usdc: Number(rd.totalUsdc) / 10 ** USDC_DECIMALS / rd.participantsCount,
        tickets: Math.floor(Number(rd.totalTickets) / rd.participantsCount),
      });
    }
  }

  return {
    roundId: Number(rd.roundId),
    status: rd.status,
    totalUsdc: Number(rd.totalUsdc) / 10 ** USDC_DECIMALS,
    totalTickets: Number(rd.totalTickets),
    participantsCount: rd.participantsCount,
    winner: rd.winner.toBase58(),
    winningTicket: rd.winningTicket.toString(),
    randomness: Buffer.from(rd.randomness).toString("hex"),
    startTs: Number(rd.startTs),
    endTs: Number(rd.endTs),
    vaultUsdcAta: rd.vaultUsdcAta.toBase58(),
    participants: rd.participants.map((p) => p.toBase58()),
    participantDeposits: deposits,
    archivedAt: Date.now(),
  };
}

/**
 * Save round to Firebase RTDB via REST API (PUT).
 * Write-once: will silently ignore 401/403 (already exists per rules).
 */
export async function saveRoundToFirebase(round: HistoryRound): Promise<boolean> {
  if (!dbUrl) return false;
  try {
    const url = `${dbUrl}/rounds/${round.roundId}.json`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(round),
    });
    if (res.ok) return true;
    // 401/403 = already exists (write-once rule)
    if (res.status === 401 || res.status === 403) return true;
    const text = await res.text();
    console.error(`[firebase] Save round ${round.roundId} HTTP ${res.status}: ${text}`);
    return false;
  } catch (e: any) {
    console.error(`[firebase] Save round ${round.roundId} failed:`, e.message);
    return false;
  }
}

/**
 * Get the highest archived round ID via REST API.
 */
export async function getMaxArchivedRoundId(): Promise<number> {
  if (!dbUrl) return 0;
  try {
    const url = `${dbUrl}/rounds.json?orderBy="$key"&limitToLast=1`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = await res.json();
    if (!data || typeof data !== "object") return 0;
    const keys = Object.keys(data);
    return keys.length > 0 ? Number(keys[0]) : 0;
  } catch {
    return 0;
  }
}
