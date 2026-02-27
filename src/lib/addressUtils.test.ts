/**
 * Tests for src/lib/addressUtils.ts
 */
import { describe, expect, it } from "vitest";
import { shortenAddr } from "./addressUtils";

describe("shortenAddr", () => {
  it("shortens a normal base58 address", () => {
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

  it("handles short address without crashing", () => {
    expect(typeof shortenAddr("abc")).toBe("string");
  });

  it("preserves full 4+4 slice for 44-char address", () => {
    const addr = "A".repeat(40) + "WXYZ";
    expect(shortenAddr(addr)).toBe("AAAA...WXYZ");
  });
});
