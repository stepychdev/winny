/**
 * Tests for History page helper functions: shortenAddr, timeAgo, STATUS_MAP,
 * and the filtering logic.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RoundStatus } from "../lib/constants";
import { shortenAddr } from "../lib/addressUtils";
import { timeAgo } from "../lib/timeUtils";

const STATUS_MAP: Record<number, { text: string; bg: string; textColor: string; ring: string }> = {
  [RoundStatus.Open]:         { text: "Active",    bg: "bg-blue-50 dark:bg-blue-900/30", textColor: "text-blue-700 dark:text-blue-400", ring: "ring-blue-700/10" },
  [RoundStatus.Locked]:       { text: "Locked",    bg: "bg-amber-50 dark:bg-amber-900/30", textColor: "text-amber-700 dark:text-amber-400", ring: "ring-amber-600/20" },
  [RoundStatus.VrfRequested]: { text: "Drawing",   bg: "bg-sky-50 dark:bg-sky-900/30", textColor: "text-sky-700 dark:text-sky-400", ring: "ring-sky-600/20" },
  [RoundStatus.Settled]:      { text: "Unclaimed", bg: "bg-orange-50 dark:bg-orange-900/30", textColor: "text-orange-700 dark:text-orange-400", ring: "ring-orange-600/20" },
  [RoundStatus.Claimed]:      { text: "Claimed",   bg: "bg-green-50 dark:bg-green-900/30", textColor: "text-green-700 dark:text-green-400", ring: "ring-green-600/20" },
  [RoundStatus.Cancelled]:    { text: "Cancelled", bg: "bg-slate-50 dark:bg-slate-800", textColor: "text-slate-600 dark:text-slate-400", ring: "ring-slate-500/10" },
};

// ─── Tests ───────────────────────────────────────────────

describe("shortenAddr", () => {
  it("shortens a normal address", () => {
    expect(shortenAddr("AbcD1234567890XYZ1234567890abcdef12345678")).toBe(
      "AbcD...5678",
    );
  });

  it("returns dash for empty string", () => {
    expect(shortenAddr("")).toBe("\u2014");
  });

  it("returns dash for system program (all 1s)", () => {
    expect(shortenAddr("11111111111111111111111111111111")).toBe("\u2014");
  });

  it("handles very short addresses gracefully", () => {
    // Edge case — should still not throw
    const result = shortenAddr("abc");
    expect(typeof result).toBe("string");
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix current time at 1700000000 seconds epoch (2023-11-14)
    vi.setSystemTime(1700000000 * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns dash for 0 timestamp", () => {
    expect(timeAgo(0)).toBe("\u2014");
  });

  it("returns 'Just now' for < 60 seconds ago", () => {
    expect(timeAgo(1700000000 - 30)).toBe("Just now");
  });

  it("returns minutes ago", () => {
    expect(timeAgo(1700000000 - 300)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    expect(timeAgo(1700000000 - 7200)).toBe("2h ago");
  });

  it("returns days ago", () => {
    expect(timeAgo(1700000000 - 172800)).toBe("2d ago");
  });

  it("boundary: exactly 60 seconds → 1m ago", () => {
    expect(timeAgo(1700000000 - 60)).toBe("1m ago");
  });

  it("boundary: exactly 3600 seconds → 1h ago", () => {
    expect(timeAgo(1700000000 - 3600)).toBe("1h ago");
  });

  it("boundary: exactly 86400 seconds → 1d ago", () => {
    expect(timeAgo(1700000000 - 86400)).toBe("1d ago");
  });
});

describe("STATUS_MAP", () => {
  it("covers all RoundStatus values", () => {
    const expected = [
      RoundStatus.Open,
      RoundStatus.Locked,
      RoundStatus.VrfRequested,
      RoundStatus.Settled,
      RoundStatus.Claimed,
      RoundStatus.Cancelled,
    ];
    for (const status of expected) {
      expect(STATUS_MAP[status]).toBeDefined();
      expect(STATUS_MAP[status].text).toBeTruthy();
    }
  });

  it("maps Settled to 'Unclaimed'", () => {
    expect(STATUS_MAP[RoundStatus.Settled].text).toBe("Unclaimed");
  });

  it("maps Open to 'Active'", () => {
    expect(STATUS_MAP[RoundStatus.Open].text).toBe("Active");
  });
});

// ─── Filter logic (mirrors History.tsx `filtered` computation) ───

type Filter = "all" | "won" | "lost" | "active";

function isActive(status: number): boolean {
  return (
    status === RoundStatus.Open ||
    status === RoundStatus.Locked ||
    status === RoundStatus.VrfRequested
  );
}

interface MockRound {
  roundId: number;
  status: number;
  winner: string;
  participantsCount: number;
}

function applyFilter(rounds: MockRound[], filter: Filter, query = ""): MockRound[] {
  return rounds.filter((r) => {
    if (query) {
      const q = query.toLowerCase();
      if (!String(r.roundId).includes(q) && !r.winner.toLowerCase().includes(q)) return false;
    }
    if (filter === "won") return r.status === RoundStatus.Claimed || r.status === RoundStatus.Settled;
    if (filter === "lost") return r.status === RoundStatus.Cancelled;
    if (filter === "active") return isActive(r.status);
    return true;
  });
}

describe("History filter logic", () => {
  const rounds: MockRound[] = [
    { roundId: 1, status: RoundStatus.Claimed, winner: "Alice123", participantsCount: 5 },
    { roundId: 2, status: RoundStatus.Cancelled, winner: "", participantsCount: 2 },
    { roundId: 3, status: RoundStatus.Open, winner: "", participantsCount: 3 },
    { roundId: 4, status: RoundStatus.Settled, winner: "Bob456", participantsCount: 4 },
    { roundId: 5, status: RoundStatus.Locked, winner: "", participantsCount: 3 },
  ];

  it("'all' returns everything", () => {
    expect(applyFilter(rounds, "all")).toHaveLength(5);
  });

  it("'won' returns Claimed + Settled", () => {
    const result = applyFilter(rounds, "won");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.roundId)).toEqual([1, 4]);
  });

  it("'lost' returns Cancelled", () => {
    const result = applyFilter(rounds, "lost");
    expect(result).toHaveLength(1);
    expect(result[0].roundId).toBe(2);
  });

  it("'active' returns Open + Locked + VrfRequested", () => {
    const result = applyFilter(rounds, "active");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.roundId)).toEqual([3, 5]);
  });

  it("search by roundId", () => {
    const result = applyFilter(rounds, "all", "4");
    expect(result).toHaveLength(1);
    expect(result[0].roundId).toBe(4);
  });

  it("search by winner (case-insensitive)", () => {
    const result = applyFilter(rounds, "all", "alice");
    expect(result).toHaveLength(1);
    expect(result[0].roundId).toBe(1);
  });

  it("combined filter + search", () => {
    // "won" + "Bob" should find round 4 (Settled, winner=Bob456)
    const result = applyFilter(rounds, "won", "bob");
    expect(result).toHaveLength(1);
    expect(result[0].roundId).toBe(4);
  });

  it("no match returns empty", () => {
    expect(applyFilter(rounds, "all", "zzz")).toHaveLength(0);
  });
});
