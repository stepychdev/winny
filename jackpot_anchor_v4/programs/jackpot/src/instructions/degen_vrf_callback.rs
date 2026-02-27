use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;

use crate::{
    constants::*,
    errors::ErrorCode,
    events::DegenVrfFulfilled,
    state::{Config, DegenClaim, DegenClaimStatus, DegenConfig, Round, RoundStatus},
    utils::{checked_add_i64, compute_claim_amounts},
};

const VRF_PROGRAM_IDENTITY_BYTES: [u8; 32] =
    ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY.to_bytes();
const VRF_PROGRAM_IDENTITY: Pubkey = Pubkey::new_from_array(VRF_PROGRAM_IDENTITY_BYTES);

#[derive(Accounts)]
pub struct DegenVrfCallback<'info> {
    #[account(address = VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// No seeds constraint here: callback does not include round_id arg.
    #[account(mut)]
    pub round: AccountLoader<'info, Round>,

    #[account(mut)]
    pub degen_claim: Account<'info, DegenClaim>,

    /// CHECK: optional degen config PDA; may be uninitialized.
    #[account(seeds = [SEED_DEGEN_CFG], bump)]
    pub degen_config: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<DegenVrfCallback>, randomness: [u8; 32]) -> Result<()> {
    let round_key = ctx.accounts.round.key();

    let (round_id, winner_key, round_bump, total_usdc, reimburse_vrf) = {
        let round = ctx.accounts.round.load()?;
        (
            round.round_id,
            Pubkey::new_from_array(round.winner),
            round.bump,
            round.total_usdc,
            Pubkey::new_from_array(round.vrf_payer) != Pubkey::default() && round.vrf_reimbursed == 0,
        )
    };

    let expected_round_key = Pubkey::create_program_address(
        &[SEED_ROUND, &round_id.to_le_bytes(), &[round_bump]],
        &crate::ID,
    )
    .map_err(|_| ErrorCode::Unauthorized)?;
    require!(round_key == expected_round_key, ErrorCode::Unauthorized);

    let expected_degen_claim_key = Pubkey::create_program_address(
        &[
            SEED_DEGEN_CLAIM,
            &round_id.to_le_bytes(),
            winner_key.as_ref(),
            &[ctx.accounts.degen_claim.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| ErrorCode::InvalidDegenClaim)?;
    require!(
        ctx.accounts.degen_claim.key() == expected_degen_claim_key,
        ErrorCode::InvalidDegenClaim
    );
    require!(ctx.accounts.degen_claim.round == round_key, ErrorCode::InvalidDegenClaim);
    require!(ctx.accounts.degen_claim.round_id == round_id, ErrorCode::InvalidDegenClaim);
    require!(ctx.accounts.degen_claim.winner == winner_key, ErrorCode::InvalidDegenClaim);
    require!(
        ctx.accounts.degen_claim.status == DegenClaimStatus::VrfRequested as u8,
        ErrorCode::DegenVrfNotRequested
    );

    {
        let round = ctx.accounts.round.load()?;
        require!(round.status == RoundStatus::Settled as u8, ErrorCode::RoundNotSettled);
        require!(
            round.degen_mode_status() == DEGEN_MODE_VRF_REQUESTED,
            ErrorCode::DegenVrfNotRequested
        );
    }

    let now = Clock::get()?.unix_timestamp;
    let fallback_timeout_sec = if ctx.accounts.degen_config.data_is_empty() {
        DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC
    } else {
        let mut data: &[u8] = &ctx.accounts.degen_config.data.borrow();
        let degen_cfg =
            DegenConfig::try_deserialize(&mut data).map_err(|_| ErrorCode::Unauthorized)?;
        if degen_cfg.fallback_timeout_sec == 0 {
            DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC
        } else {
            degen_cfg.fallback_timeout_sec
        }
    };
    let fallback_after_ts = checked_add_i64(now, fallback_timeout_sec as i64)?;
    let amounts = compute_claim_amounts(total_usdc, ctx.accounts.config.fee_bps, reimburse_vrf)?;
    let degen_claim_key = ctx.accounts.degen_claim.key();
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
    degen_claim.fallback_after_ts = fallback_after_ts;
    degen_claim.payout_raw = amounts.payout;
    degen_claim.min_out_raw = 0;
    degen_claim.receiver_pre_balance = 0;
    degen_claim.executor = Pubkey::default();
    degen_claim.receiver_token_ata = Pubkey::default();
    degen_claim.route_hash = [0u8; 32];

    {
        let mut round = ctx.accounts.round.load_mut()?;
        round.set_degen_mode_status(DEGEN_MODE_VRF_READY);
    }

    emit!(DegenVrfFulfilled {
        round_id,
        winner: winner_key,
        degen_claim: degen_claim_key,
        pool_version: degen_claim.pool_version,
        candidate_window: degen_claim.candidate_window,
        payout_raw: degen_claim.payout_raw,
        fallback_after_ts,
    });

    Ok(())
}
