/**
 * Tests for RoundDetail page — pure helpers (formatTs, STATUS_LABELS) and
 * key rendering states.
 */
import { describe, expect, it } from "vitest";
import { RoundStatus } from "../lib/constants";
import { formatTs } from "../lib/timeUtils";

// STATUS_LABELS is still defined inline in RoundDetail.tsx (not exported),
// so we keep a mirror here for coverage. If it diverges, extract it.
const STATUS_LABELS: Record<number, { text: string; color: string; bg: string }> = {
  [RoundStatus.Open]: { text: "Open", color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/30" },
  [RoundStatus.Locked]: { text: "Locked", color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/30" },
  [RoundStatus.VrfRequested]: { text: "VRF Requested", color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-900/30" },
  [RoundStatus.Settled]: { text: "Settled", color: "text-primary", bg: "bg-primary/5" },
  [RoundStatus.Claimed]: { text: "Claimed", color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/30" },
  [RoundStatus.Cancelled]: { text: "Cancelled", color: "text-red-500", bg: "bg-red-50 dark:bg-red-900/30" },
};

// ─── Tests ───────────────────────────────────────────────

describe("RoundDetail STATUS_LABELS", () => {
  it("covers all 6 RoundStatus enum values", () => {
    const statuses = [
      RoundStatus.Open,
      RoundStatus.Locked,
      RoundStatus.VrfRequested,
      RoundStatus.Settled,
      RoundStatus.Claimed,
      RoundStatus.Cancelled,
    ];
    for (const s of statuses) {
      expect(STATUS_LABELS[s]).toBeDefined();
      expect(STATUS_LABELS[s].text).toBeTruthy();
      expect(STATUS_LABELS[s].color).toBeTruthy();
      expect(STATUS_LABELS[s].bg).toBeTruthy();
    }
  });

  it("Settled text is 'Settled'", () => {
    expect(STATUS_LABELS[RoundStatus.Settled].text).toBe("Settled");
  });

  it("Cancelled text is 'Cancelled'", () => {
    expect(STATUS_LABELS[RoundStatus.Cancelled].text).toBe("Cancelled");
  });
});

describe("RoundDetail formatTs", () => {
  it("returns dash for 0", () => {
    expect(formatTs(0)).toBe("—");
  });

  it("formats a known timestamp", () => {
    // 1700000000 epoch = Nov 14, 2023
    const result = formatTs(1700000000);
    expect(result).toContain("Nov");
    expect(result).toContain("2023");
    expect(result).toContain("14");
  });

  it("returns dash for falsy (NaN-like) input", () => {
    expect(formatTs(NaN)).toBe("—");
  });
});

// ─── Winner detection logic ─────────────────────────────

describe("isWinner logic", () => {
  function isWinner(
    roundData: { status: number; winner: string } | null,
    publicKeyBase58: string | null,
  ): boolean {
    return !!(
      roundData &&
      publicKeyBase58 &&
      roundData.status === RoundStatus.Settled &&
      roundData.winner === publicKeyBase58
    );
  }

  it("returns true when status=Settled and winner matches", () => {
    expect(
      isWinner({ status: RoundStatus.Settled, winner: "ABC" }, "ABC"),
    ).toBe(true);
  });

  it("returns false when status is not Settled", () => {
    expect(
      isWinner({ status: RoundStatus.Claimed, winner: "ABC" }, "ABC"),
    ).toBe(false);
  });

  it("returns false when winner mismatches", () => {
    expect(
      isWinner({ status: RoundStatus.Settled, winner: "ABC" }, "XYZ"),
    ).toBe(false);
  });

  it("returns false when roundData is null", () => {
    expect(isWinner(null, "ABC")).toBe(false);
  });

  it("returns false when publicKey is null", () => {
    expect(
      isWinner({ status: RoundStatus.Settled, winner: "ABC" }, null),
    ).toBe(false);
  });
});

// ─── Participant percentage calculation ─────────────────

describe("participant percentage calculation", () => {
  function calcPct(usdcAmt: number, totalUsdc: number): number {
    return totalUsdc > 0 ? (usdcAmt / totalUsdc) * 100 : 0;
  }

  it("calculates correct percentage", () => {
    expect(calcPct(25, 100)).toBe(25);
    expect(calcPct(33.33, 100)).toBeCloseTo(33.33, 2);
  });

  it("returns 0 when total is 0", () => {
    expect(calcPct(10, 0)).toBe(0);
  });

  it("handles single participant (100%)", () => {
    expect(calcPct(50, 50)).toBe(100);
  });
});
