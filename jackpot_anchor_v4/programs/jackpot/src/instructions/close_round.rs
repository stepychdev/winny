use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, CloseAccount};
use crate::{
    constants::*,
    errors::ErrorCode,
    state::{Round, RoundStatus},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CloseRound<'info> {
    /// Anyone can call, but rent goes to `recipient`.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Where the recovered rent lamports go.
    /// CHECK: any account can receive lamports.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    /// Vault USDC ATA owned by the round PDA — must be empty.
    #[account(
        mut,
        constraint = vault_usdc_ata.amount == 0 @ ErrorCode::VaultNotEmpty,
        constraint = vault_usdc_ata.owner == round.key() @ ErrorCode::InvalidVault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CloseRound>, round_id: u64) -> Result<()> {
    // Verify round is in a terminal state
    {
        let round = ctx.accounts.round.load()?;
        require!(
            round.status == RoundStatus::Claimed as u8
                || round.status == RoundStatus::Cancelled as u8,
            ErrorCode::RoundNotCloseable
        );
    }

    // 1. Close the vault ATA (empty token account) → rent to recipient
    let round_id_le = round_id.to_le_bytes();
    let round_bump = ctx.accounts.round.load()?.bump;
    let signer_seeds: &[&[u8]] = &[SEED_ROUND, &round_id_le, &[round_bump]];

    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault_usdc_ata.to_account_info(),
            destination: ctx.accounts.recipient.to_account_info(),
            authority: ctx.accounts.round.to_account_info(),
        },
        &[signer_seeds],
    ))?;

    // 2. Close the round account (zero-copy — manual close)
    // Zero out discriminator to invalidate the account
    let round_info = ctx.accounts.round.to_account_info();
    let mut data = round_info.try_borrow_mut_data()?;
    // [M-5 fix] Zero ALL data to prevent stale reads within the same transaction
    data.fill(0);
    drop(data);

    // Transfer all lamports from round to recipient
    let round_lamports = round_info.lamports();
    **round_info.try_borrow_mut_lamports()? = 0;
    let recipient = &ctx.accounts.recipient;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(round_lamports)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(())
}
