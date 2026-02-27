/**
 * Jackpot Crank — constants & PDA helpers.
 * Mirror of src/lib/constants.ts + src/lib/program.ts PDA logic,
 * but without Vite/import.meta dependencies.
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// ─── Network config ───────────────────────────────────────
const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "devnet";

const configs = {
  devnet: {
    programId: "4PhNzNQ7XZAPrFmwcBFMe2ZY8ZaQWos8nJjcsjv1CHyh",
    usdcMint: "GXJV8YiRpXpbUHdf3q6n4hEKNeBPXK9Kn9uGjm6gZksq",
    treasuryUsdcAta: "HukbjaCBAJz5VmzkiDcpNjF2BUsxo8z9WwgSzHgGACMd",
    adminPubkey: "B4RSFCHfHGspoXRu4FnfYXM6s7GEYkQfsJeDm9ABMzjJ",
  },
  mainnet: {
    programId: process.env.PROGRAM_ID || "3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    treasuryUsdcAta: process.env.TREASURY_ATA || "8dccLsxnj9jwfEeokJrQH2wioJz4sS3mEQGd3miWB5YE",
    adminPubkey: process.env.ADMIN_PUBKEY || "D4DBCi5ASYf4EinyLJUsKbEzxYoNiAY9bY9aXeXh1ym",
  },
} as const;

const cfg = configs[NETWORK];

export const PROGRAM_ID = new PublicKey(cfg.programId);
export const USDC_MINT = new PublicKey(cfg.usdcMint);
export const TREASURY_USDC_ATA = new PublicKey(cfg.treasuryUsdcAta);
export const ADMIN_PUBKEY = new PublicKey(cfg.adminPubkey);
export const USDC_DECIMALS = 6;

// PDA seeds
export const SEED_CFG = Buffer.from("cfg");
export const SEED_ROUND = Buffer.from("round");
export const SEED_PARTICIPANT = Buffer.from("p");
export const SEED_DEGEN_CLAIM = Buffer.from("degen_claim");
export const SEED_DEGEN_CFG = Buffer.from("degen_cfg");

// Round status
export const RoundStatus = {
  Open: 0,
  Locked: 1,
  VrfRequested: 2,
  Settled: 3,
  Claimed: 4,
  Cancelled: 5,
} as const;

export const DegenClaimStatus = {
  VrfRequested: 1,
  VrfReady: 2,
  Executing: 3,
  ClaimedSwapped: 4,
  ClaimedFallback: 5,
} as const;

// VRF constants
export const VRF_PROGRAM_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const DEFAULT_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");

// ─── PDA helpers ──────────────────────────────────────────

export function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEED_CFG], PROGRAM_ID);
  return pda;
}

export function getRoundPda(roundId: number): PublicKey {
  const id = new BN(roundId);
  const [pda] = PublicKey.findProgramAddressSync(
    [SEED_ROUND, id.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
  return pda;
}

export function getParticipantPda(round: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEED_PARTICIPANT, round.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getDegenClaimPda(roundId: number, winner: PublicKey): PublicKey {
  const id = new BN(roundId);
  const [pda] = PublicKey.findProgramAddressSync(
    [SEED_DEGEN_CLAIM, id.toArrayLike(Buffer, "le", 8), winner.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getDegenConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEED_DEGEN_CFG], PROGRAM_ID);
  return pda;
}

export function getIdentityPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    PROGRAM_ID
  );
  return pda;
}
