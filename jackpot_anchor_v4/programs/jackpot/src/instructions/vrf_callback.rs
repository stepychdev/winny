use anchor_lang::prelude::*;
use crate::{
    constants::*,
    errors::ErrorCode,
    events::RoundSettled,
    state::{Config, Round, RoundStatus},
    utils::bit_find_prefix,
};

/// MagicBlock VRF program identity PDA — only the VRF program can sign as this address.
const VRF_PROGRAM_IDENTITY_BYTES: [u8; 32] =
    ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY.to_bytes();
pub static VRF_PROGRAM_IDENTITY: Pubkey = Pubkey::new_from_array(VRF_PROGRAM_IDENTITY_BYTES);

#[derive(Accounts)]
pub struct VrfCallback<'info> {
    /// VRF program identity PDA — only the VRF program can produce this signature.
    #[account(address = VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// No seeds constraint — round_id not available from VRF callback args.
    /// PDA verified manually in handler.
    #[account(mut)]
    pub round: AccountLoader<'info, Round>,
}

pub fn handler(ctx: Context<VrfCallback>, randomness: [u8; 32]) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let mut round = ctx.accounts.round.load_mut()?;

    // Manually verify round PDA (can't use seeds constraint without round_id instruction arg)
    let expected_key = Pubkey::create_program_address(
        &[SEED_ROUND, &round.round_id.to_le_bytes(), &[round.bump]],
        &crate::ID,
    )
    .map_err(|_| ErrorCode::Unauthorized)?;
    require!(ctx.accounts.round.key() == expected_key, ErrorCode::Unauthorized);

    require!(round.status == RoundStatus::VrfRequested as u8, ErrorCode::RoundNotVrfRequested);
    require!(round.participants_count >= cfg.min_participants, ErrorCode::NotEnoughParticipants);
    require!(round.total_tickets >= cfg.min_total_tickets, ErrorCode::NotEnoughTickets);

    round.randomness = randomness;

    // Derive winning ticket from randomness
    let mut bytes16 = [0u8; 16];
    bytes16.copy_from_slice(&randomness[..16]);
    let r = u128::from_le_bytes(bytes16);
    let total_tickets_u128 = round.total_tickets as u128;
    let winning_ticket = (r % total_tickets_u128) as u64 + 1;

    // Find winner via Fenwick tree
    let winner_idx = bit_find_prefix(&round.bit.data, winning_ticket)?;
    let winner_bytes = round.participants.data[winner_idx - 1];

    round.winning_ticket = winning_ticket;
    round.winner = winner_bytes;
    round.status = RoundStatus::Settled as u8;

    emit!(RoundSettled {
        round_id: round.round_id,
        winning_ticket,
        winner: Pubkey::new_from_array(winner_bytes),
        total_usdc: round.total_usdc,
        total_tickets: round.total_tickets,
    });

    Ok(())
}
