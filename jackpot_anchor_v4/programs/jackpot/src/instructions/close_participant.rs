use anchor_lang::prelude::*;
use crate::{
    constants::*,
    errors::ErrorCode,
    state::{Participant, Round, RoundStatus},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CloseParticipant<'info> {
    /// Anyone can call (typically crank service).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The participant's wallet — receives the rent lamports.
    /// CHECK: validated against participant.user in handler.
    #[account(mut)]
    pub user: AccountInfo<'info>,

    #[account(
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        mut,
        seeds = [SEED_PARTICIPANT, round.key().as_ref(), user.key().as_ref()],
        bump = participant.bump,
        close = user,
    )]
    pub participant: Account<'info, Participant>,
}

pub fn handler(ctx: Context<CloseParticipant>, _round_id: u64) -> Result<()> {
    let round = ctx.accounts.round.load()?;

    // Only allow closing after round is in a terminal state
    require!(
        round.status == RoundStatus::Claimed as u8
            || round.status == RoundStatus::Cancelled as u8,
        ErrorCode::RoundNotCloseable
    );

    // Verify participant belongs to this round
    require!(
        ctx.accounts.participant.round == ctx.accounts.round.key(),
        ErrorCode::ParticipantRoundMismatch
    );

    // Verify user account matches participant's user
    require!(
        ctx.accounts.user.key() == ctx.accounts.participant.user,
        ErrorCode::Unauthorized
    );

    // In Cancelled state, do not allow closing before refund is actually claimed.
    if round.status == RoundStatus::Cancelled as u8 {
        require!(
            ctx.accounts.participant.usdc_total == 0
                && ctx.accounts.participant.tickets_total == 0,
            ErrorCode::ParticipantNotEmpty
        );
    }

    // Anchor's `close = user` handles the actual account closing + rent transfer

    Ok(())
}
