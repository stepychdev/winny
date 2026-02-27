use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    constants::*,
    errors::ErrorCode,
    events::DegenExecutionFinalized,
    state::{DegenClaim, DegenClaimStatus, DegenConfig, Round, RoundStatus},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct FinalizeDegenSuccess<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(seeds = [SEED_DEGEN_CFG], bump = degen_config.bump)]
    pub degen_config: Box<Account<'info, DegenConfig>>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        mut,
        seeds = [SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), degen_claim.winner.as_ref()],
        bump = degen_claim.bump,
        constraint = degen_claim.round == round.key() @ ErrorCode::InvalidDegenClaim,
        constraint = degen_claim.round_id == round_id @ ErrorCode::InvalidDegenClaim,
    )]
    pub degen_claim: Box<Account<'info, DegenClaim>>,

    #[account(
        mut,
        constraint = executor_usdc_ata.owner == executor.key() @ ErrorCode::InvalidDegenExecutorAta,
    )]
    pub executor_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub receiver_token_ata: Box<Account<'info, TokenAccount>>,
}

pub fn handler(ctx: Context<FinalizeDegenSuccess>, round_id: u64) -> Result<()> {
    require!(
        ctx.accounts.degen_config.executor == ctx.accounts.executor.key(),
        ErrorCode::UnauthorizedDegenExecutor
    );
    require!(
        ctx.accounts.degen_claim.status == DegenClaimStatus::Executing as u8,
        ErrorCode::InvalidDegenExecutionState
    );

    let round_winner = {
        let round = ctx.accounts.round.load()?;
        require!(round.status == RoundStatus::Settled as u8, ErrorCode::RoundNotSettled);
        require!(
            round.degen_mode_status() == DEGEN_MODE_EXECUTING,
            ErrorCode::InvalidDegenExecutionState
        );
        Pubkey::new_from_array(round.winner)
    };

    require_keys_eq!(ctx.accounts.degen_claim.executor, ctx.accounts.executor.key(), ErrorCode::UnauthorizedDegenExecutor);
    require_keys_eq!(ctx.accounts.degen_claim.receiver_token_ata, ctx.accounts.receiver_token_ata.key(), ErrorCode::InvalidDegenReceiverAta);
    require_keys_eq!(ctx.accounts.receiver_token_ata.owner, round_winner, ErrorCode::InvalidDegenReceiverAta);
    require_keys_eq!(ctx.accounts.receiver_token_ata.mint, ctx.accounts.degen_claim.token_mint, ErrorCode::InvalidDegenReceiverAta);
    require!(
        ctx.accounts.receiver_token_ata.amount >= ctx.accounts.degen_claim.receiver_pre_balance.saturating_add(ctx.accounts.degen_claim.min_out_raw),
        ErrorCode::DegenOutputNotReceived
    );
    require!(ctx.accounts.executor_usdc_ata.amount == 0, ErrorCode::InvalidDegenExecutorAta);

    {
        let mut round = ctx.accounts.round.load_mut()?;
        round.status = RoundStatus::Claimed as u8;
        round.set_degen_mode_status(DEGEN_MODE_CLAIMED);
    }

    let degen_claim = &mut ctx.accounts.degen_claim;
    degen_claim.status = DegenClaimStatus::ClaimedSwapped as u8;
    degen_claim.claimed_at = Clock::get()?.unix_timestamp;

    emit!(DegenExecutionFinalized {
        round_id,
        winner: round_winner,
        executor: ctx.accounts.executor.key(),
        token_mint: degen_claim.token_mint,
        token_index: degen_claim.token_index,
        candidate_rank: degen_claim.selected_candidate_rank,
        min_out_raw: degen_claim.min_out_raw,
    });

    Ok(())
}
