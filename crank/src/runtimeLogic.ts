import { RoundStatus } from "./constants.js";

export type StuckThresholds = {
  lockedSec: number;
  vrfRequestedSec: number;
  settledSec: number;
  cancelledSec: number;
};

export type ParticipantCleanupRetryInput = {
  existing: number;
  closed: number;
  blockedByRefund: number;
};

export type CleanupRetryScheduleInput = {
  nowSec: number;
  reason: string;
  minDelaySec: number;
  maxDelaySec: number;
  currentDelaySec?: number;
  retryCount?: number;
  fast?: boolean;
};

export type CleanupRetryScheduleUpdate = {
  nextDelaySec: number;
  nextAttemptAtSec: number;
  nextRetryCount: number;
  lastReason: string;
};

export type ParticipantCleanupRetryScheduleInput = {
  nowSec: number;
  stats: ParticipantCleanupRetryInput;
  minDelaySec: number;
  maxDelaySec: number;
  currentDelaySec?: number;
  retryCount?: number;
};

export type CleanupRetryOutcome =
  | { kind: "participants_pending"; stats: ParticipantCleanupRetryInput }
  | { kind: "left_terminal_state"; status: number }
  | { kind: "close_round_failed"; message: string }
  | { kind: "background_error"; message: string };

export function isMinRequirementsErrorMessage(message: string): boolean {
  return (
    message.includes("NotEnoughTickets") ||
    message.includes("NotEnoughParticipants") ||
    /\b6010\b/.test(message) ||
    /\b6009\b/.test(message)
  );
}

export function computeCleanupRetryDelay(args: {
  currentDelaySec?: number;
  minDelaySec: number;
  maxDelaySec: number;
  fast?: boolean;
}): number {
  const currentDelaySec = args.currentDelaySec ?? args.minDelaySec;

  if (args.fast === true) {
    return Math.min(args.minDelaySec, 2);
  }

  return Math.min(
    args.maxDelaySec,
    Math.max(args.minDelaySec, currentDelaySec * 2)
  );
}

export function getStuckThresholdSec(
  status: number,
  thresholds: StuckThresholds
): number | null {
  switch (status) {
    case RoundStatus.Locked:
      return thresholds.lockedSec;
    case RoundStatus.VrfRequested:
      return thresholds.vrfRequestedSec;
    case RoundStatus.Settled:
      return thresholds.settledSec;
    case RoundStatus.Cancelled:
      return thresholds.cancelledSec;
    default:
      return null;
  }
}

export function shouldEmitStuckWarning(args: {
  nowSec: number;
  observedStatus: number;
  targetStatus: number;
  observedSinceSec: number;
  thresholdSec: number | null;
  lastWarnSec?: number;
  repeatSec: number;
}): boolean {
  if (args.thresholdSec == null || args.thresholdSec <= 0) {
    return false;
  }

  if (args.observedStatus !== args.targetStatus) {
    return false;
  }

  const ageSec = args.nowSec - args.observedSinceSec;
  if (ageSec < args.thresholdSec) {
    return false;
  }

  const lastWarnSec = args.lastWarnSec ?? 0;
  return args.nowSec - lastWarnSec >= args.repeatSec;
}

export function describeParticipantCleanupRetry(
  stats: ParticipantCleanupRetryInput
): { reason: string; fast: boolean } | null {
  const remainingParticipants = stats.existing - stats.closed;
  if (remainingParticipants <= 0) return null;

  const reason =
    stats.blockedByRefund > 0
      ? `waiting user refunds (${stats.blockedByRefund} participant PDAs still funded)`
      : stats.closed > 0
        ? `participant cleanup in progress (${remainingParticipants} remaining)`
        : `participant cleanup pending (${remainingParticipants} remaining)`;

  return {
    reason,
    fast: stats.closed > 0,
  };
}

export function buildCleanupRetryScheduleUpdate(
  args: CleanupRetryScheduleInput
): CleanupRetryScheduleUpdate {
  const nextDelaySec = computeCleanupRetryDelay({
    currentDelaySec: args.currentDelaySec ?? args.minDelaySec,
    minDelaySec: args.minDelaySec,
    maxDelaySec: args.maxDelaySec,
    fast: args.fast,
  });

  return {
    nextDelaySec,
    nextAttemptAtSec: args.nowSec + nextDelaySec,
    nextRetryCount: (args.retryCount ?? 0) + 1,
    lastReason: args.reason,
  };
}

export function planParticipantCleanupRetrySchedule(
  args: ParticipantCleanupRetryScheduleInput
): CleanupRetryScheduleUpdate | null {
  const retry = describeParticipantCleanupRetry(args.stats);
  if (!retry) return null;

  return buildCleanupRetryScheduleUpdate({
    nowSec: args.nowSec,
    reason: retry.reason,
    minDelaySec: args.minDelaySec,
    maxDelaySec: args.maxDelaySec,
    currentDelaySec: args.currentDelaySec,
    retryCount: args.retryCount,
    fast: retry.fast,
  });
}

export function describeCleanupRetryOutcome(
  outcome: CleanupRetryOutcome
): { reason: string; fast: boolean } | null {
  switch (outcome.kind) {
    case "participants_pending":
      return describeParticipantCleanupRetry(outcome.stats);
    case "left_terminal_state":
      return {
        reason: `round left terminal state (${outcome.status})`,
        fast: false,
      };
    case "close_round_failed":
      return {
        reason: `close_round failed: ${outcome.message}`,
        fast: false,
      };
    case "background_error":
      return {
        reason: `background error: ${outcome.message}`,
        fast: false,
      };
    default:
      return null;
  }
}

export function planCleanupRetryScheduleForOutcome(args: {
  nowSec: number;
  outcome: CleanupRetryOutcome;
  minDelaySec: number;
  maxDelaySec: number;
  currentDelaySec?: number;
  retryCount?: number;
}): CleanupRetryScheduleUpdate | null {
  const desc = describeCleanupRetryOutcome(args.outcome);
  if (!desc) return null;

  return buildCleanupRetryScheduleUpdate({
    nowSec: args.nowSec,
    reason: desc.reason,
    minDelaySec: args.minDelaySec,
    maxDelaySec: args.maxDelaySec,
    currentDelaySec: args.currentDelaySec,
    retryCount: args.retryCount,
    fast: desc.fast,
  });
}
