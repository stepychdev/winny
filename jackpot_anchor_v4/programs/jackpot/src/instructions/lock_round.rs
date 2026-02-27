use anchor_lang::prelude::*;
use crate::{constants::*, errors::ErrorCode, events::RoundLocked, state::{Config, Round, RoundStatus}};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct LockRound<'info> {
    pub caller: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,
}

pub fn handler(ctx: Context<LockRound>, _round_id: u64) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let mut round = ctx.accounts.round.load_mut()?;

    require!(round.status == RoundStatus::Open as u8, ErrorCode::RoundNotOpen);
    require!(round.first_deposit_ts != 0, ErrorCode::NoDepositsYet);
    require!(round.participants_count >= cfg.min_participants, ErrorCode::NotEnoughParticipants);
    require!(round.total_tickets >= cfg.min_total_tickets, ErrorCode::NotEnoughTickets);

    let now = Clock::get()?.unix_timestamp;
    require!(now >= round.end_ts, ErrorCode::RoundNotEnded);

    round.status = RoundStatus::Locked as u8;

    emit!(RoundLocked {
        round_id: round.round_id,
        total_usdc: round.total_usdc,
        total_tickets: round.total_tickets,
        participants_count: round.participants_count,
    });

    Ok(())
}
