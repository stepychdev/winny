import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  USDC_DECIMALS,
} from "../lib/constants";
import { getRoundPda, getParticipantPda, parseRound, type RoundData } from "../lib/program";
import { fetchRoundsFromFirebase, getMaxArchivedRoundId } from "../lib/roundArchive";

export interface ParticipantDeposit {
  address: string;
  usdc: number;    // human-readable (e.g. 100.50)
  tickets: number; // raw ticket count
}

export interface HistoryRound {
  roundId: number;
  status: number;
  totalUsdc: number;
  totalTickets: number;
  participantsCount: number;
  winner: string;
  winningTicket: bigint;
  randomness: string;
  startTs: number;
  endTs: number;
  claimTx?: string;
  vaultUsdcAta: string;
  participants: string[];
  participantDeposits?: ParticipantDeposit[];
}

export function toHistoryRound(rd: RoundData, deposits?: ParticipantDeposit[]): HistoryRound {
  return {
    roundId: Number(rd.roundId),
    status: rd.status,
    totalUsdc: Number(rd.totalUsdc) / 10 ** USDC_DECIMALS,
    totalTickets: Number(rd.totalTickets),
    participantsCount: rd.participantsCount,
    winner: rd.winner.toBase58(),
    winningTicket: rd.winningTicket,
    randomness: Buffer.from(rd.randomness).toString("hex"),
    startTs: Number(rd.startTs),
    endTs: Number(rd.endTs),
    claimTx: undefined,
    vaultUsdcAta: rd.vaultUsdcAta.toBase58(),
    participants: rd.participants.map(p => p.toBase58()),
    participantDeposits: deposits,
  };
}

/**
 * Build a HistoryRound with per-participant deposit data fetched from on-chain PDAs.
 * Must be called BEFORE close_round deallocates the accounts.
 */
export async function toHistoryRoundWithDeposits(
  rd: RoundData,
  program: any,
  roundId: number,
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
      // Fallback: participant PDA already closed — equal split estimate
      deposits.push({
        address: addrStr,
        usdc: Number(rd.totalUsdc) / 10 ** USDC_DECIMALS / rd.participantsCount,
        tickets: Math.floor(Number(rd.totalTickets) / rd.participantsCount),
      });
    }
  }
  return toHistoryRound(rd, deposits);
}

/** How many rounds to probe when finding the highest existing round ID */
const PROBE_BATCH = 20;
/** How many rounds per page */
const PAGE_SIZE = 10;

/**
 * Find the highest existing round ID via forward scan + binary search.
 * Much cheaper than scanning every single round.
 */
export async function findMaxRoundId(
  connection: ReturnType<typeof useConnection>["connection"]
): Promise<number> {
  // Forward scan: jump by PROBE_BATCH to find upper bound
  let low = 1;
  let high = 1;

  // Also check Firebase for archived (closed) rounds
  const archivedMax = await getMaxArchivedRoundId();
  if (archivedMax > 0) {
    low = archivedMax;
    high = archivedMax;
  }

  // Find an upper bound where rounds no longer exist
  while (true) {
    const pdas: PublicKey[] = [];
    for (let i = 0; i < PROBE_BATCH; i++) {
      pdas.push(getRoundPda(high + i));
    }
    const infos = await connection.getMultipleAccountsInfo(pdas);
    const anyExist = infos.some((info) => info !== null);
    if (!anyExist) break;

    // Find last existing in this batch
    for (let i = infos.length - 1; i >= 0; i--) {
      if (infos[i]) {
        low = high + i;
        break;
      }
    }
    high = high + PROBE_BATCH;
  }

  // Binary search between low and high for the exact max
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const pda = getRoundPda(mid);
    const info = await connection.getAccountInfo(pda);
    if (info) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // Ensure we don't return less than the archived max
  return Math.max(low, archivedMax);
}

/**
 * Fetch a batch of rounds by IDs using a single getMultipleAccountsInfo call.
 * Falls back to Firebase for closed (null) accounts.
 */
export async function fetchRoundBatch(
  connection: ReturnType<typeof useConnection>["connection"],
  ids: number[]
): Promise<HistoryRound[]> {
  if (ids.length === 0) return [];

  const pdas = ids.map((id) => getRoundPda(id));
  const infos = await connection.getMultipleAccountsInfo(pdas);
  const results: HistoryRound[] = [];
  const missingIds: number[] = [];

  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    if (!info) {
      missingIds.push(ids[i]);
      continue;
    }
    try {
      const rd = parseRound(info.data as Buffer);
      results.push(toHistoryRound(rd));
    } catch {
      // skip unparseable
    }
  }

  // Fallback to Firebase for closed/missing accounts
  if (missingIds.length > 0) {
    try {
      const archived = await fetchRoundsFromFirebase(missingIds);
      results.push(...archived);
      console.log(`[fetchRoundBatch] Fetched ${results.length} from blockchain, ${archived.length} from Firebase (missing: ${missingIds.length})`);
    } catch (e) {
      console.warn("Firebase fallback failed:", e);
    }
  } else {
    console.log(`[fetchRoundBatch] Fetched all ${results.length} rounds from blockchain`);
  }

  return results;
}

/** How often to auto-refresh the current page (ms) */
const POLL_INTERVAL = 15000;

export function useRoundHistory() {
  const { connection } = useConnection();
  const [rounds, setRounds] = useState<HistoryRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const maxRoundIdRef = useRef(0);
  const pollPageRef = useRef(0);

  /** Initial load: find max round, fetch first page (newest rounds) */
  const fetchInitial = useCallback(async () => {
    setLoading(true);
    try {
      const maxId = await findMaxRoundId(connection);
      maxRoundIdRef.current = maxId;

      if (maxId <= 0) {
        setRounds([]);
        setTotalPages(0);
        return;
      }

      setTotalPages(Math.ceil(maxId / PAGE_SIZE));

      // First page: newest rounds (maxId down to maxId - PAGE_SIZE + 1)
      const startId = Math.max(1, maxId - PAGE_SIZE + 1);
      const ids: number[] = [];
      for (let id = maxId; id >= startId; id--) {
        ids.push(id);
      }

      const batch = await fetchRoundBatch(connection, ids);
      batch.sort((a, b) => b.roundId - a.roundId);
      setRounds(batch);
      setPage(0);
    } catch (e) {
      console.error("Failed to fetch round history:", e);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  /** Go to specific page (replaces current data) */
  const goToPage = useCallback(async (targetPage: number) => {
    const maxId = maxRoundIdRef.current;
    if (maxId <= 0) return;

    setLoading(true);
    try {
      const endId = maxId - targetPage * PAGE_SIZE;
      const startId = Math.max(1, endId - PAGE_SIZE + 1);

      if (endId < 1) {
        setRounds([]);
        return;
      }

      const ids: number[] = [];
      for (let id = endId; id >= startId; id--) {
        ids.push(id);
      }

      const batch = await fetchRoundBatch(connection, ids);
      batch.sort((a, b) => b.roundId - a.roundId);

      setRounds(batch);
      setPage(targetPage);
    } catch (e) {
      console.error("Failed to go to page:", e);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  /** Full refresh */
  const refresh = useCallback(async () => {
    maxRoundIdRef.current = 0;
    setPage(0);
    await fetchInitial();
  }, [fetchInitial]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // Auto-refresh: silently re-fetch current page data every POLL_INTERVAL
  // Pauses when tab is hidden to save RPC credits.
  useEffect(() => {
    const tick = async () => {
      const maxId = maxRoundIdRef.current;
      if (maxId <= 0) return;

      try {
        // Re-check for new rounds
        const newMax = await findMaxRoundId(connection);
        if (newMax > maxId) {
          maxRoundIdRef.current = newMax;
          setTotalPages(Math.ceil(newMax / PAGE_SIZE));
        }
        const effectiveMax = Math.max(maxId, newMax);
        const currentPage = pollPageRef.current;

        const endId = effectiveMax - currentPage * PAGE_SIZE;
        const startId = Math.max(1, endId - PAGE_SIZE + 1);
        if (endId < 1) return;

        const ids: number[] = [];
        for (let id = endId; id >= startId; id--) ids.push(id);

        const batch = await fetchRoundBatch(connection, ids);
        batch.sort((a, b) => b.roundId - a.roundId);
        setRounds(batch);
      } catch {
        // silent — don't break UI on transient RPC errors
      }
    };

    let timer: ReturnType<typeof setInterval>;
    const start = () => { timer = setInterval(tick, POLL_INTERVAL); };
    const stop = () => clearInterval(timer);

    start();

    const onVisibility = () => {
      if (document.hidden) { stop(); }
      else { tick(); start(); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [connection]);

  // Keep pollPageRef in sync
  useEffect(() => { pollPageRef.current = page; }, [page]);

  return {
    rounds,
    loading,
    page,
    totalPages,
    goToPage,
    refresh,
  };
}
