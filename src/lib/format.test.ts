import { describe, expect, test } from "vitest";
import { formatUsdc, formatUsdcCompact } from "./format";

describe("formatUsdc", () => {
  test("keeps cents for fractional USDC amounts", () => {
    expect(formatUsdc(1.1)).toBe("1.10");
    expect(formatUsdc(1.98)).toBe("1.98");
  });

  test("returns 0.00 for non-finite values", () => {
    expect(formatUsdc(Number.NaN)).toBe("0.00");
    expect(formatUsdc(Number.POSITIVE_INFINITY)).toBe("0.00");
  });
});

describe("formatUsdcCompact", () => {
  test("keeps cents below 1000", () => {
    expect(formatUsdcCompact(999.5)).toBe("999.50");
  });

  test("uses compact k suffix with two decimals", () => {
    expect(formatUsdcCompact(1100)).toBe("1.10k");
    expect(formatUsdcCompact(12345)).toBe("12.35k");
  });
});

