import { describe, expect, test } from "vitest";
import {
  deriveDegenCandidates,
  getDegenPool,
  getDegenPoolVersion,
} from "./degenClaim";

describe("degenClaim candidate derivation", () => {
  test("returns the same ordered candidates for the same randomness", async () => {
    const randomness = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const poolVersion = getDegenPoolVersion(true);

    const a = await deriveDegenCandidates(randomness, poolVersion, 10, true);
    const b = await deriveDegenCandidates(randomness, poolVersion, 10, true);

    expect(a).toEqual(b);
  });

  test("returns unique candidate indices inside the requested window", async () => {
    const randomness = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const candidates = await deriveDegenCandidates(randomness, getDegenPoolVersion(true), 10, true);
    const unique = new Set(candidates.map((candidate) => candidate.index));

    expect(candidates).toHaveLength(10);
    expect(unique.size).toBe(10);
  });

  test("devnet derivation stays inside the devnet-safe pool", async () => {
    const randomness = Uint8Array.from({ length: 32 }, () => 7);
    const candidates = await deriveDegenCandidates(randomness, getDegenPoolVersion(false), 1, false);

    expect(candidates[0]?.mint).toBe(getDegenPool(false)[0]);
  });
});
