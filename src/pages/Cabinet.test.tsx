/**
 * Tests for Cabinet page — rendering stats, claim batch logic, win rate calc.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────
const mockClaimUnclaimed = vi.fn();
let mockJackpot: any;
let mockPnL: any;
let mockWallet: any;

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => mockWallet,
}));

vi.mock("../hooks/useJackpot", () => ({
  useJackpot: () => mockJackpot,
}));

vi.mock("../hooks/useUserPnL", () => ({
  useUserPnL: () => mockPnL,
}));

vi.mock("../components/Header", () => ({
  Header: () => <div data-testid="Header" />,
}));

vi.mock("../components/PnLChart", () => ({
  PnLChart: () => <div data-testid="PnLChart" />,
}));

// Disable Tapestry social features so portfolio heading / short address render.
vi.mock("../lib/constants", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as Record<string, unknown>), ENABLE_TAPESTRY_SOCIAL: false };
});

// Mock Tapestry social components (noop).
vi.mock("../components/social/SocialProfileCard", () => ({
  SocialProfileCard: () => null,
}));
vi.mock("../components/social/SocialActivityCard", () => ({
  SocialActivityCard: () => null,
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal();
  const Icon = () => <span />;
  return {
    ...(actual as Record<string, unknown>),
    Zap: Icon,
    TrendingUp: Icon,
    DollarSign: Icon,
    Award: Icon,
    AlertCircle: Icon,
  };
});

import { Cabinet } from "./Cabinet";

describe("Cabinet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWallet = {
      publicKey: {
        toBase58: () => "AbcDEFGHijk123456789abcdefghijk123456789XY",
      },
      connected: true,
    };
    mockJackpot = {
      roundId: 10,
      participants: [],
      unclaimedPrizes: [],
      claimUnclaimed: mockClaimUnclaimed,
    };
    mockPnL = {
      transactions: [],
      totalDeposited: 500.0,
      totalWon: 750.0,
      roundCount: 20,
      winCount: 5,
    };
  });

  it("renders portfolio heading", () => {
    render(<Cabinet />);
    expect(screen.getByText("My Portfolio")).toBeInTheDocument();
  });

  it("renders shortened wallet address", () => {
    render(<Cabinet />);
    // shortAddress = slice(0,6) + "..." + slice(-4) = "AbcDEF...89XY"
    expect(screen.getByText("AbcDEF...89XY")).toBeInTheDocument();
  });

  it("renders total deposited stat", () => {
    render(<Cabinet />);
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("Total Deposited")).toBeInTheDocument();
  });

  it("renders total won stat", () => {
    render(<Cabinet />);
    expect(screen.getByText("$750.00")).toBeInTheDocument();
    expect(screen.getByText("Total Won")).toBeInTheDocument();
  });

  it("calculates and renders win rate correctly", () => {
    render(<Cabinet />);
    // 5 wins / 20 rounds = 25%
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows 0% win rate with zero rounds", () => {
    mockPnL.roundCount = 0;
    mockPnL.winCount = 0;
    render(<Cabinet />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders unclaimed prize total", () => {
    mockJackpot.unclaimedPrizes = [
      { roundId: 1, payout: 50.0, timestamp: 1700000000 },
      { roundId: 2, payout: 30.0, timestamp: 1700000000 },
    ];
    render(<Cabinet />);
    expect(screen.getByText("$80.00")).toBeInTheDocument();
  });

  it("disables Claim button when no unclaimed prizes", () => {
    mockJackpot.unclaimedPrizes = [];
    render(<Cabinet />);
    const claimBtn = screen.getByText("Claim Now").closest("button")!;
    expect(claimBtn).toBeDisabled();
  });

  it("claims all unclaimed prizes in sequence when Claim Now clicked", async () => {
    mockClaimUnclaimed.mockResolvedValue("sig");
    mockJackpot.unclaimedPrizes = [
      { roundId: 3, payout: 25.0, timestamp: 1700000000 },
      { roundId: 7, payout: 15.0, timestamp: 1700000000 },
    ];
    render(<Cabinet />);
    fireEvent.click(screen.getByText("Claim Now"));
    await waitFor(() => {
      expect(mockClaimUnclaimed).toHaveBeenCalledTimes(2);
      expect(mockClaimUnclaimed).toHaveBeenCalledWith(3);
      expect(mockClaimUnclaimed).toHaveBeenCalledWith(7);
    });
  });

  it("shows success message after claiming", async () => {
    mockClaimUnclaimed.mockResolvedValue("sig");
    mockJackpot.unclaimedPrizes = [
      { roundId: 3, payout: 25.0, timestamp: 1700000000 },
    ];
    render(<Cabinet />);
    fireEvent.click(screen.getByText("Claim Now"));
    await waitFor(() => {
      expect(screen.getByText("Successfully claimed!")).toBeInTheDocument();
    });
  });

  it("shows error message when claim fails", async () => {
    mockClaimUnclaimed.mockRejectedValue(new Error("Network error"));
    mockJackpot.unclaimedPrizes = [
      { roundId: 3, payout: 25.0, timestamp: 1700000000 },
    ];
    render(<Cabinet />);
    fireEvent.click(screen.getByText("Claim Now"));
    await waitFor(() => {
      expect(screen.getByText("Claim failed")).toBeInTheDocument();
    });
  });

  it("shows 'No activity yet' when no unclaimed prizes", () => {
    mockJackpot.unclaimedPrizes = [];
    render(<Cabinet />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders PnLChart component", () => {
    render(<Cabinet />);
    expect(screen.getByTestId("PnLChart")).toBeInTheDocument();
  });
});
