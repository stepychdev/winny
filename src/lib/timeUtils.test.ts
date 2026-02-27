/**
 * Tests for src/lib/timeUtils.ts
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { timeAgo, formatTs } from "./timeUtils";

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000 * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns dash for 0", () => {
    expect(timeAgo(0)).toBe("\u2014");
  });

  it("returns 'Just now' for < 60s ago", () => {
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

  it("boundary: 60s → 1m ago", () => {
    expect(timeAgo(1700000000 - 60)).toBe("1m ago");
  });

  it("boundary: 3600s → 1h ago", () => {
    expect(timeAgo(1700000000 - 3600)).toBe("1h ago");
  });

  it("boundary: 86400s → 1d ago", () => {
    expect(timeAgo(1700000000 - 86400)).toBe("1d ago");
  });
});

describe("formatTs", () => {
  it("returns dash for 0", () => {
    expect(formatTs(0)).toBe("—");
  });

  it("returns dash for NaN", () => {
    expect(formatTs(NaN)).toBe("—");
  });

  it("formats a known timestamp", () => {
    const result = formatTs(1700000000);
    expect(result).toContain("Nov");
    expect(result).toContain("2023");
    expect(result).toContain("14");
  });

  it("includes time components", () => {
    const result = formatTs(1700000000);
    // Should contain hour:minute:second in 24h format
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
