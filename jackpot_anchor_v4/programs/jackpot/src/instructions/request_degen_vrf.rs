use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::{
    constants::*,
    errors::ErrorCode,
    events::DegenVrfRequested,
    state::{Config, DegenClaim, DegenClaimStatus, Round, RoundStatus},
};

fn to_sdk_pubkey(p: &Pubkey) -> ephemeral_vrf_sdk::Pubkey {
    ephemeral_vrf_sdk::Pubkey::new_from_array(p.to_bytes())
}

const VRF_PROGRAM_ID_BYTES: [u8; 32] = ephemeral_vrf_sdk::consts::VRF_PROGRAM_ID.to_bytes();
const DEFAULT_QUEUE_BYTES: [u8; 32] = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE.to_bytes();

const VRF_PROGRAM_ID: Pubkey = Pubkey::new_from_array(VRF_PROGRAM_ID_BYTES);
const DEFAULT_QUEUE: Pubkey = Pubkey::new_from_array(DEFAULT_QUEUE_BYTES);

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RequestDegenVrf<'info> {
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

    #[account(
        init_if_needed,
        payer = winner,
        space = DegenClaim::SPACE,
        seeds = [SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), winner.key().as_ref()],
        bump,
    )]
    pub degen_claim: Account<'info, DegenClaim>,

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

pub fn handler(ctx: Context<RequestDegenVrf>, round_id: u64) -> Result<()> {
    let winner_key = ctx.accounts.winner.key();
    let round_key = ctx.accounts.round.key();
    let config_key = ctx.accounts.config.key();

    {
        let round = ctx.accounts.round.load()?;
        require!(round.status == RoundStatus::Settled as u8, ErrorCode::RoundNotSettled);
        require!(winner_key.to_bytes() == round.winner, ErrorCode::OnlyWinnerCanClaim);

        match round.degen_mode_status() {
            DEGEN_MODE_NONE => {}
            DEGEN_MODE_VRF_REQUESTED => return err!(ErrorCode::DegenAlreadyRequested),
            DEGEN_MODE_VRF_READY | DEGEN_MODE_CLAIMED => return err!(ErrorCode::DegenAlreadyClaimed),
            _ => return err!(ErrorCode::DegenClaimLocked),
        }
    }

    if ctx.accounts.degen_claim.round != Pubkey::default() {
        require!(
            ctx.accounts.degen_claim.round == round_key
                && ctx.accounts.degen_claim.winner == winner_key
                && ctx.accounts.degen_claim.round_id == round_id,
            ErrorCode::InvalidDegenClaim
        );
        match ctx.accounts.degen_claim.status {
            x if x == DegenClaimStatus::VrfRequested as u8 => {
                return err!(ErrorCode::DegenAlreadyRequested)
            }
            x if x == DegenClaimStatus::VrfReady as u8
                || x == DegenClaimStatus::Executing as u8
                || x == DegenClaimStatus::ClaimedSwapped as u8
                || x == DegenClaimStatus::ClaimedFallback as u8 =>
            {
                return err!(ErrorCode::DegenAlreadyClaimed)
            }
            _ => {}
        }
    }

    let mut caller_seed = [0u8; 32];
    caller_seed[..8].copy_from_slice(&round_id.to_le_bytes());
    let winner_bytes = winner_key.to_bytes();
    caller_seed[8..].copy_from_slice(&winner_bytes[..24]);

    let sdk_ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: to_sdk_pubkey(&winner_key),
        oracle_queue: to_sdk_pubkey(&ctx.accounts.oracle_queue.key()),
        callback_program_id: to_sdk_pubkey(&crate::ID),
        callback_discriminator: crate::instruction::DegenVrfCallback::DISCRIMINATOR.to_vec(),
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
            SerializableAccountMeta {
                pubkey: to_sdk_pubkey(&ctx.accounts.degen_claim.key()),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: to_sdk_pubkey(
                    &Pubkey::find_program_address(&[SEED_DEGEN_CFG], &crate::ID).0,
                ),
                is_signer: false,
                is_writable: false,
            },
        ]),
        ..Default::default()
    });

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
                        pubkey,
                        a.is_signer,
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

    let (_, identity_bump) = Pubkey::find_program_address(&[b"identity"], &crate::ID);

    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.winner.to_account_info(),
            ctx.accounts.program_identity.to_account_info(),
            ctx.accounts.oracle_queue.to_account_info(),
            ctx.accounts.slot_hashes.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&[b"identity", &[identity_bump]]],
    )?;

    let now = Clock::get()?.unix_timestamp;

    {
        let mut round = ctx.accounts.round.load_mut()?;
        round.set_degen_mode_status(DEGEN_MODE_VRF_REQUESTED);
    }

    let degen_claim = &mut ctx.accounts.degen_claim;
    degen_claim.round = round_key;
    degen_claim.winner = winner_key;
    degen_claim.round_id = round_id;
    degen_claim.status = DegenClaimStatus::VrfRequested as u8;
    degen_claim.bump = ctx.bumps.degen_claim;
    degen_claim.selected_candidate_rank = u8::MAX;
    degen_claim.fallback_reason = DEGEN_FALLBACK_REASON_NONE;
    degen_claim.token_index = 0;
    degen_claim.pool_version = DEGEN_POOL_VERSION;
    degen_claim.candidate_window = DEGEN_CANDIDATE_WINDOW;
    degen_claim._padding0 = [0u8; 7];
    degen_claim.requested_at = now;
    degen_claim.fulfilled_at = 0;
    degen_claim.claimed_at = 0;
    degen_claim.fallback_after_ts = 0;
    degen_claim.payout_raw = 0;
    degen_claim.min_out_raw = 0;
    degen_claim.receiver_pre_balance = 0;
    degen_claim.token_mint = Pubkey::default();
    degen_claim.executor = Pubkey::default();
    degen_claim.receiver_token_ata = Pubkey::default();
    degen_claim.randomness = [0u8; 32];
    degen_claim.route_hash = [0u8; 32];
    degen_claim.reserved = [0u8; 32];

    emit!(DegenVrfRequested {
        round_id,
        winner: winner_key,
        degen_claim: degen_claim.key(),
    });

    Ok(())
}
