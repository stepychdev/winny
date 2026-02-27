use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    errors::ErrorCode,
    events::DegenExecutionStarted,
    state::{Config, DegenClaim, DegenClaimStatus, DegenConfig, Round, RoundStatus},
    utils::{compute_claim_amounts, derive_degen_candidate_index_at_rank},
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct BeginDegenExecution<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [SEED_DEGEN_CFG], bump = degen_config.bump)]
    pub degen_config: Box<Account<'info, DegenConfig>>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        mut,
        seeds = [SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), degen_claim.winner.as_ref()],
        bump = degen_claim.bump,
        constraint = degen_claim.round == round.key() @ ErrorCode::InvalidDegenClaim,
        constraint = degen_claim.round_id == round_id @ ErrorCode::InvalidDegenClaim,
    )]
    pub degen_claim: Box<Account<'info, DegenClaim>>,

    #[account(mut)]
    pub vault_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = executor_usdc_ata.owner == executor.key() @ ErrorCode::InvalidDegenExecutorAta,
        constraint = executor_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidDegenExecutorAta,
    )]
    pub executor_usdc_ata: Box<Account<'info, TokenAccount>>,

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

    pub selected_token_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = receiver_token_ata.owner == degen_claim.winner @ ErrorCode::InvalidDegenReceiverAta,
        constraint = receiver_token_ata.mint == selected_token_mint.key() @ ErrorCode::InvalidDegenReceiverAta,
    )]
    pub receiver_token_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<BeginDegenExecution>,
    round_id: u64,
    candidate_rank: u8,
    token_index: u32,
    min_out_raw: u64,
    route_hash: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.degen_config.executor == ctx.accounts.executor.key(),
        ErrorCode::UnauthorizedDegenExecutor
    );
    require!(
        ctx.accounts.executor_usdc_ata.amount == 0,
        ErrorCode::InvalidDegenExecutorAta
    );

    let pool_version = ctx.accounts.degen_claim.pool_version;
    let candidate_window = ctx.accounts.degen_claim.candidate_window;
    require!(candidate_rank < candidate_window, ErrorCode::InvalidDegenCandidate);
    require!(pool_version == DEGEN_POOL_VERSION, ErrorCode::InvalidDegenCandidate);

    let expected_index = derive_degen_candidate_index_at_rank(
        &ctx.accounts.degen_claim.randomness,
        pool_version,
        DEGEN_POOL.len(),
        candidate_rank as usize,
    ) as u32;
    require!(expected_index == token_index, ErrorCode::InvalidDegenCandidate);

    let token_mint = degen_token_mint_by_index(token_index).ok_or(ErrorCode::InvalidDegenCandidate)?;
    require_keys_eq!(token_mint, ctx.accounts.selected_token_mint.key(), ErrorCode::InvalidDegenCandidate);

    let round_key = ctx.accounts.round.key();
    let usdc_mint = ctx.accounts.config.usdc_mint;
    let (amounts, round_bump, winner_key, reimburse_vrf) = {
        let round = ctx.accounts.round.load()?;

        require!(round.status == RoundStatus::Settled as u8, ErrorCode::RoundNotSettled);
        require!(
            round.degen_mode_status() == DEGEN_MODE_VRF_READY,
            ErrorCode::DegenVrfNotReady
        );
        require!(
            ctx.accounts.degen_claim.status == DegenClaimStatus::VrfReady as u8,
            ErrorCode::DegenVrfNotReady
        );
        require!(
            ctx.accounts.vault_usdc_ata.key().to_bytes() == round.vault_usdc_ata,
            ErrorCode::InvalidVault
        );
        require!(ctx.accounts.vault_usdc_ata.mint == usdc_mint, ErrorCode::InvalidVault);
        require!(ctx.accounts.vault_usdc_ata.owner == round_key, ErrorCode::InvalidVault);

        let reimburse_vrf = Pubkey::new_from_array(round.vrf_payer) != Pubkey::default() && round.vrf_reimbursed == 0;
        let amounts = compute_claim_amounts(round.total_usdc, ctx.accounts.config.fee_bps, reimburse_vrf)?;
        (amounts, round.bump, Pubkey::new_from_array(round.winner), reimburse_vrf)
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
                to: ctx.accounts.executor_usdc_ata.to_account_info(),
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
        round.set_degen_mode_status(DEGEN_MODE_EXECUTING);
        if amounts.vrf_reimburse > 0 {
            round.vrf_reimbursed = 1;
        }
    }

    let now = Clock::get()?.unix_timestamp;
    let degen_claim = &mut ctx.accounts.degen_claim;
    degen_claim.status = DegenClaimStatus::Executing as u8;
    degen_claim.selected_candidate_rank = candidate_rank;
    degen_claim.fallback_reason = DEGEN_FALLBACK_REASON_NONE;
    degen_claim.token_index = token_index;
    degen_claim.token_mint = token_mint;
    degen_claim.executor = ctx.accounts.executor.key();
    degen_claim.receiver_token_ata = ctx.accounts.receiver_token_ata.key();
    degen_claim.receiver_pre_balance = ctx.accounts.receiver_token_ata.amount;
    degen_claim.min_out_raw = min_out_raw;
    degen_claim.payout_raw = amounts.payout;
    degen_claim.route_hash = route_hash;
    degen_claim.claimed_at = 0;
    degen_claim.fulfilled_at = now;

    emit!(DegenExecutionStarted {
        round_id,
        winner: winner_key,
        executor: ctx.accounts.executor.key(),
        payout_raw: amounts.payout,
        min_out_raw,
        candidate_rank,
        token_mint,
        token_index,
    });

    Ok(())
}
