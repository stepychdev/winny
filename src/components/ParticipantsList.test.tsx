import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Participant } from "../types";
import { ParticipantsList } from "./ParticipantsList";

let walletPublicKey: { toBase58: () => string } | null = null;

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: walletPublicKey }),
}));

function makeParticipant(args: {
  address: string;
  displayName: string;
  color: string;
  usdcAmount: number;
}): Participant {
  return {
    address: args.address,
    displayName: args.displayName,
    color: args.color,
    usdcAmount: args.usdcAmount,
    tickets: Math.floor(args.usdcAmount * 100),
    tokens: [{ symbol: "USDC", amount: args.usdcAmount, icon: "" }],
  };
}

describe("ParticipantsList", () => {
  beforeEach(() => {
    walletPublicKey = null;
  });

  test("renders participant amounts with cents (regression: $1.10 should not round to $1)", () => {
    const participants: Array<Participant> = [
      makeParticipant({
        address: "5mjKaFPXX6J4vmcyS1W7u8ostx5Rt1A9knigbpjnQof5",
        displayName: "You",
        color: "#00bcd4",
        usdcAmount: 1.1,
      }),
      makeParticipant({
        address: "CxrzwPcLNjuZjhLAiE9ciE7QcJrRDu3qHgCHpobthYEU",
        displayName: "Other",
        color: "#8b5cf6",
        usdcAmount: 0.87532,
      }),
    ];

    render(<ParticipantsList participants={participants} totalUsdc={1.97532} />);

    expect(screen.getByText("$1.10")).toBeInTheDocument();
    expect(screen.getByText("$0.88")).toBeInTheDocument();
    expect(screen.queryByText("$1")).not.toBeInTheDocument();
  });

  test("sorts by amount descending, shows one-decimal percentages, and marks current user", () => {
    walletPublicKey = {
      toBase58: () => "wallet-b",
    };

    const participants: Array<Participant> = [
      makeParticipant({
        address: "wallet-a",
        displayName: "Smaller",
        color: "#111111",
        usdcAmount: 0.88,
      }),
      makeParticipant({
        address: "wallet-b",
        displayName: "Larger",
        color: "#222222",
        usdcAmount: 1.1,
      }),
    ];

    const { container } = render(
      <ParticipantsList participants={participants} totalUsdc={1.98} />
    );

    const larger = screen.getByText("Larger");
    const smaller = screen.getByText("Smaller");
    const relation = larger.compareDocumentPosition(smaller);

    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("YOU")).toBeInTheDocument();
    expect(screen.getByText("55.6%")).toBeInTheDocument();
    expect(screen.getByText("44.4%")).toBeInTheDocument();

    // Sanity: both cards rendered.
    expect(container.querySelectorAll('[class*="rounded-xl"]').length).toBeGreaterThan(0);
  });
});

