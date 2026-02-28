import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, TransactionMessage, type AccountInfo, VersionedTransaction } from "@solana/web3.js";
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  getJupiterQuote,
  getJupiterSwapInstructions,
  buildSwapAndDepositTx,
  buildMultiSwapAndDepositTx,
  buildClaimAndSwapTx,
  type JupiterQuote,
} from "../lib/jupiterClient";
import { fetchTokenMetadataBatch } from "../lib/tokenMetadata";
import {
  USDC_MINT,
  ADMIN_PUBKEY,
  USDC_DECIMALS,
  TICKET_UNIT,
  DEGEN_FALLBACK_REASON_NO_VIABLE_ROUTE,
  DegenModeStatus,
  IS_MAINNET,
  MAX_MULTI_DEPOSIT_LEGS,
  RoundStatus,
  VRF_REIMBURSEMENT_USDC_RAW,
  WHEEL_RESULT_REVEAL_DELAY_MS,
} from "../lib/constants";
import { phaseFromStatus } from "../lib/roundPhase";
import { fetchTokenMetadata } from "../lib/tokenMetadata";
import {
  type Jackpot,
  type RoundData,
  fetchConfig,
  fetchRound,
  getRoundPda,
  getParticipantPda,
  parseParticipant,
  parseRound,
  buildDepositAny,
  buildClaim,
  buildClaimDegenFallback,
  buildRequestDegenVrf,
  buildCancelRound,
  buildClaimRefund,
  fetchDegenClaim,
  getProgram,
} from "../lib/program";
import { saveRoundToFirebase, getMaxArchivedRoundId, fetchRoundFromFirebase } from "../lib/roundArchive";
import { toHistoryRoundWithDeposits } from "./useRoundHistory";
import type { Participant, GamePhase } from "../types";
import { PARTICIPANT_COLORS } from "../mocks";
import { useAccountSubscription } from "./useAccountSubscription";
import {
  deriveDegenCandidates,
  fetchDegenTokenMeta,
  getDegenPoolVersion,
  isUsdcCandidate,
} from "../lib/degenClaim";

const POLL_FAST = 3000;   // active game: open / countdown / spinning
const POLL_SLOW = 10000;  // idle: waiting / settled / claimed / cancelled
const AUTO_ADVANCE_DELAY = 2000;
const SETTLED_ADVANCE_DELAY = 10000; // 10s — enough for spin animation (5.5s) + brief winner modal (4.5s)

const UNCLAIMED_KEY = "jackpot_unclaimed";
const WSOL_MINT_STR = "So11111111111111111111111111111111111111112";
function decodeU64ToBigInt(v: any): bigint {
  if (typeof v === "bigint") return v;
  const bytes: Uint8Array = v instanceof Uint8Array ? v : new Uint8Array(v);
  let out = 0n;
  for (let i = 0; i < 8; i++) out |= BigInt(bytes[i] ?? 0) << (8n * BigInt(i));
  return out;
}

function normalizeAccountData(data: any): Uint8Array | null {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data) && typeof data[0] === "string") {
    // eslint-disable-next-line no-undef
    return Buffer.from(data[0], (data[1] as any) || "base64");
  }
  if (typeof data === "string") {
    // eslint-disable-next-line no-undef
    return Buffer.from(data, "base64");
  }
  return null;
}

function isTxTooLargeEncodingError(error: unknown): boolean {
  const msg =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    msg.includes("encoding overruns Uint8Array") ||
    msg.includes("Transaction too large") ||
    msg.includes("VersionedTransaction too large")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateVersionedTx(
  connection: Connection,
  tx: VersionedTransaction
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const serialized = tx.serialize();
    if (serialized.length > 1232) {
      return { ok: false, reason: `tx too large (${serialized.length} bytes)` };
    }
  } catch (error: any) {
    return { ok: false, reason: error?.message || "tx serialize failed" };
  }

  try {
    const result = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "processed",
    });
    if (result.value.err) {
      return {
        ok: false,
        reason: JSON.stringify(result.value.err),
      };
    }
    return { ok: true };
  } catch (error: any) {
    return { ok: false, reason: error?.message || "tx simulate failed" };
  }
}

function computeClaimPayoutRaw(
  round: RoundData,
  feeBps: number
): number {
  const totalUsdcRaw = Number(round.totalUsdc);
  const vrfReimburseRaw =
    !round.vrfPayer.equals(PublicKey.default) && round.vrfReimbursed === 0
      ? Math.min(VRF_REIMBURSEMENT_USDC_RAW, totalUsdcRaw)
      : 0;
  const potAfterReimburse = Math.max(0, totalUsdcRaw - vrfReimburseRaw);
  const feeRaw = Math.floor((potAfterReimburse * feeBps) / 10_000);
  return Math.max(0, potAfterReimburse - feeRaw);
}

export interface UnclaimedPrize {
  roundId: number;
  winnerAddress: string;
  payout: number;
  totalUsdc: number;
  timestamp: number;
}

/** Upsert a single unclaimed prize into the localStorage array */
function saveUnclaimedPrize(prize: UnclaimedPrize) {
  try {
    const existing = loadUnclaimedPrizes();
    const idx = existing.findIndex(p => p.roundId === prize.roundId);
    if (idx >= 0) existing[idx] = prize;
    else existing.push(prize);
    localStorage.setItem(UNCLAIMED_KEY, JSON.stringify(existing));
  } catch { }
}

/** Load all unclaimed prizes from localStorage (handles old single-object format too) */
export function loadUnclaimedPrizes(): UnclaimedPrize[] {
  try {
    const raw = localStorage.getItem(UNCLAIMED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    // Migration: old single-object format → wrap in array
    if (parsed && typeof parsed === 'object' && 'roundId' in parsed) {
      const arr = [parsed as UnclaimedPrize];
      localStorage.setItem(UNCLAIMED_KEY, JSON.stringify(arr));
      return arr;
    }
    return [];
  } catch { return []; }
}

/** Remove one unclaimed prize by roundId */
export function clearUnclaimedPrize(roundId: number) {
  try {
    const existing = loadUnclaimedPrizes().filter(p => p.roundId !== roundId);
    if (existing.length === 0) localStorage.removeItem(UNCLAIMED_KEY);
    else localStorage.setItem(UNCLAIMED_KEY, JSON.stringify(existing));
  } catch { }
}

export interface JackpotState {
  roundId: number;
  phase: GamePhase;
  timeLeft: number;
  participants: Participant[];
  totalUsdc: number;
  totalTickets: number;
  roundRandomnessHex: string | null;
  winner: Participant | null;
  myUsdcBalance: number;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  autoStatus: string | null;
  unclaimedPrizes: UnclaimedPrize[];
  deposit: (amount: number, mint?: string, quote?: JupiterQuote) => Promise<string>;
  depositMany: (legs: DepositLegInput[]) => Promise<string>;
  claim: () => Promise<string>;
  claimDegen: () => Promise<{
    claimSig: string;
    tokenMint: string | null;
    tokenIndex: number | null;
    tokenSymbol: string | null;
    fallback: boolean;
  }>;
  claimUnclaimed: (roundId: number) => Promise<string>;
  cancelRound: () => Promise<string>;
  claimRefund: () => Promise<string>;
  countdownStarted: boolean;
  nextRound: () => void;
  setPauseAutoAdvance: (paused: boolean) => void;
}

export interface DepositLegInput {
  amount: number;
  mint?: string;
  quote?: JupiterQuote;
}

/** Create a read-only Anchor program instance (no wallet needed). */
function makeReadOnlyProgram(connection: any): Program<Jackpot> {
  // Dummy wallet for building instructions only (never signs)
  const dummyKp = Keypair.generate();
  const provider = new AnchorProvider(
    connection,
    { publicKey: dummyKp.publicKey, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
    { commitment: "confirmed" }
  );
  return getProgram(provider);
}

export function useJackpot(): JackpotState {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction } = wallet;

  const [roundId, setRoundId] = useState(1);
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [timeLeft, setTimeLeft] = useState(0);
  const [myUsdcBalance, setMyUsdcBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const [unclaimedPrizes, setUnclaimedPrizes] = useState<UnclaimedPrize[]>([]);
  const [initialized, setInitialized] = useState(false);

  const isAdmin = !!publicKey && publicKey.equals(ADMIN_PUBKEY);

  // Read-only program for building instructions
  const program = useMemo(() => makeReadOnlyProgram(connection), [connection]);

  // Settled rounds found during startup scan — saved before wallet connects
  const pendingSettledRef = useRef<{ roundId: number; winner: string; totalUsdc: number }[]>([]);

  // ─── Deposit token tracking (what tokens each participant deposited) ──
  const depositTokensCacheRef = useRef<{
    roundId: number;
    map: Map<string, { symbol: string; icon: string }[]>;
    processedSigs: Set<string>;
    resolving: boolean;
  }>({ roundId: 0, map: new Map(), processedSigs: new Set(), resolving: false });

  // ─── Find latest active round on startup ───────────
  useEffect(() => {
    if (initialized) return;
    (async () => {
      try {
        let activeRound = 0;
        let maxExisting = 0;
        let nullStreak = 0;
        const settledRounds: { id: number; winner: string; totalUsdc: number }[] = [];

        // Use Firebase max archived ID as a scan start hint — skip closed rounds
        let scanStart = 1;
        try {
          const archivedMax = await getMaxArchivedRoundId();
          if (archivedMax > 0) scanStart = Math.max(1, archivedMax - 2);
        } catch { }

        // Scan rounds, skipping gaps from closed rounds
        for (let id = scanStart; id <= scanStart + 50; id++) {
          const data = await fetchRound(connection, id);
          if (!data) {
            nullStreak++;
            if (maxExisting > 0 && nullStreak >= 5) break;
            continue;
          }
          nullStreak = 0;
          maxExisting = id;
          const st = data.status;
          if (st === RoundStatus.Open || st === RoundStatus.Locked || st === RoundStatus.VrfRequested || st === RoundStatus.Settled) {
            activeRound = id;
          }
          if (st === RoundStatus.Settled) {
            const winnerKey = data.winner;
            if (!winnerKey.equals(PublicKey.default)) {
              settledRounds.push({
                id,
                winner: winnerKey.toBase58(),
                totalUsdc: Number(data.totalUsdc) / 10 ** USDC_DECIMALS,
              });
            }
          }
        }
        if (settledRounds.length > 0) {
          pendingSettledRef.current = settledRounds.map(r => ({
            roundId: r.id,
            winner: r.winner,
            totalUsdc: r.totalUsdc,
          }));
        }
        const latestActive = activeRound > 0 ? activeRound : maxExisting + 1;
        console.log("Auto-detected roundId:", latestActive, "(maxExisting:", maxExisting, ")");
        setRoundId(latestActive);
      } catch (e) {
        console.error("Round detection failed:", e);
      } finally {
        setInitialized(true);
      }
    })();
  }, [connection, initialized]);

  // ─── Resolve deposit tokens from round PDA tx signatures ──
  const resolveDepositTokens = useCallback(async (
    roundPda: PublicKey,
    participantAddresses: string[],
  ) => {
    const cache = depositTokensCacheRef.current;
    if (cache.resolving) return;
    // Only resolve for unresolved participants
    const unresolved = participantAddresses.filter(a => !cache.map.has(a));
    if (unresolved.length === 0) return;

    cache.resolving = true;
    try {
      const sigs = await connection.getSignaturesForAddress(roundPda, { limit: 50 });
      const newSigs = sigs.filter(s => !cache.processedSigs.has(s.signature) && !s.err);
      if (newSigs.length === 0) { cache.resolving = false; return; }

      const mintsByUser = new Map<string, Set<string>>();
      const USDC_MINT_STR = USDC_MINT.toBase58();

      for (const sigInfo of newSigs) {
        try {
          const tx = await connection.getParsedTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (!tx?.meta) { cache.processedSigs.add(sigInfo.signature); continue; }

          // Signer = depositor (v0 txs have source: 'transaction'|'lookupTable')
          const signerKey = tx.transaction.message.accountKeys
            .find((k: any) => k.signer && k.source !== 'lookupTable');
          const signer = signerKey
            ? (typeof signerKey === 'string' ? signerKey : signerKey.pubkey?.toBase58?.() || String(signerKey.pubkey))
            : null;
          if (!signer || !participantAddresses.includes(signer)) {
            cache.processedSigs.add(sigInfo.signature);
            continue;
          }

          const pre = tx.meta.preTokenBalances || [];
          const post = tx.meta.postTokenBalances || [];

          for (const preB of pre) {
            if (preB.owner !== signer) continue;
            const mint = preB.mint;
            if (mint === USDC_MINT_STR) continue;

            const postB = post.find((p: any) => p.mint === mint && p.owner === signer);
            const preAmt = Number(preB.uiTokenAmount?.uiAmount || 0);
            const postAmt = Number(postB?.uiTokenAmount?.uiAmount || 0);

            if (preAmt > postAmt) {
              if (!mintsByUser.has(signer)) mintsByUser.set(signer, new Set());
              mintsByUser.get(signer)!.add(mint);
            }
          }
        } catch { /* skip failed tx fetch */ }
        cache.processedSigs.add(sigInfo.signature);
      }

      // Resolve metadata for discovered mints
      const allMints = new Set<string>();
      for (const mints of mintsByUser.values()) {
        for (const m of mints) allMints.add(m);
      }

      if (allMints.size > 0) {
        const metaMap = await fetchTokenMetadataBatch(
          connection,
          Array.from(allMints).map(m => new PublicKey(m)),
        );

        for (const [addr, mints] of mintsByUser) {
          const tokens: { symbol: string; icon: string }[] = [];
          for (const mint of mints) {
            const meta = metaMap.get(mint);
            // WSOL → show as SOL
            const isWsol = mint === WSOL_MINT_STR;
            tokens.push({
              symbol: isWsol ? 'SOL' : (meta?.symbol || mint.slice(0, 4)),
              icon: meta?.image || '',
            });
          }
          const existing = cache.map.get(addr) || [];
          const merged = [...existing];
          for (const t of tokens) {
            if (!merged.some(e => e.symbol === t.symbol)) merged.push(t);
          }
          cache.map.set(addr, merged);
        }
      }
    } catch (e) {
      console.error('Error resolving deposit tokens:', e);
    } finally {
      cache.resolving = false;
    }
  }, [connection]);

  // ─── Process round data (shared by HTTP poll and WS callback) ─
  const processRoundData = useCallback(async (data: RoundData) => {
    // Guard: discard stale results if roundId has already advanced
    if (Number(data.roundId) !== roundId) return;
    setRoundData(data);

    const now = Math.floor(Date.now() / 1000);
    setPhase(phaseFromStatus(data.status, data.endTs, now));

    const end = Number(data.endTs);
    setTimeLeft(end > 0 ? Math.max(0, end - now) : 0);

    // Build participants list (batch fetch — single RPC call)
    const parts: Participant[] = [];
    const roundPda = getRoundPda(roundId);
    const count = data.participantsCount;

    // Reset deposit tokens cache when round changes
    if (depositTokensCacheRef.current.roundId !== roundId) {
      depositTokensCacheRef.current = {
        roundId, map: new Map(), processedSigs: new Set(), resolving: false,
      };
    }

    // Fetch USDC icon once (not per-participant)
    let usdcIcon = "";
    try {
      const usdcMeta = await fetchTokenMetadata(connection, USDC_MINT);
      if (usdcMeta?.image) usdcIcon = usdcMeta.image;
    } catch { }

    if (count > 0) {
      // Derive all participant PDAs at once
      const pdas = data.participants.slice(0, count).map(addr =>
        getParticipantPda(roundPda, addr)
      );

      // Single batch RPC call instead of N individual fetches
      const infos = await connection.getMultipleAccountsInfo(pdas);

      for (let i = 0; i < count; i++) {
        const addr = data.participants[i];
        const addrStr = addr.toBase58();
        let tickets = 0;
        let usdcAmt = 0;

        const info = infos[i];
        if (info?.data) {
          try {
            const pData = parseParticipant(info.data as Buffer);
            tickets = Number(pData.ticketsTotal);
            usdcAmt = Number(pData.usdcTotal) / 10 ** USDC_DECIMALS;
          } catch {
            usdcAmt = Number(data.totalUsdc) / 10 ** USDC_DECIMALS / count;
            tickets = Math.floor(usdcAmt * 1_000_000 / TICKET_UNIT);
          }
        } else {
          // Participant PDA closed or not found — equal split fallback
          usdcAmt = Number(data.totalUsdc) / 10 ** USDC_DECIMALS / count;
          tickets = Math.floor(usdcAmt * 1_000_000 / TICKET_UNIT);
        }

        // Use cached deposit tokens if available, fallback to USDC
        const cachedTokens = depositTokensCacheRef.current.map.get(addrStr);
        const displayTokens = cachedTokens && cachedTokens.length > 0
          ? cachedTokens.map(t => ({ symbol: t.symbol, amount: usdcAmt, icon: t.icon }))
          : [{ symbol: "USDC", amount: usdcAmt, icon: usdcIcon }];

        parts.push({
          address: addrStr,
          displayName:
            publicKey && addr.equals(publicKey)
              ? "You"
              : `${addrStr.slice(0, 4)}...${addrStr.slice(-4)}`,
          color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
          usdcAmount: usdcAmt,
          tickets,
          tokens: displayTokens,
        });
      }

      // Fire-and-forget: resolve deposit tokens for unresolved participants
      // Results will be picked up on the next poll/WS cycle
      resolveDepositTokens(roundPda, parts.map(p => p.address));
    }
    setParticipants(parts);
  }, [connection, roundId, publicKey, resolveDepositTokens]);

  // ─── Poll round data ──────────────────────────────
  const pollRound = useCallback(async () => {
    try {
      const data = await fetchRound(connection, roundId);
      if (!data) {
        setRoundData(null);
        setPhase("waiting");
        setParticipants([]);
        return;
      }
      await processRoundData(data);
    } catch (e: any) {
      console.error("Poll error:", e);
    }
  }, [connection, roundId, processRoundData]);

  // ─── Poll USDC balance (lightweight — single ATA query) ─
  const pollBalance = useCallback(async () => {
    if (!publicKey) { setMyUsdcBalance(0); return; }
    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const resp = await connection.getTokenAccountBalance(ata).catch(() => null);
      if (resp?.value) {
        setMyUsdcBalance(Number(resp.value.amount) / 10 ** USDC_DECIMALS);
      } else {
        setMyUsdcBalance(0);
      }
    } catch {
      setMyUsdcBalance(0);
    }
  }, [connection, publicKey]);

  // ─── WebSocket subscription: round PDA ─────────────
  const roundPda = useMemo(
    () => (initialized ? getRoundPda(roundId) : null),
    [roundId, initialized],
  );
  const lastWsRef = useRef(0);

  const handleRoundWs = useCallback(
    (info: AccountInfo<Buffer>) => {
      lastWsRef.current = Date.now();
      try {
        const data = parseRound(info.data as Buffer);
        processRoundData(data);
      } catch (e) {
        console.warn("WS round parse error:", e);
      }
    },
    [processRoundData],
  );

  const { wsConnected } = useAccountSubscription({
    account: roundPda,
    onData: handleRoundWs,
  });

  // ─── WebSocket subscription: USDC balance ─────────
  const userAta = useMemo(() => {
    if (!publicKey) return null;
    // getAssociatedTokenAddress is async, but the derivation is deterministic —
    // use sync PDA derivation for the subscription key.
    const [ata] = PublicKey.findProgramAddressSync(
      [publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC_MINT.toBuffer()],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), // Associated Token Program
    );
    return ata;
  }, [publicKey]);

  const handleBalanceWs = useCallback(
    (info: AccountInfo<Buffer>) => {
      try {
        const decoded = AccountLayout.decode(info.data);
        setMyUsdcBalance(Number(decoded.amount) / 10 ** USDC_DECIMALS);
      } catch {
        // Ignore decode errors — next poll will correct
      }
    },
    [],
  );

  useAccountSubscription({
    account: userAta,
    onData: handleBalanceWs,
  });

  // Adaptive polling: fast during active gameplay, slow in idle states.
  // When WS is active and fresh (<15s), use slower fallback polling (30s).
  // Pauses when browser tab is hidden. Balance polled only on initial load.
  const POLL_WS_FALLBACK = 30000;
  const WS_FRESH_THRESHOLD = 15000;
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    if (!initialized) return;
    pollRound();
    pollBalance(); // initial balance fetch

    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const p = phaseRef.current;
      const fast = p === 'open' || p === 'countdown' || p === 'spinning';

      // When WS is active and fresh, use slower fallback polling
      const wsFresh = wsConnected && (Date.now() - lastWsRef.current) < WS_FRESH_THRESHOLD;
      const interval = wsFresh ? POLL_WS_FALLBACK : (fast ? POLL_FAST : POLL_SLOW);

      timer = setTimeout(async () => {
        await pollRound();
        schedule();
      }, interval);
    };

    schedule();

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        stopped = true;
      } else {
        stopped = false;
        pollRound();
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollRound, pollBalance, initialized, wsConnected]);

  // Countdown timer
  useEffect(() => {
    if (phase !== "open" && phase !== "countdown") return;
    const id = setInterval(() => {
      if (!roundData) return;
      const now = Math.floor(Date.now() / 1000);
      const end = Number(roundData.endTs);
      const left = end > 0 ? Math.max(0, end - now) : 0;
      setTimeLeft(left);
      if (left <= 6 && left > 0 && phase === "open") setPhase("countdown");
    }, 1000);
    return () => clearInterval(id);
  }, [phase, roundData]);

  // ─── Auto-status from polling ──────────────────────
  // Crank service handles lock/VRF/close — frontend just observes phase transitions.
  useEffect(() => {
    if (!roundData) return;
    const status = roundData.status;
    if (status === RoundStatus.Locked || status === RoundStatus.VrfRequested) {
      setAutoStatus("Waiting for randomness...");
    } else if (status >= RoundStatus.Settled) {
      setAutoStatus(null);
    } else {
      setAutoStatus(null);
    }
  }, [roundData]);

  // Load unclaimed prizes from localStorage + startup scan.
  // Depends on `initialized` so it re-runs after startup scan completes (fixes race condition).
  useEffect(() => {
    if (!publicKey || !initialized) {
      setUnclaimedPrizes([]);
      return;
    }
    const walletAddr = publicKey.toBase58();

    (async () => {
      const result: UnclaimedPrize[] = [];

      // 1. Load from localStorage — validate each on-chain
      const saved = loadUnclaimedPrizes().filter(p => p.winnerAddress === walletAddr);
      for (const prize of saved) {
        try {
          const data = await fetchRound(connection, prize.roundId);
          if (data && data.status === RoundStatus.Settled) {
            result.push(prize);
          } else {
            clearUnclaimedPrize(prize.roundId);
          }
        } catch {
          result.push(prize); // keep on error — be conservative
        }
      }

      // 2. Check pending settled rounds from startup scan
      for (const pending of pendingSettledRef.current) {
        if (pending.winner !== walletAddr) continue;
        if (result.some(p => p.roundId === pending.roundId)) continue; // already have it
        const fee = pending.totalUsdc * 0.0025;
        const prize: UnclaimedPrize = {
          roundId: pending.roundId,
          winnerAddress: pending.winner,
          payout: pending.totalUsdc - fee,
          totalUsdc: pending.totalUsdc,
          timestamp: Date.now(),
        };
        saveUnclaimedPrize(prize);
        result.push(prize);
      }
      pendingSettledRef.current = [];

      setUnclaimedPrizes(result);
    })();
  }, [publicKey, connection, initialized]);

  // Save unclaimed prize to localStorage when round settles and current user is winner
  useEffect(() => {
    if (phase !== "settled" || !roundData || !publicKey) return;
    // Use roundData.roundId (on-chain truth) — not the state `roundId` which may have already advanced
    const dataRoundId = Number(roundData.roundId);
    if (dataRoundId !== roundId) return; // stale data, skip
    const winnerKey = roundData.winner;
    if (winnerKey.equals(PublicKey.default)) return;
    if (winnerKey.toBase58() !== publicKey.toBase58()) return;

    const totalUsdc = Number(roundData.totalUsdc) / 10 ** USDC_DECIMALS;
    const fee = totalUsdc * 0.0025;
    const prize: UnclaimedPrize = {
      roundId: dataRoundId,
      winnerAddress: winnerKey.toBase58(),
      payout: totalUsdc - fee,
      totalUsdc,
      timestamp: Date.now(),
    };
    const revealTimer = setTimeout(() => {
      saveUnclaimedPrize(prize);
      setUnclaimedPrizes(prev => {
        if (prev.some(p => p.roundId === dataRoundId)) return prev;
        return [...prev, prize];
      });
    }, WHEEL_RESULT_REVEAL_DELAY_MS);

    return () => clearTimeout(revealTimer);
  }, [phase, roundData, publicKey, roundId]);

  // Clear unclaimed prize when round gets claimed
  useEffect(() => {
    if (phase === "claimed" && unclaimedPrizes.some(p => p.roundId === roundId)) {
      clearUnclaimedPrize(roundId);
      setUnclaimedPrizes(prev => prev.filter(p => p.roundId !== roundId));
    }
  }, [phase, roundId, unclaimedPrizes]);

  // Flag to pause auto-advance (e.g. while winner modal is open)
  const pauseAutoAdvanceRef = useRef(false);
  const setPauseAutoAdvance = useCallback((paused: boolean) => {
    pauseAutoAdvanceRef.current = paused;
  }, []);

  // Auto-advance to next round after claimed/cancelled/settled
  // Round creation is NOT done here — the crank service handles it.
  useEffect(() => {
    if (phase !== "claimed" && phase !== "cancelled" && phase !== "settled") return;

    // Minimal delay before advancing — winner can claim later from any round
    const delay = phase === "settled" ? SETTLED_ADVANCE_DELAY : AUTO_ADVANCE_DELAY;

    const id = setTimeout(() => {
      // Don't advance while winner modal is open
      if (pauseAutoAdvanceRef.current) return;
      setRoundId(prev => prev + 1);
      setRoundData(null);
      setParticipants([]);
      setPhase("waiting");
      setTimeLeft(0);
    }, delay);
    return () => clearTimeout(id);
  }, [phase, roundId]);

  // NOTE: Round creation is now handled by the autonomous crank service.
  // The frontend simply polls for the active round.

  // ─── User Actions ─────────────────────────────────

  const depositMany = useCallback(
    async (legs: DepositLegInput[]): Promise<string> => {
      if (!publicKey) throw new Error("Wallet not connected");
      if (!Array.isArray(legs) || legs.length === 0) {
        throw new Error("No deposit legs provided.");
      }

      const normalized = legs.map((leg) => ({
        amount: leg.amount,
        mint: (leg.mint || USDC_MINT.toBase58()).trim(),
        quote: leg.quote,
      }));

      if (normalized.length > MAX_MULTI_DEPOSIT_LEGS) {
        throw new Error(`Too many tokens in one deposit (max ${MAX_MULTI_DEPOSIT_LEGS}).`);
      }

      const seenMints = new Set<string>();
      let wsolLegCount = 0;
      for (const leg of normalized) {
        if (!Number.isFinite(leg.amount) || leg.amount <= 0) {
          throw new Error("Deposit amount must be greater than 0.");
        }
        if (seenMints.has(leg.mint)) {
          throw new Error(`Duplicate token in batch: ${leg.mint}. Merge amounts and retry.`);
        }
        seenMints.add(leg.mint);
        if (leg.mint === WSOL_MINT_STR) wsolLegCount++;
      }
      if (wsolLegCount > 1) {
        throw new Error("Only one SOL/WSOL leg is supported per batch deposit.");
      }

      setLoading(true);
      setError(null);
      try {
        setAutoStatus(normalized.length > 1 ? "Preparing batch deposit..." : null);
        const usdcAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);
        const balInfo = await connection.getTokenAccountBalance(usdcAta).catch(() => null);
        const rawUsdcBalance = balInfo ? new BN(balInfo.value.amount) : new BN(0);

        // Wait for round to exist — crank creates it after settling the previous one.
        // Retry a few times with short delays instead of failing immediately.
        // If the expected roundId doesn't exist, scan nearby IDs for an open round.
        let effectiveRoundId = roundId;
        const roundPda = getRoundPda(roundId);
        let roundInfo = await connection.getAccountInfo(roundPda);
        if (!roundInfo) {
          setAutoStatus("Waiting for round to be created...");
          const MAX_RETRIES = 6;
          const RETRY_DELAY_MS = 2000;
          for (let attempt = 0; attempt < MAX_RETRIES && !roundInfo; attempt++) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            roundInfo = await connection.getAccountInfo(roundPda);
          }
          // If still not found, scan nearby round IDs for an open round
          if (!roundInfo) {
            setAutoStatus("Searching for open round...");
            let foundId = 0;
            const scanIds = [roundId - 1, roundId + 1, roundId - 2, roundId + 2, roundId + 3];
            for (const candidateId of scanIds) {
              if (candidateId < 1) continue;
              const data = await fetchRound(connection, candidateId);
              if (data && data.status === RoundStatus.Open) {
                foundId = candidateId;
                break;
              }
            }
            if (foundId > 0) {
              effectiveRoundId = foundId;
              setRoundId(foundId);
              roundInfo = await connection.getAccountInfo(getRoundPda(foundId));
            } else {
              throw new Error("Round not created yet. Please wait a moment and try again.");
            }
          }
        }

        // Verify round is still Open before sending deposit
        const freshRound = await fetchRound(connection, effectiveRoundId);
        if (!freshRound || freshRound.status !== RoundStatus.Open) {
          throw new Error("Round is no longer accepting deposits.");
        }

        const usdcLegs = normalized.filter((leg) => leg.mint === USDC_MINT.toBase58());
        const swapLegs = normalized.filter((leg) => leg.mint !== USDC_MINT.toBase58());

        let directUsdcRaw = new BN(0);
        for (const leg of usdcLegs) {
          const raw = new BN(Math.floor(leg.amount * 10 ** USDC_DECIMALS));
          if (raw.lte(new BN(0))) {
            throw new Error("USDC deposit amount is too small.");
          }
          directUsdcRaw = directUsdcRaw.add(raw);
        }

        const prefixInstructions: TransactionInstruction[] = [];
        let usdcBalanceBefore = rawUsdcBalance;

        if (directUsdcRaw.gt(new BN(0))) {
          // Ensure ATA exists. The program expects the canonical ATA.
          prefixInstructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
              publicKey,
              usdcAta,
              publicKey,
              USDC_MINT
            )
          );

          // Top up ATA from other USDC accounts if needed so deposit_any can consume a single delta.
          const [v1] = await Promise.all([
            connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
          ]);
          const accounts = v1.value
            .map((a: any) => {
              const data = normalizeAccountData(a.account.data);
              if (!data || data.length < AccountLayout.span) return null;
              const decoded: any = AccountLayout.decode(data);
              const accMint = new PublicKey(decoded.mint);
              if (!accMint.equals(USDC_MINT)) return null;
              const raw = new BN(decodeU64ToBigInt(decoded.amount).toString());
              return { pubkey: a.pubkey as PublicKey, raw };
            })
            .filter(Boolean) as { pubkey: PublicKey; raw: BN }[];

          let ataRaw = new BN(0);
          const sources: { pubkey: PublicKey; raw: BN }[] = [];
          for (const a of accounts) {
            if (a.pubkey.equals(usdcAta)) ataRaw = a.raw;
            else if (a.raw.gt(new BN(0))) sources.push(a);
          }

          let movedToAta = new BN(0);
          if (ataRaw.lt(directUsdcRaw)) {
            let remaining = directUsdcRaw.sub(ataRaw);
            sources.sort((x, y) => y.raw.cmp(x.raw));
            for (const src of sources) {
              if (remaining.lte(new BN(0))) break;
              const move = src.raw.gte(remaining) ? remaining : src.raw;
              if (move.lte(new BN(0))) continue;
              prefixInstructions.push(
                createTransferInstruction(
                  src.pubkey,
                  usdcAta,
                  publicKey,
                  BigInt(move.toString()),
                  [],
                  TOKEN_PROGRAM_ID
                )
              );
              movedToAta = movedToAta.add(move);
              remaining = remaining.sub(move);
            }
          }

          const ataAfterTopup = ataRaw.add(movedToAta);
          if (ataAfterTopup.lt(directUsdcRaw)) {
            throw new Error("Insufficient USDC balance.");
          }
          // deposit_any computes delta against ATA balance before all intended inputs.
          usdcBalanceBefore = ataAfterTopup.sub(directUsdcRaw);
        }

        const preparedSwaps = await Promise.all(
          swapLegs.map(async (leg) => {
            let quote = leg.quote;
            if (quote) {
              if (
                quote.inputMint !== leg.mint ||
                quote.outputMint !== USDC_MINT.toBase58()
              ) {
                throw new Error(`Prefetched quote mint mismatch for ${leg.mint}`);
              }
            } else {
              let tokenDecimals = 9;
              if (leg.mint !== WSOL_MINT_STR) {
                try {
                  const tokenAta = await getAssociatedTokenAddress(
                    new PublicKey(leg.mint),
                    publicKey
                  );
                  const tokenBalInfo = await connection.getTokenAccountBalance(tokenAta);
                  tokenDecimals = tokenBalInfo.value.decimals;
                } catch (e) {
                  console.warn(
                    "Could not fetch token decimals, defaulting to 6",
                    leg.mint,
                    e
                  );
                  tokenDecimals = 6;
                }
              }

              const rawTokenAmount = Math.floor(leg.amount * 10 ** tokenDecimals).toString();
              if (rawTokenAmount === "0") {
                throw new Error(`Deposit amount is too small for token ${leg.mint}.`);
              }
              quote = await getJupiterQuote(
                leg.mint,
                USDC_MINT.toBase58(),
                rawTokenAmount,
                100
              );
            }

            const minOut = new BN(quote.otherAmountThreshold || quote.outAmount);
            if (minOut.lte(new BN(0))) {
              throw new Error(`Invalid Jupiter quote minOut for ${leg.mint}`);
            }

            const swapIxs = await getJupiterSwapInstructions(publicKey.toBase58(), quote);
            return { quote, minOut, swapIxs };
          })
        );

        const getCurrentUsdcAtaRaw = async (): Promise<BN> => {
          const currentBal = await connection.getTokenAccountBalance(usdcAta).catch(() => null);
          return new BN(currentBal ? currentBal.value.amount : "0");
        };

        let sentChunkCount = 0;
        const sendDepositChunk = async (
          swapChunk: typeof preparedSwaps,
          includeDirectUsdc: boolean
        ): Promise<string[]> => {
          const chunkDirectUsdcRaw = includeDirectUsdc ? directUsdcRaw : new BN(0);
          const chunkPrefixInstructions = includeDirectUsdc ? prefixInstructions : [];
          const chunkMinSwapOut = swapChunk.reduce((sum, s) => sum.add(s.minOut), new BN(0));
          const chunkMinOutTotal = chunkDirectUsdcRaw.add(chunkMinSwapOut);
          if (chunkMinOutTotal.lte(new BN(0))) {
            throw new Error("Total deposit amount is too small.");
          }

          const chunkUsdcBalanceBefore = includeDirectUsdc
            ? usdcBalanceBefore
            : await getCurrentUsdcAtaRaw();

          const chunkDepositIx = await buildDepositAny(
            program,
            publicKey,
            effectiveRoundId,
            chunkUsdcBalanceBefore,
            chunkMinOutTotal,
            USDC_MINT
          );

          try {
            let sig: string;
            if (swapChunk.length === 0) {
              sentChunkCount += 1;
              setAutoStatus(`Sending batch part ${sentChunkCount}...`);
              const tx = new Transaction();
              for (const ix of chunkPrefixInstructions) tx.add(ix);
              tx.add(chunkDepositIx);
              sig = await sendTransaction(tx, connection, { skipPreflight: true });
            } else if (swapChunk.length === 1 && chunkPrefixInstructions.length === 0) {
              sentChunkCount += 1;
              setAutoStatus(`Sending batch part ${sentChunkCount}...`);
              const versionedTx = await buildSwapAndDepositTx(
                connection,
                publicKey,
                swapChunk[0].swapIxs,
                chunkDepositIx,
                []
              );
              sig = await sendTransaction(versionedTx, connection, { skipPreflight: true });
            } else {
              sentChunkCount += 1;
              setAutoStatus(`Sending batch part ${sentChunkCount}...`);
              const versionedTx = await buildMultiSwapAndDepositTx(
                connection,
                publicKey,
                swapChunk.map((s) => s.swapIxs),
                chunkDepositIx,
                chunkPrefixInstructions
              );
              sig = await sendTransaction(versionedTx, connection, { skipPreflight: true });
            }

            return [sig];
          } catch (e) {
            if (!isTxTooLargeEncodingError(e)) throw e;

            // If the direct USDC top-up/prefix pushes a single swap over the packet size,
            // split into (direct USDC deposit) + (swap deposit) as two sequential txs.
            if (
              includeDirectUsdc &&
              swapChunk.length === 1 &&
              (chunkDirectUsdcRaw.gt(new BN(0)) || chunkPrefixInstructions.length > 0)
            ) {
              const a = await sendDepositChunk([], true);
              const b = await sendDepositChunk(swapChunk, false);
              return [...a, ...b];
            }

            if (swapChunk.length <= 1) {
              throw new Error(
                "Batch is too large for one transaction. Split into smaller deposits."
              );
            }

            const mid = Math.ceil(swapChunk.length / 2);
            const first = await sendDepositChunk(swapChunk.slice(0, mid), includeDirectUsdc);
            const second = await sendDepositChunk(swapChunk.slice(mid), false);
            return [...first, ...second];
          }
        };

        const chunkSigs = await sendDepositChunk(preparedSwaps, true);
        const sig = chunkSigs[chunkSigs.length - 1];
        if (chunkSigs.length > 1) {
          setAutoStatus(`Batch deposit complete (${chunkSigs.length} tx)`);
        } else {
          setAutoStatus(null);
        }

        // Track deposited tokens for the current user immediately
        if (publicKey) {
          const userAddr = publicKey.toBase58();
          const cache = depositTokensCacheRef.current;
          if (cache.roundId !== roundId) {
            depositTokensCacheRef.current = {
              roundId, map: new Map(), processedSigs: new Set(), resolving: false,
            };
          }
          const nonUsdcMints = normalized
            .filter(l => l.mint !== USDC_MINT.toBase58())
            .map(l => l.mint);
          if (nonUsdcMints.length > 0) {
            try {
              const metaMap = await fetchTokenMetadataBatch(
                connection,
                nonUsdcMints.map(m => new PublicKey(m)),
              );
              const tokens: { symbol: string; icon: string }[] = [];
              for (const mint of nonUsdcMints) {
                const isWsol = mint === WSOL_MINT_STR;
                const meta = metaMap.get(mint);
                tokens.push({
                  symbol: isWsol ? 'SOL' : (meta?.symbol || mint.slice(0, 4)),
                  icon: meta?.image || '',
                });
              }
              const existing = cache.map.get(userAddr) || [];
              const merged = [...existing];
              for (const t of tokens) {
                if (!merged.some(e => e.symbol === t.symbol)) merged.push(t);
              }
              cache.map.set(userAddr, merged);
            } catch { /* token metadata resolution failed, will be resolved on next poll */ }
          } else {
            // Direct USDC deposit — no special tracking needed (USDC is the default)
          }
        }

        await pollRound();
        await pollBalance();
        return sig;
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        // Clear transient deposit progress status after the UI has had a moment to render it.
        setTimeout(
          () =>
            setAutoStatus((prev) =>
              prev &&
              (prev.startsWith("Preparing batch deposit") ||
                prev.startsWith("Sending batch part") ||
                prev.startsWith("Batch deposit complete"))
                ? null
                : prev
            ),
          1500
        );
        setLoading(false);
      }
    },
    [program, publicKey, roundId, connection, sendTransaction, pollRound, pollBalance]
  );

  const deposit = useCallback(
    async (amount: number, mint?: string, quote?: JupiterQuote): Promise<string> => {
      return depositMany([{ amount, mint, quote }]);
    },
    [depositMany]
  );

  const claim = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected");
    setLoading(true);
    setError(null);
    try {
      // Pre-check: verify round is still in Settled state (not already claimed)
      const freshRound = await fetchRound(connection, roundId);
      if (!freshRound) {
        // Round PDA gone — crank already auto-claimed and closed it
        const archived = await fetchRoundFromFirebase(roundId).catch(() => null);
        clearUnclaimedPrize(roundId);
        setUnclaimedPrizes(prev => prev.filter(p => p.roundId !== roundId));
        await pollRound();
        await pollBalance();
        if (archived?.claimTx) {
          throw new Error("Prize was already auto-claimed to your wallet");
        }
        throw new Error("Round no longer exists on-chain (likely already claimed)");
      }
      if (freshRound.status === RoundStatus.Claimed) {
        // Already claimed — silently clean up local state and return
        clearUnclaimedPrize(roundId);
        setUnclaimedPrizes(prev => prev.filter(p => p.roundId !== roundId));
        await pollRound();
        await pollBalance();
        throw new Error("Prize already claimed");
      }
      if (freshRound.status !== RoundStatus.Settled) {
        throw new Error("Round is not in a claimable state");
      }

      const tx = new Transaction();

      // No VRF reimbursement — service wallet absorbs the ~$0.01 VRF cost
      const cfg = await fetchConfig(program);
      const ix = await buildClaim(
        program,
        publicKey,
        roundId,
        USDC_MINT,
        cfg.treasuryUsdcAta
      );
      tx.add(ix);
      const sig = await sendTransaction(tx, connection, { skipPreflight: true });

      // Clear unclaimed prize immediately after successful claim
      if (unclaimedPrizes.some(p => p.roundId === roundId)) {
        clearUnclaimedPrize(roundId);
        setUnclaimedPrizes(prev => prev.filter(p => p.roundId !== roundId));
      }

      // Archive round to Firebase (crank also archives, but this gives immediate history)
      // Force status=Claimed because fetchRound may return stale pre-confirmation data.
      try {
        const claimedData = await fetchRound(connection, roundId);
        if (claimedData) {
          const histRound = await toHistoryRoundWithDeposits(claimedData, program, roundId);
          await saveRoundToFirebase({ ...histRound, status: RoundStatus.Claimed, claimTx: sig });
        }
      } catch (e) {
        console.warn("Firebase archive failed (non-critical):", e);
      }

      // Let polling detect the "claimed" status → useEffect auto-advance handles the rest
      await pollRound();
      await pollBalance();
      return sig;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, roundId, connection, sendTransaction, pollRound, pollBalance, unclaimedPrizes]);

  const claimDegen = useCallback(
    async (): Promise<{
      claimSig: string;
      tokenMint: string | null;
      tokenIndex: number | null;
      tokenSymbol: string | null;
      fallback: boolean;
    }> => {
      if (!publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      try {
        const freshRound = await fetchRound(connection, roundId);
        if (!freshRound) {
          throw new Error("Round no longer exists on-chain");
        }
        if (freshRound.status === RoundStatus.Claimed) {
          throw new Error("Prize already claimed");
        }
        if (freshRound.status !== RoundStatus.Settled) {
          throw new Error("Round is not in a claimable state");
        }

        const current = await fetchDegenClaim(program, roundId, publicKey);
        let requestSig = "";

        if (!current || current.status === 0 || current.status === DegenModeStatus.None) {
          const reqTx = new Transaction();
          const reqIx = await buildRequestDegenVrf(program, publicKey, roundId);
          reqTx.add(reqIx);
          requestSig = await sendTransaction(reqTx, connection, { skipPreflight: true });
        }

        // Brief delay to let tx land before polling state
        await new Promise(r => setTimeout(r, 2000));
        const degen = await fetchDegenClaim(program, roundId, publicKey);
        if (!degen) {
          throw new Error("Degen VRF request was sent, but claim state is not available yet.");
        }

        await pollRound();
        await pollBalance();

        if (degen.status === DegenModeStatus.ClaimedFallback) {
          return {
            claimSig: requestSig,
            tokenMint: null,
            tokenIndex: null,
            tokenSymbol: null,
            fallback: true,
          };
        }

        if (degen.status === DegenModeStatus.ClaimedSwapped) {
          const tokenMint = degen.tokenMint.equals(PublicKey.default)
            ? null
            : degen.tokenMint.toBase58();
          const tokenSymbol = tokenMint
            ? (await fetchDegenTokenMeta(tokenMint)).symbol
            : null;
          return {
            claimSig: requestSig,
            tokenMint,
            tokenIndex: Number.isFinite(degen.tokenIndex) ? degen.tokenIndex : null,
            tokenSymbol,
            fallback: false,
          };
        }

        if (
          degen.status === DegenModeStatus.VrfRequested ||
          degen.status === DegenModeStatus.VrfReady ||
          degen.status === DegenModeStatus.Executing
        ) {
          return {
            claimSig: requestSig,
            tokenMint: null,
            tokenIndex: null,
            tokenSymbol: null,
            fallback: false,
          };
        }

        throw new Error("Unexpected degen claim state");
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [program, publicKey, roundId, connection, sendTransaction, pollRound, pollBalance, unclaimedPrizes]
  );

  // Claim an unclaimed prize from a previous round (via badge)
  const claimUnclaimed = useCallback(async (unclaimedRoundId: number): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected");
    setLoading(true);
    setError(null);
    try {
      // Fetch the old round data to get vrfPayer
      const oldRoundData = await fetchRound(connection, unclaimedRoundId);
      if (!oldRoundData) {
        // Round PDA gone — crank already auto-claimed and closed it
        const archived = await fetchRoundFromFirebase(unclaimedRoundId).catch(() => null);
        clearUnclaimedPrize(unclaimedRoundId);
        setUnclaimedPrizes(prev => prev.filter(p => p.roundId !== unclaimedRoundId));
        if (archived?.claimTx) {
          throw new Error("Prize was already auto-claimed to your wallet");
        }
        throw new Error("Round no longer exists on-chain (likely already claimed)");
      }
      if (oldRoundData.status === RoundStatus.Claimed) {
        // Already claimed — clean up local state silently
        clearUnclaimedPrize(unclaimedRoundId);
        setUnclaimedPrizes(prev => prev.filter(p => p.roundId !== unclaimedRoundId));
        throw new Error("Prize already claimed");
      }
      if (oldRoundData.status !== RoundStatus.Settled) throw new Error("Round is not in a claimable state");

      const tx = new Transaction();

      // No VRF reimbursement — service wallet absorbs the ~$0.01 VRF cost
      const cfg = await fetchConfig(program);
      const ix = await buildClaim(
        program,
        publicKey,
        unclaimedRoundId,
        USDC_MINT,
        cfg.treasuryUsdcAta
      );
      tx.add(ix);
      const sig = await sendTransaction(tx, connection, { skipPreflight: true });

      // Clear just this unclaimed prize
      clearUnclaimedPrize(unclaimedRoundId);
      setUnclaimedPrizes(prev => prev.filter(p => p.roundId !== unclaimedRoundId));

      // Archive round to Firebase (crank also archives, but this gives immediate history)
      // Force status=Claimed because fetchRound may return stale pre-confirmation data.
      try {
        const claimedData = await fetchRound(connection, unclaimedRoundId);
        if (claimedData) {
          const histRound = await toHistoryRoundWithDeposits(claimedData, program, unclaimedRoundId);
          await saveRoundToFirebase({ ...histRound, status: RoundStatus.Claimed, claimTx: sig });
        }
      } catch (e) {
        console.warn("Firebase archive failed (non-critical):", e);
      }

      // Let polling detect the "claimed" status → useEffect auto-advance handles the rest
      await pollRound();

      await pollBalance();
      return sig;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, connection, sendTransaction, pollBalance, roundId, pollRound]);

  const cancelRound = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected");
    setLoading(true);
    setError(null);
    try {
      const ix = await buildCancelRound(program, publicKey, roundId, USDC_MINT);
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      await pollRound();
      await pollBalance();
      return sig;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, roundId, connection, sendTransaction, pollRound, pollBalance]);

  const claimRefund = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected");
    setLoading(true);
    setError(null);
    try {
      const ix = await buildClaimRefund(program, publicKey, roundId, USDC_MINT);
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      await pollRound();
      await pollBalance();
      return sig;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, roundId, connection, sendTransaction, pollRound, pollBalance]);

  const nextRound = useCallback(() => {
    setRoundId((prev) => prev + 1);
    setRoundData(null);
    setParticipants([]);
    setPhase("waiting");
    setTimeLeft(0);
  }, []);

  // Winner
  const winner = useMemo(() => {
    if (!roundData || roundData.status < RoundStatus.Settled) return null;
    const winnerKey = roundData.winner;
    if (winnerKey.equals(PublicKey.default)) return null;
    return (
      participants.find((p) => p.address === winnerKey.toBase58()) ?? {
        address: winnerKey.toBase58(),
        displayName: `${winnerKey.toBase58().slice(0, 4)}...${winnerKey.toBase58().slice(-4)}`,
        color: PARTICIPANT_COLORS[0],
        usdcAmount: Number(roundData.totalUsdc) / 10 ** USDC_DECIMALS,
        tickets: Number(roundData.totalTickets),
        tokens: [],
      }
    );
  }, [roundData, participants]);

  return {
    roundId,
    phase,
    timeLeft,
    participants,
    totalUsdc: roundData ? Number(roundData.totalUsdc) / 10 ** USDC_DECIMALS : 0,
    totalTickets: roundData ? Number(roundData.totalTickets) : 0,
    roundRandomnessHex: roundData ? Buffer.from(roundData.randomness).toString("hex") : null,
    winner,
    myUsdcBalance,
    isAdmin,
    loading,
    error,
    autoStatus,
    unclaimedPrizes,
    deposit,
    depositMany,
    claim,
    claimDegen,
    claimUnclaimed,
    cancelRound,
    claimRefund,
    countdownStarted: roundData ? Number(roundData.endTs) > 0 : false,
    nextRound,
    setPauseAutoAdvance,
  };
}
