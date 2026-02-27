/**
 * Unit tests for JackpotWheel pure utilities (now in src/lib/wheelUtils.ts).
 */
import { describe, expect, it } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  landingEase,
  buildSegments,
  SEGMENT_COLORS,
} from "../lib/wheelUtils";

interface Participant {
  address: string;
  displayName: string;
  color: string;
  usdcAmount: number;
  tickets: number;
  tokens: { symbol: string; amount: number; icon: string }[];
}

// ─── Tests ───────────────────────────────────────────────

describe("hexToRgb", () => {
  it("parses pure red", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
  });
  it("parses pure green", () => {
    expect(hexToRgb("#00ff00")).toEqual([0, 255, 0]);
  });
  it("parses without hash prefix", () => {
    expect(hexToRgb("0000ff")).toEqual([0, 0, 255]);
  });
  it("handles segment color", () => {
    expect(hexToRgb("#4f46e5")).toEqual([79, 70, 229]);
  });
});

describe("rgbToHex", () => {
  it("converts pure white", () => {
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });
  it("converts pure black", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });
  it("clamps values above 255", () => {
    expect(rgbToHex(300, 0, 0)).toBe("#ff0000");
  });
  it("clamps negative values", () => {
    expect(rgbToHex(-10, 0, 0)).toBe("#000000");
  });
  it("rounds fractional values", () => {
    expect(rgbToHex(127.6, 0, 0)).toBe("#800000");
  });
});

describe("lighten", () => {
  it("lightening black by 100% gives white", () => {
    expect(lighten("#000000", 100)).toBe("#ffffff");
  });
  it("lightening by 0% returns same color", () => {
    expect(lighten("#4f46e5", 0)).toBe("#4f46e5");
  });
  it("lightening by 50% moves halfway to white", () => {
    // #000000 -> halfway = #808080 (rounding: 128)
    expect(lighten("#000000", 50)).toBe("#808080");
  });
});

describe("darken", () => {
  it("darkening white by 100% gives black", () => {
    expect(darken("#ffffff", 100)).toBe("#000000");
  });
  it("darkening by 0% returns same color", () => {
    expect(darken("#4f46e5", 0)).toBe("#4f46e5");
  });
  it("darkening by 50% halves each channel", () => {
    // #ff8040 -> 128, 64, 32 = #804020
    expect(darken("#ff8040", 50)).toBe("#804020");
  });
});

describe("landingEase", () => {
  it("returns 0 at t=0", () => {
    expect(landingEase(0)).toBe(0);
  });
  it("returns 1 at t=1", () => {
    expect(landingEase(1)).toBe(1);
  });
  it("is monotonically increasing", () => {
    const values = Array.from({ length: 11 }, (_, i) => landingEase(i / 10));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
  it("decelerates (second half is slower than first half)", () => {
    const firstHalf = landingEase(0.5) - landingEase(0);
    const secondHalf = landingEase(1) - landingEase(0.5);
    expect(firstHalf).toBeGreaterThan(secondHalf);
  });
  it("returns approximately 0.82 at t=0.5", () => {
    // 1 - (0.5)^3.5 ≈ 0.9116
    // Actually: 1 - 0.5^3.5 = 1 - 0.08839 = 0.91161
    expect(landingEase(0.5)).toBeCloseTo(0.9116, 3);
  });
});

describe("buildSegments", () => {
  const mkParticipant = (name: string, amount: number, color = ""): Participant => ({
    address: "addr",
    displayName: name,
    color,
    usdcAmount: amount,
    tickets: amount * 100,
    tokens: [],
  });

  it("returns empty array for no participants", () => {
    expect(buildSegments([])).toEqual([]);
  });

  it("single participant gets 100% (full circle)", () => {
    const segs = buildSegments([mkParticipant("Alice", 10)]);
    expect(segs).toHaveLength(1);
    expect(segs[0].pct).toBeCloseTo(100, 1);
    expect(segs[0].startAngle).toBe(0);
    expect(segs[0].endAngle).toBeCloseTo(Math.PI * 2, 5);
    expect(segs[0].label).toBe("Alice");
  });

  it("two equal participants get 50% each", () => {
    const segs = buildSegments([
      mkParticipant("A", 5),
      mkParticipant("B", 5),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].pct).toBeCloseTo(50, 1);
    expect(segs[1].pct).toBeCloseTo(50, 1);
    // Segments should be contiguous
    expect(segs[1].startAngle).toBeCloseTo(segs[0].endAngle, 10);
  });

  it("uses participant color when provided", () => {
    const segs = buildSegments([mkParticipant("A", 5, "#ff0000")]);
    expect(segs[0].color).toBe("#ff0000");
  });

  it("falls back to SEGMENT_COLORS for empty color", () => {
    const segs = buildSegments([mkParticipant("A", 5, "")]);
    expect(segs[0].color).toBe(SEGMENT_COLORS[0]);
  });

  it("wraps around SEGMENT_COLORS for many participants", () => {
    const participants = Array.from({ length: 15 }, (_, i) =>
      mkParticipant(`P${i}`, 1, ""),
    );
    const segs = buildSegments(participants);
    expect(segs[12].color).toBe(SEGMENT_COLORS[0]); // 12 % 12 = 0
    expect(segs[13].color).toBe(SEGMENT_COLORS[1]); // 13 % 12 = 1
  });

  it("sums angles to 2π", () => {
    const segs = buildSegments([
      mkParticipant("A", 3),
      mkParticipant("B", 7),
      mkParticipant("C", 5),
    ]);
    const totalSweep = segs.reduce((s, seg) => s + (seg.endAngle - seg.startAngle), 0);
    expect(totalSweep).toBeCloseTo(Math.PI * 2, 10);
  });

  it("handles zero-amount participants gracefully", () => {
    // All zero → total falls back to 1 to avoid div-by-zero
    const segs = buildSegments([
      mkParticipant("A", 0),
      mkParticipant("B", 0),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].pct).toBe(0);
    expect(segs[1].pct).toBe(0);
  });
});
