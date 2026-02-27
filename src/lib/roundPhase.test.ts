import { describe, expect, test } from "vitest";
import { RoundStatus } from "./constants";
import { phaseFromStatus } from "./roundPhase";

describe("phaseFromStatus", () => {
  test("maps terminal and in-progress statuses", () => {
    expect(phaseFromStatus(RoundStatus.Cancelled, 0n, 100)).toBe("cancelled");
    expect(phaseFromStatus(RoundStatus.Claimed, 0n, 100)).toBe("claimed");
    expect(phaseFromStatus(RoundStatus.Settled, 0n, 100)).toBe("settled");
    expect(phaseFromStatus(RoundStatus.Locked, 0n, 100)).toBe("spinning");
    expect(phaseFromStatus(RoundStatus.VrfRequested, 0n, 100)).toBe("spinning");
  });

  test("returns open before countdown starts", () => {
    const now = 1_000;
    const endTs = BigInt(now + 30);
    expect(phaseFromStatus(RoundStatus.Open, endTs, now)).toBe("open");
  });

  test("returns countdown for final 6 seconds", () => {
    const now = 1_000;
    expect(phaseFromStatus(RoundStatus.Open, BigInt(now + 6), now)).toBe("countdown");
    expect(phaseFromStatus(RoundStatus.Open, BigInt(now + 1), now)).toBe("countdown");
  });

  test("returns countdown after timer expiry for open rounds", () => {
    const now = 1_000;
    expect(phaseFromStatus(RoundStatus.Open, BigInt(now - 1), now)).toBe("countdown");
  });

  test("returns waiting for unknown statuses", () => {
    expect(phaseFromStatus(255, 0n, 100)).toBe("waiting");
  });
});

