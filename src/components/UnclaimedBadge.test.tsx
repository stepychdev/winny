/**
 * Tests for UnclaimedBadge component — claim flow, dismiss, error handling.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { UnclaimedBadge } from "./UnclaimedBadge";

// Mock lucide-react icons
vi.mock("lucide-react", () => {
  const Icon = ({ className }: { className?: string }) => (
    <span data-testid="icon" className={className} />
  );
  return {
    Trophy: Icon,
    X: Icon,
    Loader2: Icon,
  };
});

const mockPrize = {
  roundId: 42,
  winnerAddress: "So1111111111111111111111111111111111111111112",
  payout: 123.45,
  totalUsdc: 246.90,
  timestamp: 1700000000,
};

describe("UnclaimedBadge", () => {
  let onClaimMock: ReturnType<typeof vi.fn>;
  let onClaimDegenMock: ReturnType<typeof vi.fn>;
  let onClaim: (roundId: number) => Promise<string>;
  let onClaimDegen: (roundId: number) => Promise<unknown>;

  beforeEach(() => {
    onClaimMock = vi.fn().mockResolvedValue("txSig123");
    onClaimDegenMock = vi.fn().mockResolvedValue({ claimSig: "degenTxSig123" });
    onClaim = onClaimMock as unknown as (roundId: number) => Promise<string>;
    onClaimDegen = onClaimDegenMock as unknown as (roundId: number) => Promise<unknown>;
  });

  it("renders round number and payout", () => {
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    expect(screen.getByText("You won Round #42!")).toBeInTheDocument();
    expect(screen.getByText("$123.45 USDC unclaimed")).toBeInTheDocument();
  });

  it("renders USDC and DEGEN claim buttons", () => {
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("DEGEN")).toBeInTheDocument();
  });

  it("calls onClaim with roundId when USDC clicked", async () => {
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    fireEvent.click(screen.getByText("USDC"));
    await waitFor(() => {
      expect(onClaimMock).toHaveBeenCalledWith(42);
    });
  });

  it("hides badge after successful claim", async () => {
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    fireEvent.click(screen.getByText("USDC"));
    await waitFor(() => {
      expect(screen.queryByText("You won Round #42!")).not.toBeInTheDocument();
    });
  });

  it("shows error message on claim failure", async () => {
    onClaimMock.mockRejectedValue(new Error("Insufficient funds for transaction"));
    onClaim = onClaimMock as unknown as (roundId: number) => Promise<string>;
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    fireEvent.click(screen.getByText("USDC"));
    await waitFor(() => {
      expect(screen.getByText("Insufficient funds for transaction")).toBeInTheDocument();
    });
  });

  it("truncates long error messages to 50 chars", async () => {
    const longMsg = "A".repeat(100);
    onClaimMock.mockRejectedValue(new Error(longMsg));
    onClaim = onClaimMock as unknown as (roundId: number) => Promise<string>;
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    fireEvent.click(screen.getByText("USDC"));
    await waitFor(() => {
      const errorEl = screen.getByText("A".repeat(50));
      expect(errorEl).toBeInTheDocument();
    });
  });

  it("shows fallback error text when message is undefined", async () => {
    onClaimMock.mockRejectedValue({});
    onClaim = onClaimMock as unknown as (roundId: number) => Promise<string>;
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    fireEvent.click(screen.getByText("USDC"));
    await waitFor(() => {
      expect(screen.getByText("Claim failed")).toBeInTheDocument();
    });
  });

  it("hides badge when dismiss (X) clicked", () => {
    render(<UnclaimedBadge prize={mockPrize} loading={false} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    // Dismiss button is the second button (close icon)
    const buttons = screen.getAllByRole("button");
    // Find the dismiss button (the one that is not claim buttons)
    const dismissBtn = buttons.find((b) => b.textContent !== "USDC" && b.textContent !== "DEGEN")!;
    fireEvent.click(dismissBtn);
    expect(screen.queryByText("You won Round #42!")).not.toBeInTheDocument();
  });

  it("disables both claim buttons when loading=true", () => {
    render(<UnclaimedBadge prize={mockPrize} loading={true} onClaim={onClaim} onClaimDegen={onClaimDegen} />);
    const usdcBtn = screen.getByText("USDC").closest("button")!;
    const degenBtn = screen.getByText("DEGEN").closest("button")!;
    expect(usdcBtn).toBeDisabled();
    expect(degenBtn).toBeDisabled();
  });
});
