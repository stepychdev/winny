/**
 * Tests for src/lib/wheelUtils.ts
 */
import { describe, expect, it } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  landingEase,
  EASE_EXPONENT,
  buildSegments,
  SEGMENT_COLORS,
} from "./wheelUtils";

describe("hexToRgb", () => {
  it("parses #ff0000", () => expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]));
  it("parses without hash", () => expect(hexToRgb("00ff00")).toEqual([0, 255, 0]));
  it("parses segment color", () => expect(hexToRgb("#4f46e5")).toEqual([79, 70, 229]));
});

describe("rgbToHex", () => {
  it("converts white", () => expect(rgbToHex(255, 255, 255)).toBe("#ffffff"));
  it("converts black", () => expect(rgbToHex(0, 0, 0)).toBe("#000000"));
  it("clamps > 255", () => expect(rgbToHex(300, 0, 0)).toBe("#ff0000"));
  it("clamps < 0", () => expect(rgbToHex(-10, 0, 0)).toBe("#000000"));
});

describe("lighten / darken", () => {
  it("lighten black 100% → white", () => expect(lighten("#000000", 100)).toBe("#ffffff"));
  it("lighten 0% → same", () => expect(lighten("#4f46e5", 0)).toBe("#4f46e5"));
  it("darken white 100% → black", () => expect(darken("#ffffff", 100)).toBe("#000000"));
  it("darken 0% → same", () => expect(darken("#4f46e5", 0)).toBe("#4f46e5"));
});

describe("landingEase", () => {
  it("ease(0) = 0", () => expect(landingEase(0)).toBe(0));
  it("ease(1) = 1", () => expect(landingEase(1)).toBe(1));
  it("monotonically increasing", () => {
    const vals = Array.from({ length: 11 }, (_, i) => landingEase(i / 10));
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    }
  });
});

describe("EASE_EXPONENT", () => {
  it("equals 3.5", () => expect(EASE_EXPONENT).toBe(3.5));
});

describe("SEGMENT_COLORS", () => {
  it("has 12 colors", () => expect(SEGMENT_COLORS).toHaveLength(12));
  it("all start with #", () => {
    for (const c of SEGMENT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("buildSegments", () => {
  const mk = (name: string, amount: number, color = "") => ({
    displayName: name,
    color,
    usdcAmount: amount,
  });

  it("empty → empty", () => expect(buildSegments([])).toEqual([]));

  it("single → 100%", () => {
    const segs = buildSegments([mk("A", 10)]);
    expect(segs[0].pct).toBeCloseTo(100);
    expect(segs[0].endAngle).toBeCloseTo(Math.PI * 2);
  });

  it("two equal → 50% each", () => {
    const segs = buildSegments([mk("A", 5), mk("B", 5)]);
    expect(segs[0].pct).toBeCloseTo(50);
    expect(segs[1].pct).toBeCloseTo(50);
  });

  it("uses participant color when present", () => {
    expect(buildSegments([mk("A", 5, "#ff0000")])[0].color).toBe("#ff0000");
  });

  it("falls back to SEGMENT_COLORS", () => {
    expect(buildSegments([mk("A", 5)])[0].color).toBe(SEGMENT_COLORS[0]);
  });

  it("sums to 2π", () => {
    const segs = buildSegments([mk("A", 3), mk("B", 7), mk("C", 5)]);
    const total = segs.reduce((s, seg) => s + (seg.endAngle - seg.startAngle), 0);
    expect(total).toBeCloseTo(Math.PI * 2);
  });
});
