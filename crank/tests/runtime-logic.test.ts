import assert from "node:assert";
import { test } from "node:test";
import { RoundStatus } from "../src/constants.ts";
import {
  buildCleanupRetryScheduleUpdate,
  computeCleanupRetryDelay,
  describeCleanupRetryOutcome,
  describeParticipantCleanupRetry,
  getStuckThresholdSec,
  isMinRequirementsErrorMessage,
  planCleanupRetryScheduleForOutcome,
  planParticipantCleanupRetrySchedule,
  shouldEmitStuckWarning,
} from "../src/runtimeLogic.ts";

test("isMinRequirementsErrorMessage matches NotEnoughTickets/Participants patterns", () => {
  assert.equal(
    isMinRequirementsErrorMessage('Status: ({"err":{"InstructionError":[2,{"Custom":6010}]}})'),
    true
  );
  assert.equal(
    isMinRequirementsErrorMessage('Status: ({"err":{"InstructionError":[2,{"Custom":6009}]}})'),
    true
  );
  assert.equal(
    isMinRequirementsErrorMessage("AnchorError: NotEnoughTickets"),
    true
  );
  assert.equal(
    isMinRequirementsErrorMessage("AnchorError: NotEnoughParticipants"),
    true
  );
  assert.equal(
    isMinRequirementsErrorMessage("insufficient funds for fee"),
    false
  );
});

test("computeCleanupRetryDelay doubles and caps, with fast retry shortcut", () => {
  assert.equal(
    computeCleanupRetryDelay({
      currentDelaySec: 5,
      minDelaySec: 5,
      maxDelaySec: 60,
    }),
    10
  );

  assert.equal(
    computeCleanupRetryDelay({
      currentDelaySec: 40,
      minDelaySec: 5,
      maxDelaySec: 60,
    }),
    60
  );

  assert.equal(
    computeCleanupRetryDelay({
      currentDelaySec: 60,
      minDelaySec: 5,
      maxDelaySec: 60,
      fast: true,
    }),
    2
  );

  assert.equal(
    computeCleanupRetryDelay({
      minDelaySec: 1,
      maxDelaySec: 60,
      fast: true,
    }),
    1
  );
});

test("getStuckThresholdSec returns configured thresholds only for terminal/awaiting statuses", () => {
  const thresholds = {
    lockedSec: 90,
    vrfRequestedSec: 180,
    settledSec: 300,
    cancelledSec: 180,
  };

  assert.equal(getStuckThresholdSec(RoundStatus.Open, thresholds), null);
  assert.equal(getStuckThresholdSec(RoundStatus.Locked, thresholds), 90);
  assert.equal(getStuckThresholdSec(RoundStatus.VrfRequested, thresholds), 180);
  assert.equal(getStuckThresholdSec(RoundStatus.Settled, thresholds), 300);
  assert.equal(getStuckThresholdSec(RoundStatus.Cancelled, thresholds), 180);
});

test("shouldEmitStuckWarning respects threshold and repeat throttle", () => {
  assert.equal(
    shouldEmitStuckWarning({
      nowSec: 1_000,
      observedStatus: RoundStatus.Cancelled,
      targetStatus: RoundStatus.Cancelled,
      observedSinceSec: 900,
      thresholdSec: 180,
      repeatSec: 60,
    }),
    false,
    "age below threshold"
  );

  assert.equal(
    shouldEmitStuckWarning({
      nowSec: 1_100,
      observedStatus: RoundStatus.Cancelled,
      targetStatus: RoundStatus.Cancelled,
      observedSinceSec: 900,
      thresholdSec: 180,
      repeatSec: 60,
    }),
    true,
    "age above threshold, no prior warning"
  );

  assert.equal(
    shouldEmitStuckWarning({
      nowSec: 1_100,
      observedStatus: RoundStatus.Cancelled,
      targetStatus: RoundStatus.Cancelled,
      observedSinceSec: 900,
      thresholdSec: 180,
      lastWarnSec: 1_050,
      repeatSec: 60,
    }),
    false,
    "throttled"
  );

  assert.equal(
    shouldEmitStuckWarning({
      nowSec: 1_130,
      observedStatus: RoundStatus.Locked,
      targetStatus: RoundStatus.Cancelled,
      observedSinceSec: 900,
      thresholdSec: 90,
      repeatSec: 60,
    }),
    false,
    "status mismatch"
  );
});

test("describeParticipantCleanupRetry returns reason strings and fast flag for cleanup states", () => {
  assert.deepEqual(
    describeParticipantCleanupRetry({
      existing: 2,
      closed: 1,
      blockedByRefund: 1,
    }),
    {
      reason: "waiting user refunds (1 participant PDAs still funded)",
      fast: true,
    }
  );

  assert.deepEqual(
    describeParticipantCleanupRetry({
      existing: 3,
      closed: 1,
      blockedByRefund: 0,
    }),
    {
      reason: "participant cleanup in progress (2 remaining)",
      fast: true,
    }
  );

  assert.deepEqual(
    describeParticipantCleanupRetry({
      existing: 2,
      closed: 0,
      blockedByRefund: 0,
    }),
    {
      reason: "participant cleanup pending (2 remaining)",
      fast: false,
    }
  );

  assert.equal(
    describeParticipantCleanupRetry({
      existing: 2,
      closed: 2,
      blockedByRefund: 0,
    }),
    null
  );
});

test("buildCleanupRetryScheduleUpdate computes delay, next attempt timestamp, retry count and reason", () => {
  assert.deepEqual(
    buildCleanupRetryScheduleUpdate({
      nowSec: 1_000,
      reason: "participant cleanup pending (2 remaining)",
      minDelaySec: 5,
      maxDelaySec: 60,
      currentDelaySec: 5,
      retryCount: 3,
      fast: false,
    }),
    {
      nextDelaySec: 10,
      nextAttemptAtSec: 1_010,
      nextRetryCount: 4,
      lastReason: "participant cleanup pending (2 remaining)",
    }
  );

  assert.deepEqual(
    buildCleanupRetryScheduleUpdate({
      nowSec: 2_000,
      reason: "waiting user refunds (1 participant PDAs still funded)",
      minDelaySec: 5,
      maxDelaySec: 60,
      currentDelaySec: 60,
      retryCount: 9,
      fast: true,
    }),
    {
      nextDelaySec: 2,
      nextAttemptAtSec: 2_002,
      nextRetryCount: 10,
      lastReason: "waiting user refunds (1 participant PDAs still funded)",
    }
  );

  assert.deepEqual(
    buildCleanupRetryScheduleUpdate({
      nowSec: 3_000,
      reason: "close_round failed: some rpc error",
      minDelaySec: 5,
      maxDelaySec: 60,
      currentDelaySec: 40,
      retryCount: 0,
    }),
    {
      nextDelaySec: 60,
      nextAttemptAtSec: 3_060,
      nextRetryCount: 1,
      lastReason: "close_round failed: some rpc error",
    }
  );
});

test("planParticipantCleanupRetrySchedule composes participant reason + schedule update", () => {
  assert.deepEqual(
    planParticipantCleanupRetrySchedule({
      nowSec: 10_000,
      stats: {
        existing: 2,
        closed: 1,
        blockedByRefund: 1,
      },
      minDelaySec: 5,
      maxDelaySec: 60,
      currentDelaySec: 60,
      retryCount: 7,
    }),
    {
      nextDelaySec: 2,
      nextAttemptAtSec: 10_002,
      nextRetryCount: 8,
      lastReason: "waiting user refunds (1 participant PDAs still funded)",
    }
  );

  assert.equal(
    planParticipantCleanupRetrySchedule({
      nowSec: 10_000,
      stats: {
        existing: 1,
        closed: 1,
        blockedByRefund: 0,
      },
      minDelaySec: 5,
      maxDelaySec: 60,
    }),
    null
  );
});

test("planParticipantCleanupRetrySchedule reproduces real cleanup backoff progression after one close", () => {
  let currentDelaySec = 60;
  let retryCount = 3;
  let nowSec = 1_000;

  // Same shape as your logs: one participant closed, one still waiting refund => fast retry (2s).
  const step1 = planParticipantCleanupRetrySchedule({
    nowSec,
    stats: {
      existing: 2,
      closed: 1,
      blockedByRefund: 1,
    },
    minDelaySec: 5,
    maxDelaySec: 60,
    currentDelaySec,
    retryCount,
  });
  assert.ok(step1);
  assert.equal(step1!.nextDelaySec, 2);
  assert.equal(step1!.lastReason, "waiting user refunds (1 participant PDAs still funded)");
  currentDelaySec = step1!.nextDelaySec;
  retryCount = step1!.nextRetryCount;
  nowSec = step1!.nextAttemptAtSec;

  // No further cleanup progress; user refund still pending => 5,10,20,40,60 cap.
  const expected = [5, 10, 20, 40, 60, 60];
  for (const delay of expected) {
    const step = planParticipantCleanupRetrySchedule({
      nowSec,
      stats: {
        existing: 1,
        closed: 0,
        blockedByRefund: 1,
      },
      minDelaySec: 5,
      maxDelaySec: 60,
      currentDelaySec,
      retryCount,
    });
    assert.ok(step);
    assert.equal(step!.nextDelaySec, delay);
    assert.equal(step!.lastReason, "waiting user refunds (1 participant PDAs still funded)");
    currentDelaySec = step!.nextDelaySec;
    retryCount = step!.nextRetryCount;
    nowSec = step!.nextAttemptAtSec;
  }
});

test("describeCleanupRetryOutcome formats terminal cleanup retry reasons", () => {
  assert.deepEqual(
    describeCleanupRetryOutcome({
      kind: "left_terminal_state",
      status: RoundStatus.Open,
    }),
    {
      reason: "round left terminal state (0)",
      fast: false,
    }
  );

  assert.deepEqual(
    describeCleanupRetryOutcome({
      kind: "close_round_failed",
      message: "blockhash not found",
    }),
    {
      reason: "close_round failed: blockhash not found",
      fast: false,
    }
  );

  assert.deepEqual(
    describeCleanupRetryOutcome({
      kind: "background_error",
      message: "rpc timeout",
    }),
    {
      reason: "background error: rpc timeout",
      fast: false,
    }
  );
});

test("planCleanupRetryScheduleForOutcome schedules non-fast terminal error branches with exact reasons", () => {
  assert.deepEqual(
    planCleanupRetryScheduleForOutcome({
      nowSec: 500,
      outcome: {
        kind: "left_terminal_state",
        status: 3,
      },
      minDelaySec: 5,
      maxDelaySec: 60,
      currentDelaySec: 10,
      retryCount: 4,
    }),
    {
      nextDelaySec: 20,
      nextAttemptAtSec: 520,
      nextRetryCount: 5,
      lastReason: "round left terminal state (3)",
    }
  );

  assert.deepEqual(
    planCleanupRetryScheduleForOutcome({
      nowSec: 700,
      outcome: {
        kind: "close_round_failed",
        message: "custom rpc error",
      },
      minDelaySec: 5,
      maxDelaySec: 60,
      currentDelaySec: 40,
      retryCount: 0,
    }),
    {
      nextDelaySec: 60,
      nextAttemptAtSec: 760,
      nextRetryCount: 1,
      lastReason: "close_round failed: custom rpc error",
    }
  );
});

test("planCleanupRetryScheduleForOutcome switches from fast participant retry back to normal on error outcomes", () => {
  const afterFast = planCleanupRetryScheduleForOutcome({
    nowSec: 1_000,
    outcome: {
      kind: "participants_pending",
      stats: {
        existing: 2,
        closed: 1,
        blockedByRefund: 1,
      },
    },
    minDelaySec: 5,
    maxDelaySec: 60,
    currentDelaySec: 60,
    retryCount: 7,
  });
  assert.ok(afterFast);
  assert.equal(afterFast!.nextDelaySec, 2, "participants pending with progress => fast retry");

  const afterError = planCleanupRetryScheduleForOutcome({
    nowSec: afterFast!.nextAttemptAtSec,
    outcome: {
      kind: "background_error",
      message: "rpc timeout",
    },
    minDelaySec: 5,
    maxDelaySec: 60,
    currentDelaySec: afterFast!.nextDelaySec,
    retryCount: afterFast!.nextRetryCount,
  });
  assert.ok(afterError);
  assert.equal(afterError!.nextDelaySec, 5, "error outcome should return to normal min backoff");
  assert.equal(afterError!.lastReason, "background error: rpc timeout");
});
