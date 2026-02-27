use anchor_lang::prelude::*;
use crate::{constants::*, errors::ErrorCode, state::Config};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateConfigArgs {
    pub fee_bps: Option<u16>,
    pub ticket_unit: Option<u64>,
    pub round_duration_sec: Option<u32>,
    pub min_participants: Option<u16>,
    pub min_total_tickets: Option<u64>,
    pub paused: Option<bool>,
    /// Max USDC (raw) per user per round. 0 = unlimited.
    pub max_deposit_per_user: Option<u64>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_CFG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ ErrorCode::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    if let Some(v) = args.fee_bps {
        require!(v <= 10_000, ErrorCode::InvalidFeeBps);
        cfg.fee_bps = v;
    }
    if let Some(v) = args.ticket_unit {
        require!(v > 0, ErrorCode::InvalidTicketUnit);
        cfg.ticket_unit = v;
    }
    if let Some(v) = args.round_duration_sec {
        // [H-4 fix] Prevent zero-duration rounds (instant lock exploit)
        require!(v > 0, ErrorCode::InvalidRoundDuration);
        cfg.round_duration_sec = v;
    }
    if let Some(v) = args.min_participants {
        cfg.min_participants = v.max(1);
    }
    if let Some(v) = args.min_total_tickets {
        cfg.min_total_tickets = v.max(1);
    }
    if let Some(v) = args.paused {
        cfg.paused = v;
    }
    if let Some(v) = args.max_deposit_per_user {
        cfg.max_deposit_per_user = v;
    }

    Ok(())
}
