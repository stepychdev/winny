use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{constants::*, errors::ErrorCode, events::RoundStarted, state::{Config, Round, RoundStatus}};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct StartRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = Round::SPACE,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = round,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<StartRound>, round_id: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, ErrorCode::Paused);

    let now = Clock::get()?.unix_timestamp;
    let round_key = ctx.accounts.round.key();
    let vault_key = ctx.accounts.vault_usdc_ata.key();

    let mut round = ctx.accounts.round.load_init()?;
    round.round_id = round_id;
    round.bump = ctx.bumps.round;
    round.start_ts = now;
    round.vault_usdc_ata = vault_key.to_bytes();
    // status=0 (Open), end_ts=0, first_deposit_ts=0, etc. — already zeroed by init

    emit!(RoundStarted {
        round_id,
        round: round_key,
        vault_usdc_ata: vault_key,
        start_ts: now,
    });

    Ok(())
}
