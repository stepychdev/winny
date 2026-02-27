import { PublicKey } from "@solana/web3.js";

// ─── Network toggle ─────────────────────────────────────────
// Set VITE_NETWORK=mainnet in .env to switch; defaults to devnet
const rawNetwork = (import.meta.env.VITE_NETWORK as string | undefined)?.trim().toLowerCase();
const envProgramId = (import.meta.env.VITE_PROGRAM_ID as string | undefined)?.trim();
const envTreasuryAta = (import.meta.env.VITE_TREASURY_ATA as string | undefined)?.trim();
const envAdminPubkey = (import.meta.env.VITE_ADMIN_PUBKEY as string | undefined)?.trim();
const rawEnableMultiDeposit = (import.meta.env.VITE_ENABLE_MULTI_DEPOSIT as string | undefined)?.trim().toLowerCase();
const rawEnableTapestrySocial = (import.meta.env.VITE_ENABLE_TAPESTRY_SOCIAL as string | undefined)?.trim().toLowerCase();
export const NETWORK: "devnet" | "mainnet" =
  rawNetwork === "mainnet" ? "mainnet" : "devnet";

export const IS_MAINNET = NETWORK === "mainnet";
export const SOLSCAN_CLUSTER_QUERY = IS_MAINNET ? "" : "?cluster=devnet";

// ─── Per-network config ─────────────────────────────────────
const configs = {
  devnet: {
    programId: "4PhNzNQ7XZAPrFmwcBFMe2ZY8ZaQWos8nJjcsjv1CHyh",
    usdcMint: "GXJV8YiRpXpbUHdf3q6n4hEKNeBPXK9Kn9uGjm6gZksq",
    treasuryUsdcAta: "HukbjaCBAJz5VmzkiDcpNjF2BUsxo8z9WwgSzHgGACMd",
    adminPubkey: "B4RSFCHfHGspoXRu4FnfYXM6s7GEYkQfsJeDm9ABMzjJ",
    feeBps: 25,        // 0.25%
    roundDurationSec: 10,
    minParticipants: 2,
    minTotalTickets: 2,
  },
  mainnet: {
    programId: envProgramId || "3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // real mainnet USDC
    treasuryUsdcAta: envTreasuryAta || "8dccLsxnj9jwfEeokJrQH2wioJz4sS3mEQGd3miWB5YE",
    adminPubkey: envAdminPubkey || "D4DBCi5ASYf4EinyLJUsKbEzxYoNiAY9bY9aXeXh1ym",
    feeBps: 25,        // 0.25%
    roundDurationSec: 60,       // 1 minute on mainnet
    minParticipants: 2,
    minTotalTickets: 2,
  },
} as const;

const cfg = configs[NETWORK];

export const PROGRAM_ID = new PublicKey(cfg.programId);
export const USDC_MINT = new PublicKey(cfg.usdcMint);
export const TREASURY_USDC_ATA = new PublicKey(cfg.treasuryUsdcAta);
export const ADMIN_PUBKEY = new PublicKey(cfg.adminPubkey);
export const FEE_BPS = cfg.feeBps;
export const TICKET_UNIT = 10_000; // 0.01 USDC = 1 ticket (6 decimals)
export const MIN_DEPOSIT_USDC = 1; // Minimum deposit in USDC (prevents rounds failing with NotEnoughTickets)
export const ROUND_DURATION_SEC = cfg.roundDurationSec;
export const MIN_PARTICIPANTS = cfg.minParticipants;
export const MIN_TOTAL_TICKETS = cfg.minTotalTickets;
export const ENABLE_MULTI_DEPOSIT =
  rawEnableMultiDeposit === "0" || rawEnableMultiDeposit === "false"
    ? false
    : true;
export const ENABLE_TAPESTRY_SOCIAL =
  rawEnableTapestrySocial === "1" || rawEnableTapestrySocial === "true";
// Soft-launch cap for multi-token batch deposits.
export const MAX_MULTI_DEPOSIT_LEGS = 3;

// PDA seeds
export const SEED_CFG = Buffer.from("cfg");
export const SEED_ROUND = Buffer.from("round");
export const SEED_PARTICIPANT = Buffer.from("p");
export const SEED_DEGEN_CLAIM = Buffer.from("degen_claim");
export const SEED_DEGEN_CFG = Buffer.from("degen_cfg");

export const USDC_DECIMALS = 6;
export const VRF_REIMBURSEMENT_USDC_RAW = 200_000;
// Delay before showing winner-side notifications/badges after settle.
// Keeps UX aligned with wheel landing animation.
export const WHEEL_RESULT_REVEAL_DELAY_MS = 5500;

// Round status enum
export const RoundStatus = {
  Open: 0,
  Locked: 1,
  VrfRequested: 2,
  Settled: 3,
  Claimed: 4,
  Cancelled: 5,
} as const;

export type RoundStatusType = (typeof RoundStatus)[keyof typeof RoundStatus];

export const DegenModeStatus = {
  None: 0,
  VrfRequested: 1,
  VrfReady: 2,
  Executing: 3,
  ClaimedSwapped: 4,
  ClaimedFallback: 5,
} as const;

export type DegenModeStatusType =
  (typeof DegenModeStatus)[keyof typeof DegenModeStatus];

export const DEGEN_FALLBACK_REASON_NO_VIABLE_ROUTE = 1;
export const DEGEN_FALLBACK_REASON_TIMEOUT = 2;
