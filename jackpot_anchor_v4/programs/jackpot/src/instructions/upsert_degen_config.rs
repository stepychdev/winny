use anchor_lang::prelude::*;

use crate::{
    constants::{DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC, SEED_CFG, SEED_DEGEN_CFG},
    errors::ErrorCode,
    state::{Config, DegenConfig},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct UpsertDegenConfigArgs {
    pub executor: Pubkey,
    pub fallback_timeout_sec: u32,
}

#[derive(Accounts)]
pub struct UpsertDegenConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = admin,
        space = DegenConfig::SPACE,
        seeds = [SEED_DEGEN_CFG],
        bump,
    )]
    pub degen_config: Account<'info, DegenConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UpsertDegenConfig>, args: UpsertDegenConfigArgs) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, ErrorCode::Unauthorized);
    require!(args.executor != Pubkey::default(), ErrorCode::UnauthorizedDegenExecutor);

    let timeout = if args.fallback_timeout_sec == 0 {
        DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC
    } else {
        args.fallback_timeout_sec
    };

    let degen_config = &mut ctx.accounts.degen_config;
    degen_config.executor = args.executor;
    degen_config.fallback_timeout_sec = timeout;
    degen_config.bump = ctx.bumps.degen_config;

    Ok(())
}
