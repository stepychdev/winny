use anchor_lang::prelude::*;
use crate::{constants::*, errors::ErrorCode, state::Config};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitConfigArgs {
    pub usdc_mint: Pubkey,
    pub treasury_usdc_ata: Pubkey,
    pub fee_bps: u16,
    pub ticket_unit: u64,
    pub round_duration_sec: u32,
    pub min_participants: u16,
    pub min_total_tickets: u64,
    /// Max USDC (raw) a single user can deposit per round. 0 = unlimited.
    pub max_deposit_per_user: u64,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Config::SPACE,
        seeds = [SEED_CFG],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitConfig>, args: InitConfigArgs) -> Result<()> {
    require!(args.fee_bps <= 10_000, ErrorCode::InvalidFeeBps);
    require!(args.ticket_unit > 0, ErrorCode::InvalidTicketUnit);
    require!(args.round_duration_sec > 0, ErrorCode::InvalidTicketUnit);

    let cfg = &mut ctx.accounts.config;
    cfg.admin = ctx.accounts.admin.key();
    cfg.usdc_mint = args.usdc_mint;
    cfg.treasury_usdc_ata = args.treasury_usdc_ata;
    cfg.fee_bps = args.fee_bps;
    cfg.ticket_unit = args.ticket_unit;
    cfg.round_duration_sec = args.round_duration_sec;
    cfg.min_participants = args.min_participants.max(1);
    cfg.min_total_tickets = args.min_total_tickets.max(1);
    cfg.paused = false;
    cfg.bump = ctx.bumps.config;
    cfg.max_deposit_per_user = args.max_deposit_per_user;
    cfg.reserved = [0u8; 24];
    Ok(())
}
