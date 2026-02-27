import assert from "node:assert";
import { test } from "node:test";
import { RoundStatus } from "../src/constants.ts";
import {
  isActiveRoundStatus,
  scanForActiveRound,
  type ScanEntry,
} from "../src/activeRoundScan.ts";

test("isActiveRoundStatus matches statuses used by crank for active scanning", () => {
  assert.equal(isActiveRoundStatus(RoundStatus.Open), true);
  assert.equal(isActiveRoundStatus(RoundStatus.Locked), true);
  assert.equal(isActiveRoundStatus(RoundStatus.VrfRequested), true);
  assert.equal(isActiveRoundStatus(RoundStatus.Settled), true);
  assert.equal(isActiveRoundStatus(RoundStatus.Claimed), false);
  assert.equal(isActiveRoundStatus(RoundStatus.Cancelled), false);
});

test("scanForActiveRound picks latest active round and ignores cancelled/claimed", async () => {
  const statuses = new Map<number, number>([
    [80, RoundStatus.Cancelled],
    [81, RoundStatus.Claimed],
    [82, RoundStatus.Cancelled],
    [83, RoundStatus.Open],
  ]);

  const result = await scanForActiveRound({
    scanStart: 78,
    archivedMax: 82,
    maxScan: 20,
    batchSize: 5,
    nullStreakLimit: 5,
    fetchBatch: async (ids) =>
      ids.map((id): ScanEntry => {
        const status = statuses.get(id);
        return status == null ? { kind: "missing" } : { kind: "round", status };
      }),
  });

  assert.equal(result, 83);
});

test("scanForActiveRound returns highWaterMark + 1 when no active rounds exist", async () => {
  const statuses = new Map<number, number>([
    [80, RoundStatus.Cancelled],
    [82, RoundStatus.Claimed],
  ]);

  const result = await scanForActiveRound({
    scanStart: 78,
    archivedMax: 84,
    maxScan: 20,
    batchSize: 5,
    nullStreakLimit: 5,
    fetchBatch: async (ids) =>
      ids.map((id): ScanEntry => {
        const status = statuses.get(id);
        return status == null ? { kind: "missing" } : { kind: "round", status };
      }),
  });

  // archivedMax wins over on-chain maxExisting to prevent round ID reuse after cleanup.
  assert.equal(result, 85);
});

test("scanForActiveRound tolerates invalid entries and null streak gaps", async () => {
  const calls: Array<Array<number>> = [];

  const result = await scanForActiveRound({
    scanStart: 1,
    archivedMax: 0,
    maxScan: 30,
    batchSize: 4,
    nullStreakLimit: 3,
    fetchBatch: async (ids) => {
      calls.push([...ids]);
      return ids.map((id): ScanEntry => {
        if (id === 1) return { kind: "invalid" };
        if (id === 2) return { kind: "round", status: RoundStatus.Cancelled };
        if (id === 3) return { kind: "round", status: RoundStatus.Settled };
        if (id >= 4) return { kind: "missing" };
        return { kind: "missing" };
      });
    },
  });

  assert.equal(result, 3, "latest active round should be settled #3");
  assert.ok(calls.length >= 1);
  assert.ok(
    calls.length <= 2,
    "scanner should stop early after null streak once maxExisting is known"
  );
});

