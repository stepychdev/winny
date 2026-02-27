import { describe, expect, test } from "vitest";
import { shouldShowCancelRefundCard } from "./roundUi";

describe("shouldShowCancelRefundCard", () => {
  test("hides when wallet is disconnected", () => {
    expect(
      shouldShowCancelRefundCard({
        connected: false,
        hasMyDeposit: true,
        phase: "open",
        timeLeft: 0,
      })
    ).toBe(false);
  });

  test("hides when user has no deposit", () => {
    expect(
      shouldShowCancelRefundCard({
        connected: true,
        hasMyDeposit: false,
        phase: "open",
        timeLeft: 0,
      })
    ).toBe(false);
  });

  test("shows only before countdown starts", () => {
    expect(
      shouldShowCancelRefundCard({
        connected: true,
        hasMyDeposit: true,
        phase: "open",
        timeLeft: 0,
      })
    ).toBe(true);

    expect(
      shouldShowCancelRefundCard({
        connected: true,
        hasMyDeposit: true,
        phase: "open",
        timeLeft: 59,
      })
    ).toBe(false);
  });

  test("hides for non-open phases", () => {
    for (const phase of ["countdown", "spinning", "settled", "claimed", "cancelled", "waiting"] as const) {
      expect(
        shouldShowCancelRefundCard({
          connected: true,
          hasMyDeposit: true,
          phase,
          timeLeft: 0,
        })
      ).toBe(false);
    }
  });
});

