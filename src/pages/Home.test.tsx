import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Home } from "./Home";

type WalletMock = {
  publicKey: { toBase58: () => string } | null;
  connected: boolean;
};

let walletMock: WalletMock = {
  publicKey: null,
  connected: false,
};

let jackpotContextMock: any;

function makeStub(name: string) {
  return function StubComponent() {
    return <div data-testid={name} />;
  };
}

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => walletMock,
}));

vi.mock("../contexts/JackpotContext", () => ({
  useJackpotContext: () => jackpotContextMock,
}));

vi.mock("../lib/program", () => ({
  getRoundPda: (roundId: number) => ({
    toBase58: () => `mock-round-pda-${roundId}`,
  }),
}));

vi.mock("lucide-react", () => {
  const Icon = () => <span aria-hidden="true" />;
  return {
    Trophy: Icon,
    XCircle: Icon,
    Shield: Icon,
    ExternalLink: Icon,
    Timer: Icon,
    RefreshCw: Icon,
    UserPlus: Icon,
    Sparkles: Icon,
    Activity: Icon,
    MessageSquare: Icon,
    Heart: Icon,
    UserPlus2: Icon,
    UserRoundPlus: Icon,
  };
});

vi.mock("../components/Header", () => ({ Header: makeStub("Header") }));
vi.mock("../components/JackpotWheel", () => ({
  JackpotWheel: ({
    onSpinComplete,
  }: {
    onSpinComplete?: () => void;
  }) => (
    <button
      type="button"
      data-testid="JackpotWheel"
      onClick={() => onSpinComplete?.()}
    >
      JackpotWheel
    </button>
  ),
}));
vi.mock("../components/DepositPanel", () => ({
  DepositPanel: makeStub("DepositPanel"),
}));
vi.mock("../components/ParticipantsList", () => ({
  ParticipantsList: makeStub("ParticipantsList"),
}));
vi.mock("../components/RoundInfo", () => ({
  RoundInfo: makeStub("RoundInfo"),
}));
vi.mock("../components/WinnerModal", () => ({
  WinnerModal: ({
    isOpen,
    onClose,
    winner,
  }: {
    isOpen: boolean;
    onClose: () => void;
    winner: { payout: number } | null;
  }) => (
    <div data-testid="WinnerModal" data-open={String(isOpen)}>
      <span>{isOpen ? "winner-modal-open" : "winner-modal-closed"}</span>
      {winner ? <span>{`winner-payout:${winner.payout.toFixed(2)}`}</span> : null}
      {isOpen ? (
        <button type="button" onClick={onClose}>
          Close Winner Modal
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("../components/MissionsPanel", () => ({
  MissionsPanel: makeStub("MissionsPanel"),
}));
vi.mock("../components/JupiterMobileBanner", () => ({
  JupiterMobileBanner: makeStub("JupiterMobileBanner"),
}));
vi.mock("../components/Chat", () => ({ Chat: makeStub("Chat") }));
vi.mock("../components/UnclaimedBadge", () => ({
  UnclaimedBadge: makeStub("UnclaimedBadge"),
}));
vi.mock("../components/RecentWinners", () => ({
  RecentWinners: makeStub("RecentWinners"),
}));
vi.mock("../components/social/SocialActivityCard", () => ({
  SocialActivityCard: makeStub("SocialActivityCard"),
}));
vi.mock("../components/AnimatedNumber", () => ({
  AnimatedNumber: ({ value, format }: { value: number; format?: (n: number) => string }) => (
    <span data-testid="AnimatedNumber">{format ? format(value) : String(value)}</span>
  ),
}));

vi.mock("../components/ui/Button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

function makeParticipant(address: string, usdcAmount: number) {
  return {
    address,
    displayName: address.slice(0, 4),
    color: "#00bcd4",
    usdcAmount,
    tickets: Math.floor(usdcAmount * 100),
    tokens: [{ symbol: "USDC", amount: usdcAmount, icon: "" }],
  };
}

function makeJackpotContext(overrides: Partial<any> = {}) {
  return {
    roundId: 82,
    phase: "open",
    timeLeft: 0,
    participants: [],
    totalUsdc: 1.1,
    totalTickets: 110,
    roundRandomnessHex: "11".repeat(32),
    winner: null,
    myUsdcBalance: 8.95,
    isAdmin: false,
    loading: false,
    error: null,
    autoStatus: null,
    unclaimedPrizes: [],
    deposit: vi.fn(async () => "sig-deposit"),
    depositMany: vi.fn(async () => "sig-deposit-many"),
    claim: vi.fn(async () => "sig-claim"),
    claimDegen: vi.fn(async () => ({
      claimSig: "sig-claim-degen",
      tokenMint: "mint",
      tokenIndex: 0,
      tokenSymbol: "MINT",
      fallback: false,
    })),
    claimUnclaimed: vi.fn(async () => "sig-claim-unclaimed"),
    cancelRound: vi.fn(async () => "sig-cancel"),
    claimRefund: vi.fn(async () => "sig-claim-refund"),
    nextRound: vi.fn(),
    setPauseAutoAdvance: vi.fn(),
    tokens: [],
    tokensLoading: false,
    refetchTokens: vi.fn(),
    missionsApi: {
      missions: [],
      level: 1,
      totalJup: 0,
      jupToNext: 100,
      streak: 0,
      claimableCount: 0,
      stats: {},
      trackDeposit: vi.fn(),
      trackRoundPlayed: vi.fn(),
      trackWin: vi.fn(),
      claimMission: vi.fn(),
    },
    ...overrides,
  };
}

describe("Home page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    walletMock = {
      publicKey: { toBase58: () => "wallet-abc" },
      connected: true,
    };
    jackpotContextMock = makeJackpotContext({
      participants: [makeParticipant("wallet-abc", 1.1)],
      totalUsdc: 1.1,
    });
  });

  test("shows Current Pot with cents (regression: 1.10 should not render as 1)", () => {
    render(<Home />);

    expect(screen.getByText("Current Pot")).toBeInTheDocument();
    expect(screen.getByText("1.10")).toBeInTheDocument();
    expect(screen.queryByText(/^1$/)).not.toBeInTheDocument();
  });

  test("shows Cancel & Refund card before countdown starts when user has deposit", () => {
    jackpotContextMock = makeJackpotContext({
      phase: "open",
      timeLeft: 0,
      participants: [makeParticipant("wallet-abc", 1.1)],
    });

    render(<Home />);

    expect(
      screen.getByText("Waiting for more players. You can cancel and get your USDC back.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cancel & refund/i })
    ).toBeInTheDocument();
  });

  test("hides Cancel & Refund card after countdown starts (open phase with timeLeft > 0)", () => {
    jackpotContextMock = makeJackpotContext({
      phase: "open",
      timeLeft: 45,
      participants: [makeParticipant("wallet-abc", 1.1), makeParticipant("wallet-other", 0.88)],
      totalUsdc: 1.98,
    });

    render(<Home />);

    expect(
      screen.queryByRole("button", { name: /cancel & refund/i })
    ).not.toBeInTheDocument();
  });

  test("hides Cancel & Refund card in countdown phase even if user has deposit", () => {
    jackpotContextMock = makeJackpotContext({
      phase: "countdown",
      timeLeft: 30,
      participants: [makeParticipant("wallet-abc", 1.1), makeParticipant("wallet-other", 1.1)],
      totalUsdc: 2.2,
    });

    render(<Home />);

    expect(
      screen.queryByRole("button", { name: /cancel & refund/i })
    ).not.toBeInTheDocument();
  });

  test("clicking Cancel & Refund calls cancelRound and shows success toast", async () => {
    const cancelRound = vi.fn(async () => "abcd1234zzzz");
    jackpotContextMock = makeJackpotContext({
      phase: "open",
      timeLeft: 0,
      participants: [makeParticipant("wallet-abc", 1.1)],
      cancelRound,
    });

    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /cancel & refund/i }));

    expect(cancelRound).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText(/Cancel ✓ abcd1234\.\.\./)).toBeInTheDocument();
    });
  });

  test("clicking Cancel & Refund shows error toast when cancelRound fails", async () => {
    const cancelRound = vi.fn(async () => {
      throw new Error("insufficient funds for fee");
    });
    jackpotContextMock = makeJackpotContext({
      phase: "open",
      timeLeft: 0,
      participants: [makeParticipant("wallet-abc", 1.1)],
      cancelRound,
    });

    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /cancel & refund/i }));

    expect(cancelRound).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText(/Error: insufficient funds for fee/)).toBeInTheDocument();
    });
  });

  test("winner can claim after spin completes in settled phase and sees correct payout", async () => {
    const claim = vi.fn(async () => "claim123456789");
    jackpotContextMock = makeJackpotContext({
      roundId: 99,
      phase: "settled",
      timeLeft: 0,
      totalUsdc: 2.2,
      participants: [makeParticipant("wallet-abc", 2.2)],
      winner: {
        address: "wallet-abc",
        displayName: "You",
        color: "#00bcd4",
      },
      claim,
    });

    render(<Home />);

    expect(screen.getByText("winner-modal-closed")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("JackpotWheel"));

    await waitFor(() => {
      expect(screen.getByText("winner-modal-open")).toBeInTheDocument();
    });

    expect(screen.getByText("winner-payout:2.19")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CLAIM \$2\.19/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /CLAIM \$2\.19/i }));

    expect(claim).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText(/Claim ✓ claim123\.\.\./)).toBeInTheDocument();
    });
  });

  test("closing winner modal in settled phase advances to next round", async () => {
    const nextRound = vi.fn();
    jackpotContextMock = makeJackpotContext({
      roundId: 100,
      phase: "settled",
      timeLeft: 0,
      totalUsdc: 1.1,
      participants: [makeParticipant("wallet-abc", 1.1)],
      winner: {
        address: "wallet-abc",
        displayName: "You",
        color: "#00bcd4",
      },
      nextRound,
    });

    render(<Home />);

    fireEvent.click(screen.getByTestId("JackpotWheel"));

    await waitFor(() => {
      expect(screen.getByText("winner-modal-open")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /close winner modal/i }));
    expect(nextRound).toHaveBeenCalledTimes(1);
  });
});
