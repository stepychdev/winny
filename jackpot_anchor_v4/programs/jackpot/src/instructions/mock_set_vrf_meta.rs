use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::ErrorCode,
    state::{Config, Round},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct MockSetVrfMeta<'info> {
    /// Admin-only test helper (devnet feature only).
    #[account(constraint = admin.key() == config.admin @ ErrorCode::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,
}

pub fn handler(
    ctx: Context<MockSetVrfMeta>,
    _round_id: u64,
    vrf_payer: Pubkey,
    vrf_reimbursed: bool,
) -> Result<()> {
    let mut round = ctx.accounts.round.load_mut()?;
    round.vrf_payer = vrf_payer.to_bytes();
    round.vrf_reimbursed = if vrf_reimbursed { 1 } else { 0 };
    Ok(())
}
