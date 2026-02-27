use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{
    constants::*,
    errors::ErrorCode,
    events::CancelRefund,
    state::{Config, Participant, Round, RoundStatus},
    utils::bit_sub,
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CancelRound<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        mut,
        seeds = [SEED_PARTICIPANT, round.key().as_ref(), user.key().as_ref()],
        bump = participant.bump,
        constraint = participant.user == user.key() @ ErrorCode::Unauthorized,
        constraint = participant.round == round.key() @ ErrorCode::Unauthorized,
    )]
    pub participant: Account<'info, Participant>,

    /// Vault USDC ATA owned by the round PDA.
    #[account(mut)]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidUserUsdcAta,
        constraint = user_usdc_ata.owner == user.key() @ ErrorCode::InvalidUserUsdcAta,
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CancelRound>, round_id: u64) -> Result<()> {
    let participant = &mut ctx.accounts.participant;

    // Can only cancel/refund if participant has a deposit
    require!(participant.usdc_total > 0, ErrorCode::NoDepositToRefund);
    // Prevent double refund (we'll zero out usdc_total after refund)
    let refund_amount = participant.usdc_total;

    {
        let round = ctx.accounts.round.load()?;

        // Can only cancel if round is still Open (not locked/settled/claimed)
        require!(round.status == RoundStatus::Open as u8, ErrorCode::RoundNotCancellable);

        // RACE-CONDITION FIX: only allow cancel if this user is the sole depositor.
        // If total_usdc > refund_amount, someone else has deposited — block the cancel.
        require!(round.total_usdc == refund_amount, ErrorCode::CancelNotAllowed);

        // Verify vault
        require!(
            ctx.accounts.vault_usdc_ata.key().to_bytes() == round.vault_usdc_ata,
            ErrorCode::InvalidVault
        );
        require!(
            ctx.accounts.vault_usdc_ata.owner == ctx.accounts.round.key(),
            ErrorCode::InvalidVault
        );
    }

    // Transfer USDC from vault back to user (PDA signer)
    let round_id_le = round_id.to_le_bytes();
    let round_bump = ctx.accounts.round.load()?.bump;
    let signer_seeds: &[&[u8]] = &[SEED_ROUND, &round_id_le, &[round_bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_usdc_ata.to_account_info(),
                to: ctx.accounts.user_usdc_ata.to_account_info(),
                authority: ctx.accounts.round.to_account_info(),
            },
            &[signer_seeds],
        ),
        refund_amount,
    )?;

    // Update round totals
    let cancelled_tickets = participant.tickets_total;
    let mut round = ctx.accounts.round.load_mut()?;

    // [C-1 fix] Subtract cancelled tickets from Fenwick tree so winner selection stays correct
    bit_sub(&mut round.bit.data, participant.index as usize, cancelled_tickets)?;

    // [H-1 fix] Use checked_sub — revert on underflow instead of silently clamping to 0
    round.total_usdc = round.total_usdc.checked_sub(refund_amount).ok_or(ErrorCode::MathOverflow)?;
    round.total_tickets = round.total_tickets.checked_sub(cancelled_tickets).ok_or(ErrorCode::MathOverflow)?;

    // Zero out participant (mark as refunded)
    participant.usdc_total = 0;
    participant.tickets_total = 0;

    // If all participants have been refunded, mark round as cancelled
    if round.total_usdc == 0 {
        round.status = RoundStatus::Cancelled as u8;
    }

    emit!(CancelRefund {
        round_id,
        user: ctx.accounts.user.key(),
        usdc_refunded: refund_amount,
    });

    Ok(())
}
