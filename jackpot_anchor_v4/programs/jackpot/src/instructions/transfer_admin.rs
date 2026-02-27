use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::ErrorCode,
    events::AdminTransferred,
    state::Config,
};

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_CFG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ ErrorCode::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(new_admin != Pubkey::default(), ErrorCode::InvalidAdmin);
    require!(new_admin != cfg.admin, ErrorCode::InvalidAdmin);

    let old_admin = cfg.admin;
    cfg.admin = new_admin;

    emit!(AdminTransferred {
        old_admin,
        new_admin,
    });

    Ok(())
}
