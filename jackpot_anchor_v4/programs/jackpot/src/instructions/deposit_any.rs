use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{
    constants::*,
    errors::ErrorCode,
    events::DepositEvent,
    state::{Config, Participant, Round, RoundStatus},
    utils::bit_add,
};

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct DepositAny<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    #[account(
        init_if_needed,
        payer = user,
        space = Participant::SPACE,
        seeds = [SEED_PARTICIPANT, round.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,

    #[account(
        mut,
        constraint = user_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidUserUsdcAta,
        constraint = user_usdc_ata.owner == user.key() @ ErrorCode::InvalidUserUsdcAta,
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_usdc_ata.mint == config.usdc_mint @ ErrorCode::InvalidVault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositAny>, _round_id: u64, usdc_balance_before: u64, min_out: u64) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let round_key = ctx.accounts.round.key();
    let participant = &mut ctx.accounts.participant;

    let mut round = ctx.accounts.round.load_mut()?;

    // Verify vault matches round's stored vault
    require!(
        ctx.accounts.vault_usdc_ata.key().to_bytes() == round.vault_usdc_ata,
        ErrorCode::InvalidVault
    );
    require!(
        ctx.accounts.vault_usdc_ata.owner == round_key,
        ErrorCode::InvalidVault
    );

    require!(!cfg.paused, ErrorCode::Paused);
    require!(round.status == RoundStatus::Open as u8, ErrorCode::RoundNotOpen);

    let now = Clock::get()?.unix_timestamp;

    // [M-4 fix] Block deposits after round timer expires (prevents front-running lock_round)
    if round.end_ts != 0 {
        require!(now < round.end_ts, ErrorCode::RoundExpired);
    }

    let b1 = ctx.accounts.user_usdc_ata.amount;
    require!(b1 >= usdc_balance_before, ErrorCode::InvalidUsdcBalanceBefore);

    let delta = b1.checked_sub(usdc_balance_before).ok_or(ErrorCode::MathOverflow)?;
    require!(delta >= min_out, ErrorCode::SlippageExceeded);

    let tickets_added = delta.checked_div(cfg.ticket_unit).ok_or(ErrorCode::MathOverflow)?;
    require!(tickets_added > 0, ErrorCode::DepositTooSmall);

    // Register new participant (or re-register stale participant from a reused round_id)
    if participant.round != round_key {
        let next = round.participants_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
        require!((next as usize) <= MAX_PARTICIPANTS, ErrorCode::MaxParticipantsReached);

        participant.round = round_key;
        participant.user = ctx.accounts.user.key();
        participant.index = next;
        participant.bump = ctx.bumps.participant;
        participant.tickets_total = 0;
        participant.usdc_total = 0;
        participant.deposits_count = 0;

        round.participants_count = next;
        round.participants.data[(next - 1) as usize] = ctx.accounts.user.key().to_bytes();
    }

    // Record first deposit timestamp
    if round.first_deposit_ts == 0 {
        round.first_deposit_ts = now;
    }

    // Start countdown timer when min_participants is reached
    // (end_ts == 0 means timer hasn't started yet)
    if round.end_ts == 0 && round.participants_count >= cfg.min_participants {
        round.end_ts = now
            .checked_add(cfg.round_duration_sec as i64)
            .ok_or(ErrorCode::MathOverflow)?;
    }

    // [M-1 fix] Check max deposit per user
    let new_usdc_total = participant.usdc_total.checked_add(delta).ok_or(ErrorCode::MathOverflow)?;
    if cfg.max_deposit_per_user > 0 {
        require!(new_usdc_total <= cfg.max_deposit_per_user, ErrorCode::MaxDepositExceeded);
    }

    // Update totals
    participant.tickets_total = participant.tickets_total.checked_add(tickets_added).ok_or(ErrorCode::MathOverflow)?;
    participant.usdc_total = new_usdc_total;
    participant.deposits_count = participant.deposits_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

    round.total_tickets = round.total_tickets.checked_add(tickets_added).ok_or(ErrorCode::MathOverflow)?;
    round.total_usdc = round.total_usdc.checked_add(delta).ok_or(ErrorCode::MathOverflow)?;

    bit_add(&mut round.bit.data, participant.index as usize, tickets_added)?;

    // Save values for event before dropping RefMut
    let round_id_val = round.round_id;
    let total_usdc_after = round.total_usdc;
    let total_tickets_after = round.total_tickets;
    let participant_index = participant.index;

    // Drop RefMut before CPI
    drop(round);

    // Transfer USDC from user to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_usdc_ata.to_account_info(),
                to: ctx.accounts.vault_usdc_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        delta,
    )?;

    emit!(DepositEvent {
        round_id: round_id_val,
        user: ctx.accounts.user.key(),
        delta_usdc: delta,
        tickets_added,
        participant_index,
        total_usdc_after,
        total_tickets_after,
    });

    Ok(())
}
