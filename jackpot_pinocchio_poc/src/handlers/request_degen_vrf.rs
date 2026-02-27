use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::account_discriminator,
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        DegenClaimView, RoundLifecycleView, DEGEN_CANDIDATE_WINDOW,
        DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK, DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED,
        DEGEN_CLAIM_STATUS_EXECUTING, DEGEN_CLAIM_STATUS_VRF_READY,
        DEGEN_CLAIM_STATUS_VRF_REQUESTED, DEGEN_FALLBACK_REASON_NONE, DEGEN_MODE_CLAIMED,
        DEGEN_MODE_EXECUTING, DEGEN_MODE_NONE, DEGEN_MODE_VRF_READY, DEGEN_MODE_VRF_REQUESTED,
        ROUND_STATUS_SETTLED, PUBKEY_LEN,
    },
};

const DEGEN_POOL_VERSION: u32 = 1;

pub fn process_anchor_bytes(
    winner_pubkey: [u8; PUBKEY_LEN],
    round_pubkey: [u8; PUBKEY_LEN],
    degen_claim_bump: u8,
    now_ts: i64,
    round_account_data: &mut [u8],
    degen_claim_account_data: &mut [u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let round_id =
        parse_round_id_ix(ix_data, "request_degen_vrf").map_err(|_| ProgramError::InvalidInstructionData)?;

    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let degen_claim = DegenClaimView::read_from_account_data(degen_claim_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if round.round_id != round_id {
        return Err(JackpotCompatError::Unauthorized.into());
    }
    if round.status != ROUND_STATUS_SETTLED {
        return Err(JackpotCompatError::RoundNotSettled.into());
    }
    if RoundLifecycleView::read_winner_from_account_data(round_account_data).map_err(map_layout_err)?
        != winner_pubkey
    {
        return Err(JackpotCompatError::OnlyWinnerCanClaim.into());
    }

    match RoundLifecycleView::read_degen_mode_status_from_account_data(round_account_data)
        .map_err(map_layout_err)?
    {
        DEGEN_MODE_NONE => {}
        DEGEN_MODE_VRF_REQUESTED => return Err(JackpotCompatError::DegenAlreadyRequested.into()),
        DEGEN_MODE_VRF_READY | DEGEN_MODE_CLAIMED => {
            return Err(JackpotCompatError::DegenAlreadyClaimed.into())
        }
        DEGEN_MODE_EXECUTING => return Err(JackpotCompatError::DegenClaimLocked.into()),
        _ => return Err(JackpotCompatError::DegenClaimLocked.into()),
    }

    if degen_claim.round != [0u8; PUBKEY_LEN] {
        if degen_claim.round != round_pubkey
            || degen_claim.winner != winner_pubkey
            || degen_claim.round_id != round_id
        {
            return Err(JackpotCompatError::InvalidDegenClaim.into());
        }

        match degen_claim.status {
            DEGEN_CLAIM_STATUS_VRF_REQUESTED => {
                return Err(JackpotCompatError::DegenAlreadyRequested.into())
            }
            DEGEN_CLAIM_STATUS_VRF_READY
            | DEGEN_CLAIM_STATUS_EXECUTING
            | DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED
            | DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK => {
                return Err(JackpotCompatError::DegenAlreadyClaimed.into())
            }
            _ => {}
        }
    }

    RoundLifecycleView::write_degen_mode_status_to_account_data(
        round_account_data,
        DEGEN_MODE_VRF_REQUESTED,
    )
    .map_err(map_layout_err)?;

    let initialized = DegenClaimView {
        round: round_pubkey,
        winner: winner_pubkey,
        round_id,
        status: DEGEN_CLAIM_STATUS_VRF_REQUESTED,
        bump: degen_claim_bump,
        selected_candidate_rank: u8::MAX,
        fallback_reason: DEGEN_FALLBACK_REASON_NONE,
        token_index: 0,
        pool_version: DEGEN_POOL_VERSION,
        candidate_window: DEGEN_CANDIDATE_WINDOW,
        padding0: [0u8; 7],
        requested_at: now_ts,
        fulfilled_at: 0,
        claimed_at: 0,
        fallback_after_ts: 0,
        payout_raw: 0,
        min_out_raw: 0,
        receiver_pre_balance: 0,
        token_mint: [0u8; 32],
        executor: [0u8; 32],
        receiver_token_ata: [0u8; 32],
        randomness: [0u8; 32],
        route_hash: [0u8; 32],
        reserved: [0u8; 32],
    };
    degen_claim_account_data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
    initialized
        .write_to_account_data(degen_claim_account_data)
        .map_err(map_layout_err)?;

    Ok(())
}

fn map_layout_err(err: crate::legacy_layouts::LayoutError) -> ProgramError {
    match err {
        crate::legacy_layouts::LayoutError::MathOverflow => JackpotCompatError::MathOverflow.into(),
        _ => ProgramError::InvalidAccountData,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            DegenClaimView, RoundLifecycleView, DEGEN_CLAIM_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_SETTLED,
        },
    };

    fn sample_round() -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id: 81,
            status: ROUND_STATUS_SETTLED,
            bump: 201,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_250_000,
            total_tickets: 200,
            participants_count: 2,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        RoundLifecycleView::write_winner_to_account_data(&mut data, &[9u8; 32]).unwrap();
        data
    }

    fn sample_degen_claim() -> [u8; DEGEN_CLAIM_ACCOUNT_LEN] {
        let mut data = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView::default().write_to_account_data(&mut data).unwrap();
        data
    }

    impl Default for DegenClaimView {
        fn default() -> Self {
            Self {
                round: [0u8; 32],
                winner: [0u8; 32],
                round_id: 0,
                status: 0,
                bump: 0,
                selected_candidate_rank: 0,
                fallback_reason: 0,
                token_index: 0,
                pool_version: 0,
                candidate_window: 0,
                padding0: [0u8; 7],
                requested_at: 0,
                fulfilled_at: 0,
                claimed_at: 0,
                fallback_after_ts: 0,
                payout_raw: 0,
                min_out_raw: 0,
                receiver_pre_balance: 0,
                token_mint: [0u8; 32],
                executor: [0u8; 32],
                receiver_token_ata: [0u8; 32],
                randomness: [0u8; 32],
                route_hash: [0u8; 32],
                reserved: [0u8; 32],
            }
        }
    }

    #[test]
    fn initializes_degen_claim_and_marks_round() {
        let mut round = sample_round();
        let mut degen_claim = sample_degen_claim();

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_degen_vrf"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_anchor_bytes(
            [9u8; 32],
            [8u8; 32],
            203,
            777,
            &mut round,
            &mut degen_claim,
            &ix,
        )
        .unwrap();

        let parsed = DegenClaimView::read_from_account_data(&degen_claim).unwrap();
        assert_eq!(parsed.status, DEGEN_CLAIM_STATUS_VRF_REQUESTED);
        assert_eq!(parsed.round, [8u8; 32]);
        assert_eq!(parsed.winner, [9u8; 32]);
        assert_eq!(parsed.bump, 203);
        assert_eq!(parsed.pool_version, DEGEN_POOL_VERSION);
        assert_eq!(parsed.candidate_window, DEGEN_CANDIDATE_WINDOW);
        assert_eq!(parsed.requested_at, 777);
        assert_eq!(
            RoundLifecycleView::read_degen_mode_status_from_account_data(&round).unwrap(),
            DEGEN_MODE_VRF_REQUESTED
        );
    }
}
