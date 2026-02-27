import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DepositPanel, normalizeDecimalInput } from "./DepositPanel";
import { USDC_MINT } from "../lib/constants";

vi.mock("../lib/jupiterClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/jupiterClient")>(
    "../lib/jupiterClient"
  );
  return {
    ...actual,
    getJupiterQuote: vi.fn(async (_inputMint: string, _outputMint: string, amount: string) => {
      // Deterministic fake quote: 1 input raw unit -> 2 output raw units (for test display only)
      const inRaw = BigInt(amount);
      const outRaw = inRaw * 2n;
      return {
        inputMint: "dummy",
        outputMint: "dummy-usdc",
        inAmount: inRaw.toString(),
        outAmount: outRaw.toString(),
        otherAmountThreshold: (outRaw - outRaw / 20n).toString(), // ~5% lower
        swapMode: "ExactIn",
        priceImpactPct: "0.01",
        routePlan: [
          {
            swapInfo: {
              ammKey: "amm",
              label: "TestAMM",
              inputMint: "in",
              outputMint: "out",
              inAmount: inRaw.toString(),
              outAmount: outRaw.toString(),
              feeAmount: "0",
              feeMint: "in",
            },
            percent: 100,
          },
        ],
        slippageBps: 100,
      };
    }),
  };
});

const TOKENS = [
  {
    mint: USDC_MINT.toBase58(),
    symbol: "USDC",
    name: "USD Coin",
    image: "",
    balance: 10,
    decimals: 6,
    usdValue: 10,
  },
  {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Solana",
    image: "",
    balance: 1,
    decimals: 9,
    usdValue: 150,
  },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof DepositPanel>> = {}) {
  const onDeposit = vi.fn();
  const onDepositMany = vi.fn();
  render(
    <DepositPanel
      disabled={false}
      loading={false}
      usdcBalance={10}
      tokens={TOKENS}
      tokensLoading={false}
      onDeposit={onDeposit}
      onDepositMany={onDepositMany}
      compact
      {...overrides}
    />
  );
  return { onDeposit, onDepositMany };
}

describe("DepositPanel batch UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not show batch controls when onDepositMany is absent", () => {
    renderPanel({ onDepositMany: undefined });
    expect(screen.queryByRole("button", { name: /add to batch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deposit batch/i })).not.toBeInTheDocument();
  });

  it("adds a USDC leg to batch and submits depositMany", () => {
    const { onDepositMany } = renderPanel();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "1.25" } });
    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));

    expect(screen.getByText(/Batch \(1\//)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deposit batch \(1\)/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /deposit batch \(1\)/i }));
    expect(onDepositMany).toHaveBeenCalledTimes(1);
    expect(onDepositMany).toHaveBeenCalledWith([
      expect.objectContaining({
        amount: 1.25,
        mint: USDC_MINT.toBase58(),
      }),
    ]);
  });

  it("normalizes comma decimal input", () => {
    expect(normalizeDecimalInput("5,2782")).toBe("5.2782");
    expect(normalizeDecimalInput("690,23")).toBe("690.23");
  });

  it("merges duplicate mint into existing batch leg (upsert)", () => {
    renderPanel();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));

    // Add same mint again -> button label changes to update, amount merges
    fireEvent.change(input, { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: /update batch leg/i }));

    expect(screen.getByText(/2 USDC/i)).toBeInTheDocument();
    expect(screen.getByText(/Batch \(1\//)).toBeInTheDocument();
  });

  it("loads a leg back into form when clicked (edit behavior)", () => {
    renderPanel();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "2.00" } });
    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));

    const row = screen.getByTitle("Edit this leg");
    fireEvent.click(row);

    expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("2");
    expect(screen.queryByText(/Batch \(1\//)).not.toBeInTheDocument();
  });

  it("fetches quote and adds non-USDC leg with quote", async () => {
    renderPanel();

    // open token dropdown and switch to SOL
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /SOL/i }));

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "0.1" } });

    await waitFor(() => {
      expect(screen.getByText(/Fetching best route/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add to batch/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));
    expect(screen.getByText(/0\.1 SOL/i)).toBeInTheDocument();
    expect(screen.getByText(/Batch \(1\//)).toBeInTheDocument();
  });

  it("blocks batch submit when form has an unsaved draft leg", async () => {
    renderPanel();

    // Add USDC leg first
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));
    expect(screen.getByRole("button", { name: /deposit batch \(1\)/i })).toBeEnabled();

    // Switch to SOL and type a new leg but do NOT add it to the batch
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /SOL/i }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "0.01" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add to batch/i })).toBeEnabled();
    });

    expect(screen.getByText(/Add the current SOL amount to batch first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deposit batch \(1\)/i })).toBeDisabled();
  });

  it("shows batch-full warning when a new draft token is entered and batch is full", async () => {
    const extendedTokens = [
      ...TOKENS,
      {
        mint: "PENGU11111111111111111111111111111111111111",
        symbol: "PENGU",
        name: "PENGU",
        image: "",
        balance: 1000,
        decimals: 6,
        usdValue: 50,
      },
      {
        mint: "BONK111111111111111111111111111111111111111",
        symbol: "BONK",
        name: "BONK",
        image: "",
        balance: 100000,
        decimals: 5,
        usdValue: 10,
      },
    ];
    renderPanel({ tokens: extendedTokens });

    // Add USDC
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));

    // Add SOL
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /SOL/i }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "0.01" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /add to batch/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));

    // Add PENGU (batch now 3/3)
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /PENGU/i }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /add to batch/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /add to batch/i }));
    expect(screen.getByText(/Batch \(3\//i)).toBeInTheDocument();

    // Switch to a new token and type a draft while batch is full
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /BONK/i }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "100" } });

    await waitFor(() => {
      expect(screen.getByText(/Batch is full \(3\/3\)\. Remove a leg or clear the current amount\./i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /deposit batch \(3\)/i })).toBeDisabled();
  });

  it("uses quick-fill MAX without rounding above token balance", async () => {
    renderPanel({
      tokens: [
        TOKENS[0],
        {
          ...TOKENS[1],
          balance: 690.2324,
        },
      ],
    });

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /SOL/i }));

    expect(screen.getByText(/690\.2324 SOL/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /MAX/i }));

    expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("690.2324");
  });

  it("shows explicit balance error when amount exceeds token balance", async () => {
    renderPanel({
      tokens: [
        TOKENS[0],
        {
          ...TOKENS[1],
          balance: 690.2324,
        },
      ],
    });

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /SOL/i }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "690.2325" } });

    await waitFor(() => {
      expect(screen.getByText(/Amount exceeds balance/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /deposit sol/i })).toBeDisabled();
  });
});
