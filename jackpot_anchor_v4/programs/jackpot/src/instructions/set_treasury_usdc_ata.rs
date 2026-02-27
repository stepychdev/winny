use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    constants::*,
    errors::ErrorCode,
    events::TreasuryUpdated,
    state::Config,
};

#[derive(Accounts)]
pub struct SetTreasuryUsdcAta<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_CFG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ ErrorCode::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    #[account(
        constraint = new_treasury_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidTreasury,
    )]
    pub new_treasury_usdc_ata: Account<'info, TokenAccount>,

    /// CHECK: expected owner of treasury ATA (e.g. Squads vault PDA)
    pub expected_owner: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SetTreasuryUsdcAta>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        ctx.accounts.new_treasury_usdc_ata.owner == ctx.accounts.expected_owner.key(),
        ErrorCode::InvalidTreasury
    );

    let old_treasury = cfg.treasury_usdc_ata;
    let new_treasury = ctx.accounts.new_treasury_usdc_ata.key();

    require!(old_treasury != new_treasury, ErrorCode::InvalidTreasury);

    cfg.treasury_usdc_ata = new_treasury;

    emit!(TreasuryUpdated {
        old_treasury,
        new_treasury,
        owner: ctx.accounts.expected_owner.key(),
    });

    Ok(())
}
