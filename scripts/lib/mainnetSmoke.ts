export type EnvMap = Record<string, string>;

export type MainnetSmokeCheckLevel = "pass" | "fail" | "warn";

export interface MainnetSmokeCheck {
  name: string;
  level: MainnetSmokeCheckLevel;
  details?: unknown;
}

export interface MainnetSmokeInputs {
  addresses: {
    programId: string;
    configPda: string;
    adminVault: string;
    treasuryUsdcAta: string;
    usdcMint: string;
    upgradeAuthorityVault?: string;
    programData?: string;
  };
  code: {
    programId: string;
    configPda: string;
    adminPubkey: string;
    treasuryUsdcAta: string;
    usdcMint: string;
  };
  onchain: {
    programExecutable: boolean;
    programOwner?: string | null;
    programData?: string | null;
    upgradeAuthority?: string | null;
    config: {
      admin: string;
      usdcMint: string;
      treasuryUsdcAta: string;
      feeBps: number;
      ticketUnitRaw: bigint;
      roundDurationSec: number;
      minParticipants: number;
      minTotalTicketsRaw: bigint;
      paused: boolean;
    };
    treasuryAccount: {
      exists: boolean;
      owner?: string | null;
      mint?: string | null;
      amountUi?: number | null;
    };
    crankWallet?: {
      pubkey: string;
      sol: number;
    };
  };
  env?: {
    rootMainnet?: EnvMap;
    crankMainnet?: EnvMap;
  };
}

export function parseEnvFileMap(text: string): EnvMap {
  const out: EnvMap = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

export function uiUsdcFromRaw(raw: bigint | number): number {
  const n = typeof raw === "bigint" ? Number(raw) : raw;
  return n / 1_000_000;
}

export function computeMinPotUsdc(ticketUnitRaw: bigint, minTotalTicketsRaw: bigint): number {
  return uiUsdcFromRaw(ticketUnitRaw * minTotalTicketsRaw);
}

export function isAshRpcUrl(url?: string | null): boolean {
  if (!url) return false;
  return /ash\.rpc\.gadflynode\.com/i.test(url);
}

export function isPass(check: MainnetSmokeCheck): boolean {
  return check.level === "pass";
}

export function summarizeChecks(checks: MainnetSmokeCheck[]) {
  let pass = 0;
  let fail = 0;
  let warn = 0;
  for (const c of checks) {
    if (c.level === "pass") pass++;
    else if (c.level === "fail") fail++;
    else warn++;
  }
  return { pass, fail, warn, total: checks.length };
}

export function evaluateMainnetSmokeChecks(input: MainnetSmokeInputs): MainnetSmokeCheck[] {
  const checks: MainnetSmokeCheck[] = [];
  const { addresses, code, onchain, env } = input;
  const cfg = onchain.config;

  checks.push({
    name: "Program ID matches addresses.mainnet.json",
    level: code.programId === addresses.programId ? "pass" : "fail",
    details: { code: code.programId, addresses: addresses.programId },
  });

  checks.push({
    name: "Program account exists and executable",
    level: onchain.programExecutable ? "pass" : "fail",
    details: { executable: onchain.programExecutable, owner: onchain.programOwner ?? null },
  });

  checks.push({
    name: "Config PDA matches addresses.mainnet.json",
    level: code.configPda === addresses.configPda ? "pass" : "fail",
    details: { derived: code.configPda, addresses: addresses.configPda },
  });

  checks.push({
    name: "Config admin matches expected Ops vault",
    level:
      cfg.admin === addresses.adminVault && cfg.admin === code.adminPubkey ? "pass" : "fail",
    details: {
      onchain: cfg.admin,
      addresses: addresses.adminVault,
      crankConst: code.adminPubkey,
    },
  });

  checks.push({
    name: "Config treasury ATA matches expected",
    level:
      cfg.treasuryUsdcAta === addresses.treasuryUsdcAta &&
      cfg.treasuryUsdcAta === code.treasuryUsdcAta
        ? "pass"
        : "fail",
    details: {
      onchain: cfg.treasuryUsdcAta,
      addresses: addresses.treasuryUsdcAta,
      crankConst: code.treasuryUsdcAta,
    },
  });

  checks.push({
    name: "Config USDC mint matches mainnet USDC",
    level: cfg.usdcMint === addresses.usdcMint && cfg.usdcMint === code.usdcMint ? "pass" : "fail",
    details: {
      onchain: cfg.usdcMint,
      addresses: addresses.usdcMint,
      crankConst: code.usdcMint,
    },
  });

  checks.push({
    name: "Treasury token account exists with expected mint",
    level:
      onchain.treasuryAccount.exists && onchain.treasuryAccount.mint === cfg.usdcMint
        ? "pass"
        : "fail",
    details: onchain.treasuryAccount,
  });

  if (onchain.treasuryAccount.exists && onchain.treasuryAccount.owner) {
    const ownerMatchesAdmin = onchain.treasuryAccount.owner === cfg.admin;
    checks.push({
      name: "Treasury token account owner matches config.admin (recommended)",
      level: ownerMatchesAdmin ? "pass" : "warn",
      details: {
        treasuryOwner: onchain.treasuryAccount.owner,
        configAdmin: cfg.admin,
      },
    });
  }

  if (addresses.programData) {
    const level: MainnetSmokeCheckLevel =
      onchain.programData == null
        ? "warn"
        : onchain.programData === addresses.programData
          ? "pass"
          : "fail";
    checks.push({
      name: "ProgramData address matches rollout addresses",
      level,
      details: { onchain: onchain.programData, addresses: addresses.programData },
    });
  }

  if (addresses.upgradeAuthorityVault) {
    const level: MainnetSmokeCheckLevel =
      onchain.upgradeAuthority == null
        ? "warn"
        : onchain.upgradeAuthority === addresses.upgradeAuthorityVault
          ? "pass"
          : "fail";
    checks.push({
      name: "Program upgrade authority matches Upgrade vault",
      level,
      details: {
        onchain: onchain.upgradeAuthority,
        addresses: addresses.upgradeAuthorityVault,
      },
    });
  }

  if (env?.rootMainnet) {
    checks.push({
      name: "Frontend mainnet env points to expected program/treasury/admin",
      level:
        env.rootMainnet.VITE_NETWORK === "mainnet" &&
        env.rootMainnet.VITE_PROGRAM_ID === code.programId &&
        env.rootMainnet.VITE_TREASURY_ATA === cfg.treasuryUsdcAta &&
        env.rootMainnet.VITE_ADMIN_PUBKEY === cfg.admin &&
        env.rootMainnet.VITE_USDC_MINT === cfg.usdcMint
          ? "pass"
          : "fail",
      details: {
        VITE_NETWORK: env.rootMainnet.VITE_NETWORK,
        VITE_PROGRAM_ID: env.rootMainnet.VITE_PROGRAM_ID,
        VITE_TREASURY_ATA: env.rootMainnet.VITE_TREASURY_ATA,
        VITE_ADMIN_PUBKEY: env.rootMainnet.VITE_ADMIN_PUBKEY,
        VITE_USDC_MINT: env.rootMainnet.VITE_USDC_MINT,
      },
    });
  }

  if (env?.crankMainnet) {
    const rpcUrl = env.crankMainnet.RPC_URL;
    const wsUrl = env.crankMainnet.RPC_WS_URL;
    checks.push({
      name: "Crank .env.mainnet uses dedicated provider (not ash)",
      level: isAshRpcUrl(rpcUrl) || isAshRpcUrl(wsUrl) ? "warn" : "pass",
      details: { RPC_URL: rpcUrl, RPC_WS_URL: wsUrl },
    });
  }

  if (onchain.crankWallet) {
    checks.push({
      name: "Crank hot wallet balance > 0.05 SOL",
      level: onchain.crankWallet.sol > 0.05 ? "pass" : "warn",
      details: onchain.crankWallet,
    });
  }

  return checks;
}

export function findActiveRoundIdFromExisting(rounds: Array<{ id: number; status: number }>): number | null {
  let active: number | null = null;
  for (const r of rounds) {
    if (r.status >= 0 && r.status <= 3) {
      if (active == null || r.id > active) active = r.id;
    }
  }
  return active;
}

export function recentRoundIds(existingRoundIds: number[], count: number): number[] {
  if (existingRoundIds.length === 0 || count <= 0) return [];
  const sorted = [...new Set(existingRoundIds)].sort((a, b) => a - b);
  return sorted.slice(Math.max(0, sorted.length - count));
}
