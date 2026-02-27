import fs from "fs";
import path from "path";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import { createProgram } from "../crank/src/instructions.ts";
import { parseParticipant, parseRound } from "../crank/src/parser.ts";
import {
  ADMIN_PUBKEY,
  getConfigPda,
  getParticipantPda,
  getRoundPda,
  PROGRAM_ID,
  RoundStatus,
  TREASURY_USDC_ATA,
  USDC_MINT,
} from "../crank/src/constants.ts";
import {
  computeMinPotUsdc,
  evaluateMainnetSmokeChecks,
  findActiveRoundIdFromExisting,
  parseEnvFileMap,
  recentRoundIds,
  summarizeChecks,
  uiUsdcFromRaw,
} from "./lib/mainnetSmoke.ts";

type AddressesMainnet = {
  mainnet: {
    program: {
      jackpot_program_id: string;
      program_data?: string;
      upgrade_authority_vault?: string;
    };
    protocol_config: {
      config_pda: string;
      admin_vault: string;
      treasury_usdc_token_account: string;
      usdc_mint: string;
    };
  };
};

type RoundSummary = {
  id: number;
  pda: string;
  status: number;
  statusName: string;
  startTs: number;
  endTs: number;
  firstDepositTs: number;
  totalUsdc: number;
  totalTickets: number;
  participantsCount: number;
  vaultAta: string;
  vaultUi: number | null;
  pendingParticipantRefunds?: number;
  participantAccountsExisting?: number;
};

function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function statusName(status: number): string {
  switch (status) {
    case RoundStatus.Open:
      return "Open";
    case RoundStatus.Locked:
      return "Locked";
    case RoundStatus.VrfRequested:
      return "VrfRequested";
    case RoundStatus.Settled:
      return "Settled";
    case RoundStatus.Claimed:
      return "Claimed";
    case RoundStatus.Cancelled:
      return "Cancelled";
    default:
      return `Unknown(${status})`;
  }
}

async function tokenMeta(connection: Connection, pubkey: PublicKey) {
  const parsed = await connection.getParsedAccountInfo(pubkey, "confirmed");
  const value = parsed.value as any;
  let owner: string | null = null;
  let mint: string | null = null;
  if (value?.data && "parsed" in value.data) {
    owner = value.data.parsed?.info?.owner ?? null;
    mint = value.data.parsed?.info?.mint ?? null;
  }

  let amountUi: number | null = null;
  try {
    const bal = await connection.getTokenAccountBalance(pubkey, "confirmed");
    amountUi = Number(bal.value.uiAmountString ?? bal.value.uiAmount ?? 0);
  } catch {
    amountUi = null;
  }

  return { exists: !!value, owner, mint, amountUi };
}

async function fetchAllRounds(connection: Connection): Promise<RoundSummary[]> {
  const programAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
  });

  const rounds: RoundSummary[] = [];
  for (const acc of programAccounts) {
    let round;
    try {
      round = parseRound(acc.account.data as Buffer);
    } catch {
      continue;
    }

    const roundIdBig = round.roundId;
    if (roundIdBig <= 0n || roundIdBig > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const roundId = Number(roundIdBig);
    if (!acc.pubkey.equals(getRoundPda(roundId))) continue;

    let vaultUi: number | null = null;
    try {
      const bal = await connection.getTokenAccountBalance(round.vaultUsdcAta, "confirmed");
      vaultUi = Number(bal.value.uiAmountString ?? bal.value.uiAmount ?? 0);
    } catch {
      vaultUi = null;
    }

    rounds.push({
      id: roundId,
      pda: acc.pubkey.toBase58(),
      status: round.status,
      statusName: statusName(round.status),
      startTs: Number(round.startTs),
      endTs: Number(round.endTs),
      firstDepositTs: Number(round.firstDepositTs),
      totalUsdc: uiUsdcFromRaw(round.totalUsdc),
      totalTickets: Number(round.totalTickets),
      participantsCount: round.participantsCount,
      vaultAta: round.vaultUsdcAta.toBase58(),
      vaultUi,
    });
  }

  rounds.sort((a, b) => a.id - b.id);
  return rounds;
}

async function enrichPendingRefunds(
  connection: Connection,
  roundId: number
): Promise<Pick<RoundSummary, "pendingParticipantRefunds" | "participantAccountsExisting">> {
  const info = await connection.getAccountInfo(getRoundPda(roundId), "confirmed");
  if (!info) return { pendingParticipantRefunds: 0, participantAccountsExisting: 0 };

  let round;
  try {
    round = parseRound(info.data as Buffer);
  } catch {
    return { pendingParticipantRefunds: 0, participantAccountsExisting: 0 };
  }

  if (
    round.participants.length === 0 ||
    (round.status !== RoundStatus.Cancelled && round.status !== RoundStatus.Claimed)
  ) {
    return { pendingParticipantRefunds: 0, participantAccountsExisting: 0 };
  }

  const roundPda = getRoundPda(roundId);
  const ppdas = round.participants.map((user) => getParticipantPda(roundPda, user));
  const pinfos = await connection.getMultipleAccountsInfo(ppdas, "confirmed");

  let participantAccountsExisting = 0;
  let pendingParticipantRefunds = 0;
  for (const pinfo of pinfos) {
    if (!pinfo) continue;
    participantAccountsExisting++;
    try {
      const p = parseParticipant(pinfo.data as Buffer);
      if (p.usdcTotal > 0n) pendingParticipantRefunds++;
    } catch {
      // ignore invalid participant payloads in smoke mode
    }
  }

  return { pendingParticipantRefunds, participantAccountsExisting };
}

async function main() {
  const repo = process.cwd();
  const envRootText = readTextIfExists(path.join(repo, ".env.mainnet")) ?? "";
  const envCrankText = readTextIfExists(path.join(repo, "crank/.env.mainnet")) ?? "";
  const rootEnv = parseEnvFileMap(envRootText);
  const crankEnv = parseEnvFileMap(envCrankText);

  const rpcUrl =
    process.env.RPC_URL ||
    rootEnv.VITE_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const addresses = JSON.parse(
    fs.readFileSync(path.join(repo, "addresses.mainnet.json"), "utf8")
  ) as AddressesMainnet;

  // Read-only fetches only. No signing is performed.
  const program = createProgram(connection, Keypair.generate());
  const configPda = getConfigPda();
  const configRaw: any = await (program.account as any).config.fetch(configPda);
  const ticketUnitRaw = BigInt(configRaw.ticketUnit.toString());
  const minTotalTicketsRaw = BigInt(configRaw.minTotalTickets.toString());

  const programInfo = await connection.getAccountInfo(PROGRAM_ID, "confirmed");
  const version = await connection.getVersion();
  const slot = await connection.getSlot("confirmed");
  const epoch = await connection.getEpochInfo("confirmed");
  const treasuryAccount = await tokenMeta(connection, new PublicKey(configRaw.treasuryUsdcAta));

  let crankWallet:
    | {
        pubkey: string;
        sol: number;
      }
    | undefined;
  const serviceWalletText = readTextIfExists(path.join(repo, "service-wallet.json"));
  if (serviceWalletText) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(serviceWalletText)));
    const bal = await connection.getBalance(kp.publicKey, "confirmed");
    crankWallet = { pubkey: kp.publicKey.toBase58(), sol: bal / 1e9 };
  }

  const allRounds = await fetchAllRounds(connection);
  const activeRoundId = findActiveRoundIdFromExisting(allRounds);
  const recentIds = recentRoundIds(allRounds.map((r) => r.id), Number(process.env.SMOKE_RECENT_ROUNDS || 10));
  const recentRounds = allRounds.filter((r) => recentIds.includes(r.id));

  // Only enrich terminal rounds to keep RPC load low.
  for (const round of recentRounds) {
    if (round.status === RoundStatus.Cancelled || round.status === RoundStatus.Claimed) {
      Object.assign(round, await enrichPendingRefunds(connection, round.id));
    }
  }

  const checks = evaluateMainnetSmokeChecks({
    addresses: {
      programId: addresses.mainnet.program.jackpot_program_id,
      configPda: addresses.mainnet.protocol_config.config_pda,
      adminVault: addresses.mainnet.protocol_config.admin_vault,
      treasuryUsdcAta: addresses.mainnet.protocol_config.treasury_usdc_token_account,
      usdcMint: addresses.mainnet.protocol_config.usdc_mint,
      programData: addresses.mainnet.program.program_data,
      upgradeAuthorityVault: addresses.mainnet.program.upgrade_authority_vault,
    },
    code: {
      programId: PROGRAM_ID.toBase58(),
      configPda: configPda.toBase58(),
      adminPubkey: ADMIN_PUBKEY.toBase58(),
      treasuryUsdcAta: TREASURY_USDC_ATA.toBase58(),
      usdcMint: USDC_MINT.toBase58(),
    },
    onchain: {
      programExecutable: !!programInfo?.executable,
      programOwner: programInfo?.owner?.toBase58() ?? null,
      config: {
        admin: configRaw.admin.toBase58(),
        usdcMint: configRaw.usdcMint.toBase58(),
        treasuryUsdcAta: configRaw.treasuryUsdcAta.toBase58(),
        feeBps: Number(configRaw.feeBps),
        ticketUnitRaw,
        roundDurationSec: Number(configRaw.roundDurationSec),
        minParticipants: Number(configRaw.minParticipants),
        minTotalTicketsRaw,
        paused: Boolean(configRaw.paused),
      },
      treasuryAccount,
      crankWallet,
    },
    env: {
      rootMainnet: rootEnv,
      crankMainnet: crankEnv,
    },
  });

  const output = {
    checkedAtUtc: new Date().toISOString(),
    rpcUrl,
    rpcVersion: version,
    slot,
    epoch: {
      epoch: epoch.epoch,
      slotIndex: epoch.slotIndex,
      slotsInEpoch: epoch.slotsInEpoch,
    },
    program: {
      programId: PROGRAM_ID.toBase58(),
      executable: !!programInfo?.executable,
      owner: programInfo?.owner?.toBase58() ?? null,
    },
    config: {
      pda: configPda.toBase58(),
      admin: configRaw.admin.toBase58(),
      usdcMint: configRaw.usdcMint.toBase58(),
      treasuryUsdcAta: configRaw.treasuryUsdcAta.toBase58(),
      feeBps: Number(configRaw.feeBps),
      ticketUnitRaw: ticketUnitRaw.toString(),
      ticketUnitUsdc: uiUsdcFromRaw(ticketUnitRaw),
      roundDurationSec: Number(configRaw.roundDurationSec),
      minParticipants: Number(configRaw.minParticipants),
      minTotalTicketsRaw: minTotalTicketsRaw.toString(),
      minPotUsdc: computeMinPotUsdc(ticketUnitRaw, minTotalTicketsRaw),
      paused: Boolean(configRaw.paused),
    },
    treasuryAccount,
    crankWallet: crankWallet ?? null,
    rounds: {
      totalExisting: allRounds.length,
      maxRoundId: allRounds.length > 0 ? allRounds[allRounds.length - 1].id : null,
      activeRoundId,
      recent: recentRounds,
    },
    checks,
    summary: summarizeChecks(checks),
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("mainnet_smoke_readonly failed:", err);
  process.exit(1);
});
