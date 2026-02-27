use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::{
    constants::*,
    errors::ErrorCode,
    events::VrfRequested,
    state::{Config, Round, RoundStatus},
};

/// Convert an anchor Pubkey to the SDK's Pubkey (same 32 bytes, different crate).
fn to_sdk_pubkey(p: &Pubkey) -> ephemeral_vrf_sdk::Pubkey {
    ephemeral_vrf_sdk::Pubkey::new_from_array(p.to_bytes())
}

// MagicBlock VRF program constants
const VRF_PROGRAM_ID_BYTES: [u8; 32] = ephemeral_vrf_sdk::consts::VRF_PROGRAM_ID.to_bytes();
const DEFAULT_QUEUE_BYTES: [u8; 32] = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE.to_bytes();

pub static VRF_PROGRAM_ID: Pubkey = Pubkey::new_from_array(VRF_PROGRAM_ID_BYTES);
pub static DEFAULT_QUEUE: Pubkey = Pubkey::new_from_array(DEFAULT_QUEUE_BYTES);

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RequestVrf<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [SEED_CFG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round_id.to_le_bytes()],
        bump,
    )]
    pub round: AccountLoader<'info, Round>,

    /// CHECK: Our program's identity PDA, used to sign the VRF CPI.
    #[account(seeds = [b"identity"], bump)]
    pub program_identity: AccountInfo<'info>,

    /// CHECK: Oracle queue account
    #[account(mut, address = DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,

    /// CHECK: MagicBlock VRF program
    #[account(address = VRF_PROGRAM_ID)]
    pub vrf_program: AccountInfo<'info>,

    /// CHECK: SlotHashes sysvar
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RequestVrf>, round_id: u64) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let round_key = ctx.accounts.round.key();
    let config_key = ctx.accounts.config.key();

    // Read-only checks
    {
        let round = ctx.accounts.round.load()?;
        require!(round.status == RoundStatus::Locked as u8, ErrorCode::RoundNotLocked);
        require!(round.participants_count >= cfg.min_participants, ErrorCode::NotEnoughParticipants);
        require!(round.total_tickets >= cfg.min_total_tickets, ErrorCode::NotEnoughTickets);
    }

    // Build a 32-byte caller seed from the round_id for uniqueness
    let mut caller_seed = [0u8; 32];
    caller_seed[..8].copy_from_slice(&round_id.to_le_bytes());

    // Build the VRF request instruction using the SDK (with type conversion)
    let sdk_ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: to_sdk_pubkey(&ctx.accounts.payer.key()),
        oracle_queue: to_sdk_pubkey(&ctx.accounts.oracle_queue.key()),
        callback_program_id: to_sdk_pubkey(&crate::ID),
        callback_discriminator: crate::instruction::VrfCallback::DISCRIMINATOR.to_vec(),
        caller_seed,
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: to_sdk_pubkey(&config_key),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: to_sdk_pubkey(&round_key),
                is_signer: false,
                is_writable: true,
            },
        ]),
        ..Default::default()
    });

    // Manually convert the SDK instruction to anchor's solana_program types.
    let ix = {
        let program_id = Pubkey::new_from_array(sdk_ix.program_id.to_bytes());
        let accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta> = sdk_ix
            .accounts
            .iter()
            .map(|a| {
                let pubkey = Pubkey::new_from_array(a.pubkey.to_bytes());
                if a.is_writable {
                    anchor_lang::solana_program::instruction::AccountMeta::new(pubkey, a.is_signer)
                } else {
                    anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                        pubkey, a.is_signer,
                    )
                }
            })
            .collect();
        anchor_lang::solana_program::instruction::Instruction {
            program_id,
            accounts,
            data: sdk_ix.data,
        }
    };

    // Find identity PDA bump
    let (_, identity_bump) = Pubkey::find_program_address(&[b"identity"], &crate::ID);

    // CPI into VRF program, signing with our program's identity PDA
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.program_identity.to_account_info(),
            ctx.accounts.oracle_queue.to_account_info(),
            ctx.accounts.slot_hashes.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&[b"identity", &[identity_bump]]],
    )?;

    // Update status after CPI + record who paid for VRF
    let mut round = ctx.accounts.round.load_mut()?;
    round.status = RoundStatus::VrfRequested as u8;
    round.vrf_payer = ctx.accounts.payer.key().to_bytes();

    emit!(VrfRequested { round_id });

    Ok(())
}
