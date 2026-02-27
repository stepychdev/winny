use anchor_lang::prelude::*;

#[event]
pub struct RoundStarted {
    pub round_id: u64,
    pub round: Pubkey,
    pub vault_usdc_ata: Pubkey,
    pub start_ts: i64,
}

#[event]
pub struct DepositEvent {
    pub round_id: u64,
    pub user: Pubkey,
    pub delta_usdc: u64,
    pub tickets_added: u64,
    pub participant_index: u16,
    pub total_usdc_after: u64,
    pub total_tickets_after: u64,
}

#[event]
pub struct RoundLocked {
    pub round_id: u64,
    pub total_usdc: u64,
    pub total_tickets: u64,
    pub participants_count: u16,
}

#[event]
pub struct VrfRequested {
    pub round_id: u64,
}

#[event]
pub struct RoundSettled {
    pub round_id: u64,
    pub winning_ticket: u64,
    pub winner: Pubkey,
    pub total_usdc: u64,
    pub total_tickets: u64,
}

#[event]
pub struct Claimed {
    pub round_id: u64,
    pub winner: Pubkey,
    pub payout: u64,
    pub fee: u64,
}

#[event]
pub struct DegenVrfRequested {
    pub round_id: u64,
    pub winner: Pubkey,
    pub degen_claim: Pubkey,
}

#[event]
pub struct DegenVrfFulfilled {
    pub round_id: u64,
    pub winner: Pubkey,
    pub degen_claim: Pubkey,
    pub pool_version: u32,
    pub candidate_window: u8,
    pub payout_raw: u64,
    pub fallback_after_ts: i64,
}

#[event]
pub struct DegenClaimed {
    pub round_id: u64,
    pub winner: Pubkey,
    pub payout: u64,
    pub fee: u64,
    pub candidate_rank: u8,
    pub token_mint: Pubkey,
    pub token_index: u32,
}

#[event]
pub struct DegenExecutionStarted {
    pub round_id: u64,
    pub winner: Pubkey,
    pub executor: Pubkey,
    pub payout_raw: u64,
    pub min_out_raw: u64,
    pub candidate_rank: u8,
    pub token_mint: Pubkey,
    pub token_index: u32,
}

#[event]
pub struct DegenExecutionFinalized {
    pub round_id: u64,
    pub winner: Pubkey,
    pub executor: Pubkey,
    pub token_mint: Pubkey,
    pub token_index: u32,
    pub candidate_rank: u8,
    pub min_out_raw: u64,
}

#[event]
pub struct DegenFallbackClaimed {
    pub round_id: u64,
    pub winner: Pubkey,
    pub payout: u64,
    pub fee: u64,
    pub fallback_reason: u8,
}

#[event]
pub struct CancelRefund {
    pub round_id: u64,
    pub user: Pubkey,
    pub usdc_refunded: u64,
}

#[event]
pub struct ForceCancel {
    pub round_id: u64,
    pub admin: Pubkey,
    pub total_usdc: u64,
    pub participants_count: u16,
}

#[event]
pub struct AdminTransferred {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct TreasuryUpdated {
    pub old_treasury: Pubkey,
    pub new_treasury: Pubkey,
    pub owner: Pubkey,
}
