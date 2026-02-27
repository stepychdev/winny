use anchor_lang::prelude::*;

pub const MAX_PARTICIPANTS: usize = 200;
pub const BPS_DENOMINATOR: u64 = 10_000;

pub const SEED_CFG: &[u8] = b"cfg";
pub const SEED_ROUND: &[u8] = b"round";
pub const SEED_PARTICIPANT: &[u8] = b"p";
pub const SEED_DEGEN_CLAIM: &[u8] = b"degen_claim";
pub const SEED_DEGEN_CFG: &[u8] = b"degen_cfg";

/// Fixed USDC reimbursement for VRF payer (0.20 USDC = 200_000 raw, 6 decimals).
/// Deducted from pot during claim, sent to whoever paid for VRF.
pub const VRF_REIMBURSEMENT_USDC: u64 = 200_000;

pub const DEGEN_MODE_NONE: u8 = 0;
pub const DEGEN_MODE_VRF_REQUESTED: u8 = 1;
pub const DEGEN_MODE_VRF_READY: u8 = 2;
pub const DEGEN_MODE_EXECUTING: u8 = 3;
pub const DEGEN_MODE_CLAIMED: u8 = 4;
pub const DEGEN_CANDIDATE_WINDOW: u8 = 10;
pub const DEGEN_FALLBACK_REASON_NONE: u8 = 0;
pub const DEGEN_FALLBACK_REASON_NO_VIABLE_ROUTE: u8 = 1;
pub const DEGEN_FALLBACK_REASON_TIMEOUT: u8 = 2;
pub const DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC: u32 = 300;

#[cfg(feature = "devnet")]
pub const DEGEN_POOL_VERSION: u32 = 0;
#[cfg(feature = "devnet")]
pub const DEGEN_POOL_SNAPSHOT_SHA256: &str = "devnet-sol-only";
#[cfg(feature = "devnet")]
pub const DEGEN_POOL: [[u8; 32]; 1] = [[
    6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192, 53, 218, 196, 57, 220,
    26, 235, 59, 85, 152, 160, 240, 0, 0, 0, 0, 1,
]];

#[cfg(not(feature = "devnet"))]
include!("generated/degen_pool.rs");

pub fn degen_token_mint_by_index(index: u32) -> Option<Pubkey> {
    DEGEN_POOL
        .get(index as usize)
        .copied()
        .map(Pubkey::new_from_array)
}
