use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{
    constants::*,
    errors::ErrorCode,
    events::CancelRefund,
    state::{Config, Participant, Round, RoundStatus},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ClaimRefund<'info> {
    /// Participant self-service refund.
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
        constraint = participant.round == round.key() @ ErrorCode::ParticipantRoundMismatch,
    )]
    pub participant: Account<'info, Participant>,

    /// Vault USDC ATA owned by the round PDA.
    #[account(mut)]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    /// User's USDC ATA to receive the refund.
    #[account(
        mut,
        constraint = user_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidUserUsdcAta,
        constraint = user_usdc_ata.owner == user.key() @ ErrorCode::InvalidUserUsdcAta,
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// [H-2 fix] Participant self-refund for a force-cancelled round (escrow pattern).
pub fn handler(ctx: Context<ClaimRefund>, round_id: u64) -> Result<()> {
    let participant = &mut ctx.accounts.participant;
    let refund_amount = participant.usdc_total;

    require!(refund_amount > 0, ErrorCode::NoDepositToRefund);

    {
        let round = ctx.accounts.round.load()?;

        require!(
            round.status == RoundStatus::Cancelled as u8,
            ErrorCode::RoundNotCancellable
        );

        require!(
            ctx.accounts.vault_usdc_ata.key().to_bytes() == round.vault_usdc_ata,
            ErrorCode::InvalidVault
        );
        require!(
            ctx.accounts.vault_usdc_ata.owner == ctx.accounts.round.key(),
            ErrorCode::InvalidVault
        );
    }

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

    participant.usdc_total = 0;
    participant.tickets_total = 0;

    emit!(CancelRefund {
        round_id,
        user: ctx.accounts.user.key(),
        usdc_refunded: refund_amount,
    });

    Ok(())
}
