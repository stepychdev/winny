use anchor_lang::prelude::*;
use crate::{
    constants::*,
    errors::ErrorCode,
    events::RoundSettled,
    state::{Config, Round, RoundStatus},
    utils::bit_find_prefix,
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct MockSettle<'info> {
    /// Admin-only: test settlement without VRF oracle.
    #[account(constraint = admin.key() == config.admin @ ErrorCode::Unauthorized)]
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

pub fn handler(ctx: Context<MockSettle>, _round_id: u64, randomness: [u8; 32]) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let mut round = ctx.accounts.round.load_mut()?;

    require!(round.status == RoundStatus::Locked as u8, ErrorCode::RoundNotLocked);
    require!(round.participants_count >= cfg.min_participants, ErrorCode::NotEnoughParticipants);
    require!(round.total_tickets >= cfg.min_total_tickets, ErrorCode::NotEnoughTickets);

    round.randomness = randomness;

    let mut bytes16 = [0u8; 16];
    bytes16.copy_from_slice(&randomness[..16]);
    let r = u128::from_le_bytes(bytes16);
    let total_tickets_u128 = round.total_tickets as u128;
    let winning_ticket = (r % total_tickets_u128) as u64 + 1;

    let winner_idx = bit_find_prefix(&round.bit.data, winning_ticket)?;
    let winner_bytes = round.participants.data[winner_idx - 1];

    round.winning_ticket = winning_ticket;
    round.winner = winner_bytes;
    round.status = RoundStatus::Settled as u8;

    emit!(RoundSettled {
        round_id: round.round_id,
        winning_ticket,
        winner: Pubkey::new_from_array(winner_bytes),
        total_usdc: round.total_usdc,
        total_tickets: round.total_tickets,
    });

    Ok(())
}
