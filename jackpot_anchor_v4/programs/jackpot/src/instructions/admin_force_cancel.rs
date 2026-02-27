use anchor_lang::prelude::*;
use crate::{
    constants::*,
    errors::ErrorCode,
    events::ForceCancel,
    state::{Config, Round, RoundStatus},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct AdminForceCancel<'info> {
    #[account(
        constraint = admin.key() == config.admin @ ErrorCode::Unauthorized
    )]
    pub admin: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,
}

/// [H-2 fix] Escrow pattern: funds stay in vault, participants claim via `claim_refund`.
/// [M-2 fix] Emits `ForceCancel` event for off-chain tracking.
pub fn handler(ctx: Context<AdminForceCancel>, round_id: u64) -> Result<()> {
    let mut round = ctx.accounts.round.load_mut()?;

    // [H-3 fix] Allow force-cancel on Open, Locked, or VrfRequested rounds
    require!(
        round.status == RoundStatus::Open as u8
            || round.status == RoundStatus::Locked as u8
            || round.status == RoundStatus::VrfRequested as u8,
        ErrorCode::RoundNotCancellable
    );

    let total = round.total_usdc;
    let count = round.participants_count;

    // Mark cancelled — funds remain in vault for participant self-refund
    round.status = RoundStatus::Cancelled as u8;

    emit!(ForceCancel {
        round_id,
        admin: ctx.accounts.admin.key(),
        total_usdc: total,
        participants_count: count,
    });

    Ok(())
}
