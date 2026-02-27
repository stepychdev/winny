use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    errors::ErrorCode,
    events::DegenFallbackClaimed,
    state::{Config, DegenClaim, DegenClaimStatus, Round, RoundStatus},
    utils::compute_claim_amounts,
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ClaimDegenFallback<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        mut,
        seeds = [SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), winner.key().as_ref()],
        bump = degen_claim.bump,
        constraint = degen_claim.round == round.key() @ ErrorCode::InvalidDegenClaim,
        constraint = degen_claim.winner == winner.key() @ ErrorCode::InvalidDegenClaim,
        constraint = degen_claim.round_id == round_id @ ErrorCode::InvalidDegenClaim,
    )]
    pub degen_claim: Box<Account<'info, DegenClaim>>,

    #[account(mut)]
    pub vault_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = winner_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidUserUsdcAta,
        constraint = winner_usdc_ata.owner == winner.key() @ ErrorCode::InvalidUserUsdcAta,
    )]
    pub winner_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = treasury_usdc_ata.key() == config.treasury_usdc_ata @ ErrorCode::InvalidTreasury,
        constraint = treasury_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidTreasury,
    )]
    pub treasury_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated manually if reimbursement is due.
    #[account(mut)]
    pub vrf_payer_authority: Option<UncheckedAccount<'info>>,

    /// CHECK: validated manually if reimbursement is due.
    #[account(mut)]
    pub vrf_payer_usdc_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<ClaimDegenFallback>,
    round_id: u64,
    fallback_reason: u8,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.degen_claim.status == DegenClaimStatus::VrfReady as u8,
        ErrorCode::InvalidDegenExecutionState
    );
    require!(
        now >= ctx.accounts.degen_claim.fallback_after_ts,
        ErrorCode::DegenFallbackTooEarly
    );

    let round_key = ctx.accounts.round.key();
    let usdc_mint = ctx.accounts.config.usdc_mint;
    let (amounts, round_bump, winner_bytes, reimburse_vrf) = {
        let round = ctx.accounts.round.load()?;

        require!(round.status == RoundStatus::Settled as u8, ErrorCode::RoundNotSettled);
        require!(ctx.accounts.winner.key().to_bytes() == round.winner, ErrorCode::OnlyWinnerCanClaim);
        require!(round.degen_mode_status() == DEGEN_MODE_VRF_READY, ErrorCode::DegenVrfNotReady);
        require!(ctx.accounts.vault_usdc_ata.key().to_bytes() == round.vault_usdc_ata, ErrorCode::InvalidVault);
        require!(ctx.accounts.vault_usdc_ata.mint == usdc_mint, ErrorCode::InvalidVault);
        require!(ctx.accounts.vault_usdc_ata.owner == round_key, ErrorCode::InvalidVault);

        let reimburse_vrf = Pubkey::new_from_array(round.vrf_payer) != Pubkey::default() && round.vrf_reimbursed == 0;
        let amounts = compute_claim_amounts(round.total_usdc, ctx.accounts.config.fee_bps, reimburse_vrf)?;
        (amounts, round.bump, round.winner, reimburse_vrf)
    };

    if reimburse_vrf {
        let vrf_payer_key = {
            let round = ctx.accounts.round.load()?;
            Pubkey::new_from_array(round.vrf_payer)
        };
        let vrf_payer_authority = ctx
            .accounts
            .vrf_payer_authority
            .as_ref()
            .ok_or(ErrorCode::InvalidVrfPayerAta)?;
        let vrf_payer_usdc_ata = ctx
            .accounts
            .vrf_payer_usdc_ata
            .as_ref()
            .ok_or(ErrorCode::InvalidVrfPayerAta)?;

        require_keys_eq!(vrf_payer_authority.key(), vrf_payer_key, ErrorCode::InvalidVrfPayerAta);
        require!(*vrf_payer_usdc_ata.owner == token::ID, ErrorCode::InvalidVrfPayerAta);
        let data = vrf_payer_usdc_ata.try_borrow_data().map_err(|_| ErrorCode::InvalidVrfPayerAta)?;
        require!(data.len() >= 72, ErrorCode::InvalidVrfPayerAta);
        let ata_mint = Pubkey::try_from(&data[0..32]).map_err(|_| ErrorCode::InvalidVrfPayerAta)?;
        let ata_owner = Pubkey::try_from(&data[32..64]).map_err(|_| ErrorCode::InvalidVrfPayerAta)?;
        require_keys_eq!(ata_mint, usdc_mint, ErrorCode::InvalidVrfPayerAta);
        require_keys_eq!(ata_owner, vrf_payer_key, ErrorCode::InvalidVrfPayerAta);
    }

    let signer_bump = [round_bump];
    let round_id_le = round_id.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[SEED_ROUND, &round_id_le, &signer_bump];

    if amounts.vrf_reimburse > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_usdc_ata.to_account_info(),
                    to: ctx.accounts
                        .vrf_payer_usdc_ata
                        .as_ref()
                        .ok_or(ErrorCode::InvalidVrfPayerAta)?
                        .to_account_info(),
                    authority: ctx.accounts.round.to_account_info(),
                },
                &[signer_seeds],
            ),
            amounts.vrf_reimburse,
        )?;
    }

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
        amounts.payout,
    )?;

    if amounts.fee > 0 {
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
            amounts.fee,
        )?;
    }

    {
        let mut round = ctx.accounts.round.load_mut()?;
        round.status = RoundStatus::Claimed as u8;
        round.set_degen_mode_status(DEGEN_MODE_CLAIMED);
        if amounts.vrf_reimburse > 0 {
            round.vrf_reimbursed = 1;
        }
    }

    let degen_claim = &mut ctx.accounts.degen_claim;
    degen_claim.status = DegenClaimStatus::ClaimedFallback as u8;
    degen_claim.claimed_at = now;
    degen_claim.fallback_reason = fallback_reason;
    degen_claim.selected_candidate_rank = u8::MAX;
    degen_claim.token_index = u32::MAX;
    degen_claim.token_mint = Pubkey::default();
    degen_claim.executor = Pubkey::default();
    degen_claim.receiver_token_ata = Pubkey::default();
    degen_claim.receiver_pre_balance = 0;
    degen_claim.min_out_raw = 0;
    degen_claim.route_hash = [0u8; 32];
    degen_claim.payout_raw = amounts.payout;

    emit!(DegenFallbackClaimed {
        round_id,
        winner: Pubkey::new_from_array(winner_bytes),
        payout: amounts.payout,
        fee: amounts.fee,
        fallback_reason,
    });

    Ok(())
}
