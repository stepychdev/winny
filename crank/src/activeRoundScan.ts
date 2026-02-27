import { RoundStatus } from "./constants.js";

export type ScanEntry =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "round"; status: number };

export type ActiveRoundScanArgs = {
  scanStart: number;
  archivedMax: number;
  maxScan: number;
  batchSize: number;
  nullStreakLimit: number;
  fetchBatch: (ids: Array<number>) => Promise<Array<ScanEntry>>;
};

export function isActiveRoundStatus(status: number): boolean {
  return (
    status === RoundStatus.Open ||
    status === RoundStatus.Locked ||
    status === RoundStatus.VrfRequested ||
    status === RoundStatus.Settled
  );
}

export async function scanForActiveRound(args: ActiveRoundScanArgs): Promise<number> {
  let maxExisting = 0;
  let activeRound = 0;
  let nullStreak = 0;

  for (
    let base = args.scanStart;
    base <= args.scanStart + args.maxScan;
    base += args.batchSize
  ) {
    const ids: Array<number> = [];
    for (let i = 0; i < args.batchSize; i++) {
      ids.push(base + i);
    }

    const entries = await args.fetchBatch(ids);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (!entry || entry.kind === "missing") {
        nullStreak++;
        if (maxExisting > 0 && nullStreak >= args.nullStreakLimit) break;
        continue;
      }

      nullStreak = 0;

      if (entry.kind === "invalid") {
        continue;
      }

      const id = ids[i];
      maxExisting = id;
      if (isActiveRoundStatus(entry.status)) {
        activeRound = id;
      }
    }

    if (maxExisting > 0 && nullStreak >= args.nullStreakLimit) break;
  }

  const highWaterMark = Math.max(maxExisting, args.archivedMax);
  return activeRound > 0 ? activeRound : highWaterMark + 1;
}

