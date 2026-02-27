/**
 * Jackpot Crank — autonomous round lifecycle manager.
 *
 * Polls the chain every POLL_INTERVAL_MS and executes:
 *   - start_round   when no active round exists
 *   - lock_round    when round timer expired + buffer
 *   - request_vrf   atomically with lock (or standalone if Locked)
 *   - close_round   after Claimed/Cancelled (archive to Firebase first)
 *
 * On Settled: immediately advances to next round. Winner claims via UI.
 * Old rounds are closed in background after winner claims.
 *
 * Service wallet keypair stays on the server — never exposed to the browser.
 */
import "dotenv/config";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RoundStatus, getParticipantPda, getRoundPda, USDC_DECIMALS } from "./constants.js";
import { parseParticipant, parseRound, type RoundData } from "./parser.js";
import { scanForActiveRound, type ScanEntry } from "./activeRoundScan.js";
import {
  createProgram,
  signAndSend,
  buildStartRound,
  buildLockRound,
  buildRequestVrf,
  buildCloseParticipant,
  buildCloseRound,
} from "./instructions.js";
import {
  initFirebase,
  buildHistoryRound,
  saveRoundToFirebase,
  getMaxArchivedRoundId,
} from "./firebase.js";
import {
  getStuckThresholdSec,
  isMinRequirementsErrorMessage,
  planCleanupRetryScheduleForOutcome,
  shouldEmitStuckWarning,
  type CleanupRetryOutcome,
} from "./runtimeLogic.js";
import { isTapestryEnabled, publishRoundSettled } from "./tapestry.js";
import type { Program } from "@coral-xyz/anchor";

// ─── Config from env ────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const RPC_WS_URL = process.env.RPC_WS_URL || "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 3000;
const LOCK_BUFFER_SEC = Number(process.env.LOCK_BUFFER_SEC) || 3;
const CLOSE_DELAY_SEC = Number(process.env.CLOSE_DELAY_SEC) || 5;
const CLEANUP_BACKOFF_MIN_SEC = Number(process.env.CLEANUP_BACKOFF_MIN_SEC) || 5;
const CLEANUP_BACKOFF_MAX_SEC = Number(process.env.CLEANUP_BACKOFF_MAX_SEC) || 60;
const PARTICIPANT_CLEANUP_BATCH = Number(process.env.PARTICIPANT_CLEANUP_BATCH) || 12;
const HEALTH_LOG_INTERVAL_SEC = Number(process.env.HEALTH_LOG_INTERVAL_SEC) || 60;
const STARTUP_BACKFILL_SCAN_ROUNDS = Number(process.env.STARTUP_BACKFILL_SCAN_ROUNDS) || 50;
const STUCK_LOCKED_SEC = Number(process.env.STUCK_LOCKED_SEC) || 90;
const STUCK_VRF_REQUESTED_SEC = Number(process.env.STUCK_VRF_REQUESTED_SEC) || 180;
const STUCK_SETTLED_SEC = Number(process.env.STUCK_SETTLED_SEC) || 300;
const STUCK_CANCELLED_SEC = Number(process.env.STUCK_CANCELLED_SEC) || 180;
const STUCK_WARN_REPEAT_SEC = Number(process.env.STUCK_WARN_REPEAT_SEC) || 60;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load service wallet ────────────────────────────────────

function loadServiceWallet(): Keypair {
  const walletPath =
    process.env.CRANK_KEYPAIR_PATH ||
    process.env.SERVICE_WALLET_PATH ||
    "../service-wallet.json";
  const resolved = path.resolve(__dirname, "..", walletPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Service wallet not found at ${resolved}`);
  }
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  const crankKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));

  // Safety guard: keep crank key distinct from the root admin/deploy key unless explicitly overridden.
  if (process.env.ALLOW_CRANK_KEYPAR_REUSE !== "1") {
    const rootKeypar = path.resolve(__dirname, "..", "../keypar.json");
    if (fs.existsSync(rootKeypar)) {
      try {
        const rootRaw = JSON.parse(fs.readFileSync(rootKeypar, "utf-8"));
        const rootKeypair = Keypair.fromSecretKey(Uint8Array.from(rootRaw));
        if (rootKeypair.publicKey.equals(crankKeypair.publicKey)) {
          throw new Error(
            `Crank key must be separate from keypar.json (${rootKeypair.publicKey.toBase58()}). ` +
            `Set CRANK_KEYPAIR_PATH to a dedicated keypair or set ALLOW_CRANK_KEYPAR_REUSE=1 to override.`
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Crank key must be separate")) {
          throw e;
        }
        // Ignore malformed optional root key if it cannot be parsed.
      }
    }
  }

  return crankKeypair;
}

// ─── State ──────────────────────────────────────────────────

let currentRoundId = 0;
let lastLockedRound = 0;
let lastCreatedRound = 0;
let backgroundRounds: Set<number> = new Set(); // rounds needing background close after winner claims
let archivedRounds: Set<number> = new Set(); // rounds already archived to Firebase
let cleanupNextAttemptAt: Map<number, number> = new Map(); // unix ts when next cleanup attempt is allowed
let cleanupBackoffSec: Map<number, number> = new Map(); // exponential backoff per round
let cleanupRetryCount: Map<number, number> = new Map(); // retry attempts per round
let cleanupLastReason: Map<number, string> = new Map(); // last retry reason per round
let cleanupLastStats: Map<number, ParticipantCleanupStats & { updatedAt: number }> = new Map();
let roundObservedState: Map<number, { status: number; sinceTs: number; lastSeenTs: number }> = new Map();
let stuckWarnedAt: Map<string, number> = new Map(); // key: `${roundId}:${status}`
let lastHealthLogAt = 0;

// ─── Helpers ────────────────────────────────────────────────

async function fetchRound(
  connection: Connection,
  roundId: number
): Promise<RoundData | null> {
  const pda = getRoundPda(roundId);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return parseRound(info.data as Buffer);
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function statusName(status: number): string {
  switch (status) {
    case RoundStatus.Open:
      return "Open";
    case RoundStatus.Locked:
      return "Locked";
    case RoundStatus.VrfRequested:
      return "VrfRequested";
    case RoundStatus.Settled:
      return "Settled";
    case RoundStatus.Claimed:
      return "Claimed";
    case RoundStatus.Cancelled:
      return "Cancelled";
    default:
      return `Unknown(${status})`;
  }
}

function observeRoundState(roundId: number, status: number) {
  const t = now();
  const prev = roundObservedState.get(roundId);
  if (!prev || prev.status !== status) {
    roundObservedState.set(roundId, { status, sinceTs: t, lastSeenTs: t });
    // Reset warning throttle for old status if it changed.
    if (prev) stuckWarnedAt.delete(`${roundId}:${prev.status}`);
    return;
  }
  prev.lastSeenTs = t;
}

function forgetRoundState(roundId: number) {
  const prev = roundObservedState.get(roundId);
  if (prev) stuckWarnedAt.delete(`${roundId}:${prev.status}`);
  roundObservedState.delete(roundId);
  cleanupLastStats.delete(roundId);
  cleanupRetryCount.delete(roundId);
  cleanupLastReason.delete(roundId);
}

function stuckThresholdSec(status: number): number | null {
  return getStuckThresholdSec(status, {
    lockedSec: STUCK_LOCKED_SEC,
    vrfRequestedSec: STUCK_VRF_REQUESTED_SEC,
    settledSec: STUCK_SETTLED_SEC,
    cancelledSec: STUCK_CANCELLED_SEC,
  });
}

function maybeWarnStuckRound(roundId: number, status: number) {
  const threshold = stuckThresholdSec(status);
  if (!threshold || threshold <= 0) return;
  const obs = roundObservedState.get(roundId);
  if (!obs || obs.status !== status) return;

  const nowSec = now();
  if (
    !shouldEmitStuckWarning({
      nowSec,
      observedStatus: obs.status,
      targetStatus: status,
      observedSinceSec: obs.sinceTs,
      thresholdSec: threshold,
      lastWarnSec: stuckWarnedAt.get(`${roundId}:${status}`),
      repeatSec: STUCK_WARN_REPEAT_SEC,
    })
  ) {
    return;
  }

  const key = `${roundId}:${status}`;
  const ageSec = nowSec - obs.sinceTs;
  stuckWarnedAt.set(key, nowSec);

  let extra = "";
  if (backgroundRounds.has(roundId)) {
    const due = cleanupNextAttemptAt.get(roundId);
    const retryCount = cleanupRetryCount.get(roundId) ?? 0;
    const lastReason = cleanupLastReason.get(roundId);
    const s = cleanupLastStats.get(roundId);
    const blocked = s?.blockedByRefund ?? 0;
    const closable = s?.closable ?? 0;
    const existing = s?.existing ?? 0;
    extra =
      ` | bg_cleanup retry=${retryCount}` +
      (due ? ` next_in=${Math.max(0, due - nowSec)}s` : "") +
      (lastReason ? ` reason=${lastReason}` : "") +
      (s ? ` participants=${existing} closable=${closable} blocked_refund=${blocked}` : "");
  }

  log(
    `⚠ Stuck round #${roundId}: status=${statusName(status)} age=${ageSec}s` +
    ` (threshold=${threshold}s)${extra}`
  );
}

function maybeLogHealthSnapshot() {
  if (HEALTH_LOG_INTERVAL_SEC <= 0) return;
  const t = now();
  if (t - lastHealthLogAt < HEALTH_LOG_INTERVAL_SEC) return;
  lastHealthLogAt = t;

  const byStatus = new Map<number, number>();
  let dueCleanup = 0;
  let blockedRefundParticipants = 0;
  let roundsWaitingRefund = 0;
  let maxCleanupRetry = 0;

  for (const roundId of backgroundRounds) {
    const obs = roundObservedState.get(roundId);
    if (obs) byStatus.set(obs.status, (byStatus.get(obs.status) ?? 0) + 1);
    if (allowCleanupNow(roundId)) dueCleanup++;
    const retries = cleanupRetryCount.get(roundId) ?? 0;
    if (retries > maxCleanupRetry) maxCleanupRetry = retries;
    const s = cleanupLastStats.get(roundId);
    if (s && s.blockedByRefund > 0) {
      roundsWaitingRefund++;
      blockedRefundParticipants += s.blockedByRefund;
    }
  }

  const currentObs = roundObservedState.get(currentRoundId);
  const currentState =
    currentObs == null
      ? `#${currentRoundId}:unknown`
      : `#${currentRoundId}:${statusName(currentObs.status)} age=${t - currentObs.sinceTs}s`;

  const statusSummary = [
    `settled=${byStatus.get(RoundStatus.Settled) ?? 0}`,
    `claimed=${byStatus.get(RoundStatus.Claimed) ?? 0}`,
    `cancelled=${byStatus.get(RoundStatus.Cancelled) ?? 0}`,
  ].join(" ");

  log(
    `HEALTH current=${currentState} bg=${backgroundRounds.size} due_cleanup=${dueCleanup} ` +
    `${statusSummary} waiting_refund_rounds=${roundsWaitingRefund} ` +
    `blocked_refund_participants=${blockedRefundParticipants} max_cleanup_retry=${maxCleanupRetry}`
  );
}

function trackBackgroundRound(roundId: number) {
  backgroundRounds.add(roundId);
  if (!cleanupNextAttemptAt.has(roundId)) {
    cleanupNextAttemptAt.set(roundId, now() + CLOSE_DELAY_SEC);
  }
  if (!cleanupBackoffSec.has(roundId)) {
    cleanupBackoffSec.set(roundId, CLEANUP_BACKOFF_MIN_SEC);
  }
  if (!cleanupRetryCount.has(roundId)) {
    cleanupRetryCount.set(roundId, 0);
  }
}

function clearBackgroundRound(roundId: number) {
  backgroundRounds.delete(roundId);
  archivedRounds.delete(roundId);
  cleanupNextAttemptAt.delete(roundId);
  cleanupBackoffSec.delete(roundId);
  forgetRoundState(roundId);
}

function allowCleanupNow(roundId: number): boolean {
  const due = cleanupNextAttemptAt.get(roundId);
  return due == null || now() >= due;
}

function scheduleCleanupRetryOutcome(
  roundId: number,
  outcome: CleanupRetryOutcome
): boolean {
  const update = planCleanupRetryScheduleForOutcome({
    nowSec: now(),
    outcome,
    minDelaySec: CLEANUP_BACKOFF_MIN_SEC,
    maxDelaySec: CLEANUP_BACKOFF_MAX_SEC,
    currentDelaySec: cleanupBackoffSec.get(roundId) ?? CLEANUP_BACKOFF_MIN_SEC,
    retryCount: cleanupRetryCount.get(roundId) ?? 0,
  });
  if (!update) return false;

  cleanupBackoffSec.set(roundId, update.nextDelaySec);
  cleanupNextAttemptAt.set(roundId, update.nextAttemptAtSec);
  cleanupRetryCount.set(roundId, update.nextRetryCount);
  cleanupLastReason.set(roundId, update.lastReason);
  log(`↻ Round #${roundId} cleanup retry in ${update.nextDelaySec}s (${update.lastReason})`);
  return true;
}

// ─── Find active round ─────────────────────────────────────

async function findActiveRound(connection: Connection): Promise<number> {
  let scanStart = 1;
  let archivedMax = 0;
  try {
    archivedMax = await getMaxArchivedRoundId();
    if (archivedMax > 0) scanStart = Math.max(1, archivedMax - 2);
  } catch { }

  // Batch-scan in chunks of 20 PDAs at a time (much faster than individual fetches)
  const BATCH = 20;
  const MAX_SCAN = 200; // scan up to 200 rounds ahead
  const NULL_STREAK_LIMIT = 20; // tolerate gaps from closed rounds not in Firebase

  return await scanForActiveRound({
    scanStart,
    archivedMax,
    maxScan: MAX_SCAN,
    batchSize: BATCH,
    nullStreakLimit: NULL_STREAK_LIMIT,
    fetchBatch: async (ids) => {
      const pdas = ids.map((id) => getRoundPda(id));
      const infos = await connection.getMultipleAccountsInfo(pdas);
      return infos.map((info): ScanEntry => {
        if (!info) {
          return { kind: "missing" };
        }
        try {
          const parsed = parseRound(info.data as Buffer);
          return { kind: "round", status: parsed.status };
        } catch {
          return { kind: "invalid" };
        }
      });
    },
  });
}

async function recoverBackgroundRoundsOnStartup(
  connection: Connection,
  currentRoundId: number
) {
  if (currentRoundId <= 1) return;

  const start = Math.max(1, currentRoundId - STARTUP_BACKFILL_SCAN_ROUNDS);
  const end = currentRoundId;
  const BATCH = 25;

  let recoveredSettled = 0;
  let recoveredClaimed = 0;
  let recoveredCancelled = 0;

  for (let base = start; base <= end; base += BATCH) {
    const ids: number[] = [];
    for (let i = 0; i < BATCH && base + i <= end; i++) ids.push(base + i);

    const pdas = ids.map((id) => getRoundPda(id));
    const infos = await connection.getMultipleAccountsInfo(pdas);

    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (!info) continue;

      const id = ids[i];
      try {
        const rd = parseRound(info.data as Buffer);
        observeRoundState(id, rd.status);

        if (
          rd.status === RoundStatus.Settled ||
          rd.status === RoundStatus.Claimed ||
          rd.status === RoundStatus.Cancelled
        ) {
          const beforeSize = backgroundRounds.size;
          trackBackgroundRound(id);
          const added = backgroundRounds.size > beforeSize;
          if (!added) continue;

          if (rd.status === RoundStatus.Settled) recoveredSettled++;
          else if (rd.status === RoundStatus.Claimed) recoveredClaimed++;
          else if (rd.status === RoundStatus.Cancelled) recoveredCancelled++;
        }
      } catch {
        // Ignore non-round / malformed accounts in scan range.
      }
    }
  }

  const totalRecovered = recoveredSettled + recoveredClaimed + recoveredCancelled;
  if (totalRecovered > 0) {
    log(
      `↺ Startup backfill recovered ${totalRecovered} round(s) into background cleanup ` +
      `(settled=${recoveredSettled}, claimed=${recoveredClaimed}, cancelled=${recoveredCancelled}, scan=${start}-${end})`
    );
  }
}

// ─── Crank actions ──────────────────────────────────────────

async function handleStartRound(
  connection: Connection,
  program: Program,
  payer: Keypair,
  roundId: number
): Promise<boolean> {
  if (lastCreatedRound >= roundId) return false;

  // Check if round PDA already exists
  const pda = getRoundPda(roundId);
  const info = await connection.getAccountInfo(pda);
  if (info) {
    lastCreatedRound = roundId;
    return false; // already exists
  }

  try {
    log(`Creating round #${roundId}...`);
    const ix = await buildStartRound(program, payer.publicKey, roundId);
    const sig = await signAndSend(connection, [ix], payer);
    lastCreatedRound = roundId;
    log(`✓ Round #${roundId} created (${sig.slice(0, 16)}...)`);
    return true;
  } catch (e: any) {
    // Check if it was created by someone else (race)
    const check = await fetchRound(connection, roundId);
    if (check) {
      lastCreatedRound = roundId;
      log(`Round #${roundId} already exists (created externally)`);
      return false;
    }
    log(`✗ Create round #${roundId} failed: ${e.message}`);
    return false;
  }
}

async function handleLockAndVrf(
  connection: Connection,
  program: Program,
  payer: Keypair,
  roundId: number,
  rd: RoundData
): Promise<boolean> {
  if (lastLockedRound === roundId) return false;

  const endTs = Number(rd.endTs);
  if (endTs === 0 || now() < endTs + LOCK_BUFFER_SEC) return false;

  // Re-verify on-chain before sending
  const fresh = await fetchRound(connection, roundId);
  if (!fresh || fresh.status !== RoundStatus.Open) return false;

  // Check if round has enough participants/tickets to lock
  // If timer expired but round is empty/insufficient, skip locking and advance
  if (fresh.participantsCount < 1 || fresh.totalTickets === 0n) {
    log(`⚠ Round #${roundId} timer expired with 0 deposits — skipping lock, advancing`);
    lastLockedRound = roundId;
    // Track for background cleanup (the PDA still exists and needs close)
    trackBackgroundRound(roundId);
    const prevRound = currentRoundId;
    currentRoundId++;
    lastLockedRound = 0;
    log(`→ Round #${prevRound} empty — advanced to round #${currentRoundId}`);
    return true;
  }

  try {
    log(`Locking round #${roundId} + requesting VRF...`);
    const lockIx = await buildLockRound(program, payer.publicKey, roundId);
    const vrfIx = await buildRequestVrf(program, payer.publicKey, roundId);
    const sig = await signAndSend(connection, [lockIx, vrfIx], payer);
    lastLockedRound = roundId; // set ONLY after success
    log(`✓ Round #${roundId} locked + VRF requested (${sig.slice(0, 16)}...)`);
    return true;
  } catch (e: any) {
    log(`✗ Lock+VRF round #${roundId} failed: ${e.message}`);

    // Detect NotEnoughTickets (error 6010) or NotEnoughParticipants (6009)
    const errMsg = e.message || '';
    if (isMinRequirementsErrorMessage(errMsg)) {
      log(`⚠ Round #${roundId} doesn't meet min requirements — advancing`);
      lastLockedRound = roundId;
      trackBackgroundRound(roundId);
      const prevRound = currentRoundId;
      currentRoundId++;
      lastLockedRound = 0;
      log(`→ Round #${prevRound} insufficient — advanced to round #${currentRoundId}`);
      return true;
    }

    // Check if it was actually locked by someone else
    try {
      const retry = await fetchRound(connection, roundId);
      if (retry && retry.status !== RoundStatus.Open) {
        lastLockedRound = roundId; // locked externally, don't retry
      }
    } catch { } // RPC error — will retry on next tick
    return false;
  }
}

async function handleRequestVrf(
  connection: Connection,
  program: Program,
  payer: Keypair,
  roundId: number
): Promise<boolean> {
  // Round is Locked but VRF not yet requested (external lock scenario)
  const fresh = await fetchRound(connection, roundId);
  if (!fresh || fresh.status !== RoundStatus.Locked) return false;

  try {
    log(`Requesting VRF for round #${roundId}...`);
    const ix = await buildRequestVrf(program, payer.publicKey, roundId);
    const sig = await signAndSend(connection, [ix], payer);
    log(`✓ VRF requested for round #${roundId} (${sig.slice(0, 16)}...)`);
    return true;
  } catch (e: any) {
    log(`✗ Request VRF round #${roundId} failed: ${e.message}`);
    return false;
  }
}

type ParticipantCleanupStats = {
  existing: number;
  closable: number;
  closed: number;
  blockedByRefund: number;
  errors: number;
};

async function cleanupParticipantPdas(
  connection: Connection,
  program: Program,
  payer: Keypair,
  roundId: number,
  rd: RoundData
): Promise<ParticipantCleanupStats> {
  const roundPda = getRoundPda(roundId);
  const users = rd.participants;
  const stats: ParticipantCleanupStats = {
    existing: 0,
    closable: 0,
    closed: 0,
    blockedByRefund: 0,
    errors: 0,
  };

  if (users.length === 0) return stats;

  const participantEntries = users.map((user) => ({
    user,
    participantPda: getParticipantPda(roundPda, user),
  }));

  const CHUNK = 50;
  const closableUsers: typeof users = [];
  for (let i = 0; i < participantEntries.length; i += CHUNK) {
    const chunk = participantEntries.slice(i, i + CHUNK);
    const infos = await connection.getMultipleAccountsInfo(chunk.map((e) => e.participantPda));

    for (let j = 0; j < infos.length; j++) {
      const info = infos[j];
      if (!info) continue;
      stats.existing++;

      try {
        const p = parseParticipant(info.data as Buffer);
        if (rd.status === RoundStatus.Cancelled && (p.usdcTotal > 0n || p.ticketsTotal > 0n)) {
          stats.blockedByRefund++;
          continue;
        }
        stats.closable++;
        closableUsers.push(chunk[j].user);
      } catch {
        // If parsing fails, do not close blindly.
        stats.errors++;
      }
    }
  }

  const toClose = closableUsers.slice(0, PARTICIPANT_CLEANUP_BATCH);
  for (const user of toClose) {
    try {
      const ix = await buildCloseParticipant(program, payer.publicKey, user, roundId);
      const sig = await signAndSend(connection, [ix], payer, true);
      stats.closed++;
      log(`✓ Participant PDA closed (round #${roundId}, user ${user.toBase58().slice(0, 6)}...): ${sig.slice(0, 16)}...`);
    } catch (e: any) {
      stats.errors++;
      log(`✗ Close participant failed (round #${roundId}, user ${user.toBase58().slice(0, 6)}...): ${e.message}`);
    }
  }

  cleanupLastStats.set(roundId, { ...stats, updatedAt: now() });
  return stats;
}

async function handleTerminalRoundCleanup(
  connection: Connection,
  program: Program,
  payer: Keypair,
  roundId: number,
  rd: RoundData
): Promise<boolean> {
  if (!allowCleanupNow(roundId)) return false;

  // Archive once; on failure keep trying on next rounds cleanup cycles.
  if (!archivedRounds.has(roundId)) {
    try {
      const histRound = await buildHistoryRound(rd, program, roundId);
      const archived = await saveRoundToFirebase(histRound);
      if (archived) {
        archivedRounds.add(roundId);
        log(`📦 Round #${roundId} archived to Firebase`);
      }
    } catch (e: any) {
      log(`⚠ Firebase archive round #${roundId} failed: ${e.message}`);
    }
  }

  // First pass: close participant PDAs (important before close_round, otherwise they become stranded).
  const participantStats = await cleanupParticipantPdas(connection, program, payer, roundId, rd);
  if (scheduleCleanupRetryOutcome(roundId, {
    kind: "participants_pending",
    stats: {
      existing: participantStats.existing,
      closed: participantStats.closed,
      blockedByRefund: participantStats.blockedByRefund,
    },
  })) {
    return false;
  }

  // Re-fetch before close to avoid stale status and races.
  const fresh = await fetchRound(connection, roundId);
  if (!fresh) {
    clearBackgroundRound(roundId);
    return true;
  }
  if (fresh.status !== RoundStatus.Claimed && fresh.status !== RoundStatus.Cancelled) {
    scheduleCleanupRetryOutcome(roundId, {
      kind: "left_terminal_state",
      status: fresh.status,
    });
    return false;
  }

  try {
    log(`Closing round #${roundId}...`);
    const ix = await buildCloseRound(program, payer.publicKey, payer.publicKey, roundId);
    const sig = await signAndSend(connection, [ix], payer, true); // skipPreflight for close
    clearBackgroundRound(roundId);
    log(`✓ Round #${roundId} closed (${sig.slice(0, 16)}...)`);
    return true;
  } catch (e: any) {
    scheduleCleanupRetryOutcome(roundId, {
      kind: "close_round_failed",
      message: e.message,
    });
    return false;
  }
}

// ─── Background round processing (claim/close settled rounds) ─

async function processBackgroundRounds(
  connection: Connection,
  program: Program,
  payer: Keypair
) {
  for (const roundId of [...backgroundRounds]) {
    try {
      const rd = await fetchRound(connection, roundId);
      if (!rd) {
        // Already closed or doesn't exist
        clearBackgroundRound(roundId);
        continue;
      }
      observeRoundState(roundId, rd.status);
      maybeWarnStuckRound(roundId, rd.status);

      if (rd.status === RoundStatus.Claimed || rd.status === RoundStatus.Cancelled) {
        // Winner claimed (or round cancelled) → archive + participant cleanup + close (with retries)
        await handleTerminalRoundCleanup(connection, program, payer, roundId, rd);
      }
      // Settled → waiting for winner to claim via UI, nothing to do
    } catch (e: any) {
      log(`✗ Background processing round #${roundId} failed: ${e.message}`);
      scheduleCleanupRetryOutcome(roundId, {
        kind: "background_error",
        message: e.message,
      });
    }
  }
}

// ─── Main loop ──────────────────────────────────────────────

async function tick(
  connection: Connection,
  program: Program,
  payer: Keypair
) {
  try {
    // Process background rounds (claim/close old settled rounds)
    if (backgroundRounds.size > 0) {
      await processBackgroundRounds(connection, program, payer);
    }

    const rd = await fetchRound(connection, currentRoundId);

    // No round exists → create it
    if (!rd) {
      maybeLogHealthSnapshot();
      await handleStartRound(connection, program, payer, currentRoundId);
      return;
    }
    observeRoundState(currentRoundId, rd.status);
    maybeWarnStuckRound(currentRoundId, rd.status);

    const status = rd.status;

    // Open → check if timer expired → lock + VRF
    if (status === RoundStatus.Open) {
      maybeLogHealthSnapshot();
      await handleLockAndVrf(connection, program, payer, currentRoundId, rd);
      return;
    }

    // Locked → request VRF (if lock was done externally without VRF)
    if (status === RoundStatus.Locked) {
      maybeLogHealthSnapshot();
      await handleRequestVrf(connection, program, payer, currentRoundId);
      return;
    }

    // VrfRequested → waiting for oracle, nothing to do
    if (status === RoundStatus.VrfRequested) {
      maybeLogHealthSnapshot();
      return;
    }

    // Settled → publish social event + advance immediately, winner claims via UI, close in background
    if (status === RoundStatus.Settled) {
      // Fire-and-forget: publish win event to Tapestry social feed (never blocks advancement).
      if (isTapestryEnabled() && rd) {
        const winnerWallet = rd.winner.toBase58();
        const totalUsdc = Number(rd.totalUsdc) / 10 ** USDC_DECIMALS;
        const participantWallets = rd.participants.map((p) => p.toBase58());
        void publishRoundSettled({
          roundId: currentRoundId,
          winnerWallet,
          totalUsdc,
          participantWallets,
        });
      }
      trackBackgroundRound(currentRoundId);
      const prevRound = currentRoundId;
      currentRoundId++;
      lastLockedRound = 0;
      log(`→ Round #${prevRound} settled — advanced to round #${currentRoundId} (claim/cleanup in background)`);
      maybeLogHealthSnapshot();
      return;
    }

    // Claimed or Cancelled → close in background + advance
    if (status === RoundStatus.Claimed || status === RoundStatus.Cancelled) {
      trackBackgroundRound(currentRoundId);
      const prevRound = currentRoundId;
      currentRoundId++;
      lastLockedRound = 0;
      log(`→ Round #${prevRound} done — advanced to round #${currentRoundId} (cleanup in background)`);
      maybeLogHealthSnapshot();
      return;
    }
    maybeLogHealthSnapshot();
  } catch (e: any) {
    log(`✗ Tick error: ${e.message}`);
    maybeLogHealthSnapshot();
  }
}

// ─── Entry point ────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("   Jackpot Crank Service");
  console.log("═══════════════════════════════════════════");
  console.log(`Network:     ${process.env.NETWORK || "devnet"}`);
  console.log(`RPC:         ${RPC_URL}`);
  if (RPC_WS_URL) console.log(`WS RPC:      ${RPC_WS_URL}`);
  console.log(`Poll:        ${POLL_INTERVAL_MS}ms`);
  console.log(`Lock buffer: ${LOCK_BUFFER_SEC}s`);
  console.log(`Health log:  ${HEALTH_LOG_INTERVAL_SEC}s`);
  console.log(`Backfill:    ${STARTUP_BACKFILL_SCAN_ROUNDS} rounds`);
  console.log(`Stuck warn:  locked=${STUCK_LOCKED_SEC}s vrf=${STUCK_VRF_REQUESTED_SEC}s settled=${STUCK_SETTLED_SEC}s cancelled=${STUCK_CANCELLED_SEC}s`);
  console.log();

  // Load service wallet
  const payer = loadServiceWallet();
  console.log(`Wallet:      ${payer.publicKey.toBase58()}`);

  // Connect
  const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    ...(RPC_WS_URL ? { wsEndpoint: RPC_WS_URL } : {}),
  });
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance:     ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.01 * 1e9) {
    console.error("⚠ Service wallet balance too low! Need at least 0.01 SOL");
  }

  // Firebase
  initFirebase();

  // Tapestry social bridge
  console.log(`Tapestry:    ${isTapestryEnabled() ? "enabled" : "disabled (no TAPESTRY_API_KEY)"}`);

  // Create program instance
  const program = createProgram(connection, payer);

  // Find active round
  currentRoundId = await findActiveRound(connection);
  await recoverBackgroundRoundsOnStartup(connection, currentRoundId);
  console.log(`Starting at: Round #${currentRoundId}`);
  console.log("═══════════════════════════════════════════");
  console.log();

  // Run
  const loop = async () => {
    await tick(connection, program, payer);
    setTimeout(loop, POLL_INTERVAL_MS);
  };

  loop();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
