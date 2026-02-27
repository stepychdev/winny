/**
 * Tests for RoundInfo component — PHASE_CONFIG mapping and render output.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoundInfo } from "./RoundInfo";
import type { GamePhase } from "../types";

describe("RoundInfo", () => {
  const defaultProps = {
    timeLeft: 30,
    totalUsdc: 100,
    playerCount: 5,
  };

  const phases: { phase: GamePhase; label: string; statusText: string }[] = [
    { phase: "waiting", label: "WAITING", statusText: "Waiting for players..." },
    { phase: "open", label: "OPEN", statusText: "5 players in round" },
    { phase: "countdown", label: "CLOSING", statusText: "Round closing soon!" },
    { phase: "spinning", label: "DRAWING", statusText: "Selecting winner via VRF..." },
    { phase: "settled", label: "SETTLED", statusText: "Winner selected!" },
    { phase: "claimed", label: "CLAIMED", statusText: "Prize claimed" },
    { phase: "cancelled", label: "CANCELLED", statusText: "Round cancelled" },
  ];

  for (const { phase, label, statusText } of phases) {
    it(`renders "${label}" badge for phase=${phase}`, () => {
      render(<RoundInfo {...defaultProps} phase={phase} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it(`renders status text "${statusText}" for phase=${phase}`, () => {
      render(<RoundInfo {...defaultProps} phase={phase} />);
      expect(screen.getByText(statusText)).toBeInTheDocument();
    });
  }

  it("pluralizes 'player' for count=1", () => {
    render(<RoundInfo {...defaultProps} phase="open" playerCount={1} />);
    expect(screen.getByText("1 player in round")).toBeInTheDocument();
  });

  it("pluralizes 'players' for count=3", () => {
    render(<RoundInfo {...defaultProps} phase="open" playerCount={3} />);
    expect(screen.getByText("3 players in round")).toBeInTheDocument();
  });
});
