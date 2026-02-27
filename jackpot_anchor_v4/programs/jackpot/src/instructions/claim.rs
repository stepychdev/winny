use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{
    constants::*,
    errors::ErrorCode,
    events::Claimed,
    state::{Config, Round, RoundStatus},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    /// Vault USDC ATA owned by the round PDA — verified in handler.
    #[account(mut)]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = winner_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidUserUsdcAta,
        constraint = winner_usdc_ata.owner == winner.key() @ ErrorCode::InvalidUserUsdcAta,
    )]
    pub winner_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_usdc_ata.key() == config.treasury_usdc_ata @ ErrorCode::InvalidTreasury,
        constraint = treasury_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidTreasury,
    )]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,

    /// Optional: VRF payer's USDC ATA for reimbursement.
    /// CHECK: validated manually in handler against round.vrf_payer.
    #[account(mut)]
    pub vrf_payer_usdc_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Claim>, round_id: u64) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let round_key = ctx.accounts.round.key();
    let usdc_mint = cfg.usdc_mint;

    // Load round, extract values, then drop before CPI
    let (fee, payout, vrf_reimburse, round_bump, winner_bytes) = {
        let round = ctx.accounts.round.load()?;

        require!(round.status == RoundStatus::Settled as u8, ErrorCode::RoundNotSettled);
        require!(
            round.degen_mode_status() == DEGEN_MODE_NONE,
            ErrorCode::DegenClaimLocked
        );
        require!(
            ctx.accounts.winner.key().to_bytes() == round.winner,
            ErrorCode::OnlyWinnerCanClaim
        );

        // Verify vault
        require!(
            ctx.accounts.vault_usdc_ata.key().to_bytes() == round.vault_usdc_ata,
            ErrorCode::InvalidVault
        );
        require!(ctx.accounts.vault_usdc_ata.mint == usdc_mint, ErrorCode::InvalidVault);
        require!(ctx.accounts.vault_usdc_ata.owner == round_key, ErrorCode::InvalidVault);

        // Calculate VRF reimbursement (only if vrf_payer is set and not zero)
        let vrf_payer_key = Pubkey::new_from_array(round.vrf_payer);
        let has_vrf_payer = vrf_payer_key != Pubkey::default() && round.vrf_reimbursed == 0;

        let mut vrf_reimburse = if has_vrf_payer && ctx.accounts.vrf_payer_usdc_ata.is_some() {
            VRF_REIMBURSEMENT_USDC.min(round.total_usdc)
        } else {
            0u64
        };

        // Validate VRF payer ATA — skip reimbursement gracefully if ATA invalid/missing
        if vrf_reimburse > 0 {
            if let Some(ref vrf_ata) = ctx.accounts.vrf_payer_usdc_ata {
                let valid = *vrf_ata.owner == token::ID
                    && vrf_ata.try_borrow_data().map_or(false, |data| {
                        data.len() >= 72
                            && Pubkey::try_from(&data[0..32]).map_or(false, |m| m == usdc_mint)
                            && Pubkey::try_from(&data[32..64]).map_or(false, |o| o == vrf_payer_key)
                    });
                if !valid {
                    vrf_reimburse = 0;
                }
            }
        }

        let pot_after_reimburse = round.total_usdc.checked_sub(vrf_reimburse).ok_or(ErrorCode::MathOverflow)?;

        let fee = ((pot_after_reimburse as u128)
            .checked_mul(cfg.fee_bps as u128)
            .ok_or(ErrorCode::MathOverflow)?)
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(ErrorCode::MathOverflow)? as u64;
        let payout = pot_after_reimburse.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;

        (fee, payout, vrf_reimburse, round.bump, round.winner)
    };

    let round_id_le = round_id.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[SEED_ROUND, &round_id_le, &[round_bump]];

    // VRF payer reimbursement (from pot, before winner payout)
    if vrf_reimburse > 0 {
        if let Some(ref vrf_ata) = ctx.accounts.vrf_payer_usdc_ata {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault_usdc_ata.to_account_info(),
                        to: vrf_ata.to_account_info(),
                        authority: ctx.accounts.round.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                vrf_reimburse,
            )?;
        }
    }

    // Payout to winner
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_usdc_ata.to_account_info(),
                to: ctx.accounts.winner_usdc_ata.to_account_info(),
                authority: ctx.accounts.round.to_account_info(),
            },
            &[signer_seeds],
        ),
        payout,
    )?;

    // Fee to treasury
    if fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_usdc_ata.to_account_info(),
                    to: ctx.accounts.treasury_usdc_ata.to_account_info(),
                    authority: ctx.accounts.round.to_account_info(),
                },
                &[signer_seeds],
            ),
            fee,
        )?;
    }

    // Mark as claimed
    let mut round = ctx.accounts.round.load_mut()?;
    round.status = RoundStatus::Claimed as u8;
    if vrf_reimburse > 0 {
        round.vrf_reimbursed = 1;
    }

    emit!(Claimed {
        round_id,
        winner: Pubkey::new_from_array(winner_bytes),
        payout,
        fee,
    });

    Ok(())
}
