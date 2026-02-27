/**
 * Tests for StatsBar component — rendering all 4 stat cells with correct values.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsBar } from "./StatsBar";

describe("StatsBar", () => {
  const defaultProps = {
    totalPot: 1234.56,
    playerCount: 8,
    yourShare: 12.5,
    roundId: 42,
  };

  it("renders total pot formatted with 2 decimals", () => {
    render(<StatsBar {...defaultProps} />);
    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
  });

  it("renders player count", () => {
    render(<StatsBar {...defaultProps} />);
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("renders your share as percentage", () => {
    render(<StatsBar {...defaultProps} />);
    expect(screen.getByText("12.5%")).toBeInTheDocument();
  });

  it("renders round number with hash", () => {
    render(<StatsBar {...defaultProps} />);
    expect(screen.getByText("#42")).toBeInTheDocument();
  });

  it("shows dash when yourShare is 0", () => {
    render(<StatsBar {...defaultProps} yourShare={0} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders all stat labels", () => {
    render(<StatsBar {...defaultProps} />);
    expect(screen.getByText("Total Pot")).toBeInTheDocument();
    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("Your Share")).toBeInTheDocument();
    expect(screen.getByText("Round")).toBeInTheDocument();
  });

  it("handles zero total pot", () => {
    render(<StatsBar {...defaultProps} totalPot={0} />);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("handles large pot values", () => {
    render(<StatsBar {...defaultProps} totalPot={999999.99} />);
    expect(screen.getByText("$999,999.99")).toBeInTheDocument();
  });
});
