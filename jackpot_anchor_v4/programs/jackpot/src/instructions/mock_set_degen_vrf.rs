use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::ErrorCode,
    state::{Config, DegenClaim, DegenClaimStatus, Round, RoundStatus},
    utils::{checked_add_i64, compute_claim_amounts},
};

/// Devnet-only helper:
/// Simulates the degen VRF callback by directly writing randomness/token selection.
#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct MockSetDegenVrf<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_CFG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ ErrorCode::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        mut,
        seeds = [SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), winner.key().as_ref()],
        bump = degen_claim.bump,
        constraint = degen_claim.round == round.key() @ ErrorCode::InvalidDegenClaim,
        constraint = degen_claim.winner == winner.key() @ ErrorCode::InvalidDegenClaim,
        constraint = degen_claim.round_id == round_id @ ErrorCode::InvalidDegenClaim,
    )]
    pub degen_claim: Account<'info, DegenClaim>,

    /// CHECK: validated against round winner in handler
    pub winner: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<MockSetDegenVrf>, _round_id: u64, randomness: [u8; 32]) -> Result<()> {
    let winner_key = ctx.accounts.winner.key();
    let now = Clock::get()?.unix_timestamp;

    let payout_raw = {
        let round = ctx.accounts.round.load()?;
        require!(round.status == RoundStatus::Settled as u8, ErrorCode::RoundNotSettled);
        require!(Pubkey::new_from_array(round.winner) == winner_key, ErrorCode::OnlyWinnerCanClaim);
        require!(
            round.degen_mode_status() == DEGEN_MODE_VRF_REQUESTED,
            ErrorCode::DegenVrfNotRequested
        );
        let reimburse_vrf =
            Pubkey::new_from_array(round.vrf_payer) != Pubkey::default() && round.vrf_reimbursed == 0;
        compute_claim_amounts(round.total_usdc, ctx.accounts.config.fee_bps, reimburse_vrf)?.payout
    };
    require!(
        ctx.accounts.degen_claim.status == DegenClaimStatus::VrfRequested as u8,
        ErrorCode::DegenVrfNotRequested
    );

    {
        let mut round = ctx.accounts.round.load_mut()?;
        round.set_degen_mode_status(DEGEN_MODE_VRF_READY);
    }

    let degen_claim = &mut ctx.accounts.degen_claim;
    degen_claim.status = DegenClaimStatus::VrfReady as u8;
    degen_claim.randomness = randomness;
    degen_claim.selected_candidate_rank = u8::MAX;
    degen_claim.fallback_reason = DEGEN_FALLBACK_REASON_NONE;
    degen_claim.token_index = 0;
    degen_claim.pool_version = DEGEN_POOL_VERSION;
    degen_claim.candidate_window = DEGEN_CANDIDATE_WINDOW;
    degen_claim._padding0 = [0u8; 7];
    degen_claim.token_mint = Pubkey::default();
    degen_claim.fulfilled_at = now;
    degen_claim.fallback_after_ts = checked_add_i64(now, DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC as i64)?;
    degen_claim.payout_raw = payout_raw;
    degen_claim.min_out_raw = 0;
    degen_claim.receiver_pre_balance = 0;
    degen_claim.executor = Pubkey::default();
    degen_claim.receiver_token_ata = Pubkey::default();
    degen_claim.route_hash = [0u8; 32];

    Ok(())
}
