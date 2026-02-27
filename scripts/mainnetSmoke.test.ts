// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  computeMinPotUsdc,
  evaluateMainnetSmokeChecks,
  findActiveRoundIdFromExisting,
  isAshRpcUrl,
  parseEnvFileMap,
  recentRoundIds,
  summarizeChecks,
} from "./lib/mainnetSmoke";

describe("scripts/lib/mainnetSmoke", () => {
  it("parses .env text into key/value map", () => {
    const env = parseEnvFileMap(`
# comment
RPC_URL=http://ash.rpc.gadflynode.com:80
RPC_WS_URL=ws://ash.rpc.gadflynode.com:80
EMPTY=
INVALID_LINE
    `);

    expect(env).toEqual({
      RPC_URL: "http://ash.rpc.gadflynode.com:80",
      RPC_WS_URL: "ws://ash.rpc.gadflynode.com:80",
      EMPTY: "",
    });
  });

  it("detects ash RPC URLs", () => {
    expect(isAshRpcUrl("http://ash.rpc.gadflynode.com:80")).toBe(true);
    expect(isAshRpcUrl("ws://ASH.rpc.gadflynode.com:80")).toBe(true);
    expect(isAshRpcUrl("https://mainnet.helius-rpc.com/?api-key=x")).toBe(false);
    expect(isAshRpcUrl(undefined)).toBe(false);
  });

  it("computes min pot in USDC from ticket unit and min tickets", () => {
    expect(computeMinPotUsdc(10_000n, 200n)).toBe(2);
    expect(computeMinPotUsdc(1_000_000n, 2n)).toBe(2);
    expect(computeMinPotUsdc(10_000n, 150n)).toBe(1.5);
  });

  it("evaluates checks with warns for ash RPC and treasury owner mismatch", () => {
    const checks = evaluateMainnetSmokeChecks({
      addresses: {
        programId: "P1",
        configPda: "C1",
        adminVault: "A1",
        treasuryUsdcAta: "T1",
        usdcMint: "M1",
        programData: "PD1",
        upgradeAuthorityVault: "U1",
      },
      code: {
        programId: "P1",
        configPda: "C1",
        adminPubkey: "A1",
        treasuryUsdcAta: "T1",
        usdcMint: "M1",
      },
      onchain: {
        programExecutable: true,
        programOwner: "BPFLoaderUpgradeab1e11111111111111111111111",
        programData: "PD1",
        upgradeAuthority: "U1",
        config: {
          admin: "A1",
          usdcMint: "M1",
          treasuryUsdcAta: "T1",
          feeBps: 25,
          ticketUnitRaw: 10_000n,
          roundDurationSec: 60,
          minParticipants: 2,
          minTotalTicketsRaw: 200n,
          paused: false,
        },
        treasuryAccount: {
          exists: true,
          owner: "TREASURY_OWNER_NOT_ADMIN",
          mint: "M1",
          amountUi: 0.123,
        },
        crankWallet: {
          pubkey: "CW1",
          sol: 0.2,
        },
      },
      env: {
        rootMainnet: {
          VITE_NETWORK: "mainnet",
          VITE_PROGRAM_ID: "P1",
          VITE_TREASURY_ATA: "T1",
          VITE_ADMIN_PUBKEY: "A1",
          VITE_USDC_MINT: "M1",
        },
        crankMainnet: {
          RPC_URL: "http://ash.rpc.gadflynode.com:80",
          RPC_WS_URL: "ws://ash.rpc.gadflynode.com:80",
        },
      },
    });

    const summary = summarizeChecks(checks);
    expect(summary.fail).toBe(0);
    expect(summary.warn).toBeGreaterThanOrEqual(2);

    expect(
      checks.find((c) => c.name === "Treasury token account owner matches config.admin (recommended)")
        ?.level
    ).toBe("warn");
    expect(
      checks.find((c) => c.name === "Crank .env.mainnet uses dedicated provider (not ash)")?.level
    ).toBe("warn");
  });

  it("fails mismatched core addresses", () => {
    const checks = evaluateMainnetSmokeChecks({
      addresses: {
        programId: "P1",
        configPda: "C1",
        adminVault: "A1",
        treasuryUsdcAta: "T1",
        usdcMint: "M1",
      },
      code: {
        programId: "P2",
        configPda: "C1",
        adminPubkey: "A1",
        treasuryUsdcAta: "T1",
        usdcMint: "M1",
      },
      onchain: {
        programExecutable: false,
        config: {
          admin: "A2",
          usdcMint: "M2",
          treasuryUsdcAta: "T2",
          feeBps: 25,
          ticketUnitRaw: 10_000n,
          roundDurationSec: 60,
          minParticipants: 2,
          minTotalTicketsRaw: 200n,
          paused: false,
        },
        treasuryAccount: { exists: false },
      },
    });

    const summary = summarizeChecks(checks);
    expect(summary.fail).toBeGreaterThanOrEqual(4);
  });

  it("finds active round and recent ids from existing rounds", () => {
    expect(
      findActiveRoundIdFromExisting([
        { id: 80, status: 5 },
        { id: 81, status: 5 },
        { id: 82, status: 0 },
        { id: 83, status: 5 },
      ])
    ).toBe(82);

    expect(findActiveRoundIdFromExisting([{ id: 80, status: 5 }])).toBeNull();

    expect(recentRoundIds([89, 80, 82, 81, 82, 90], 3)).toEqual([82, 89, 90]);
    expect(recentRoundIds([], 5)).toEqual([]);
  });
});

