use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_degen_vrf_callback_ix,
    legacy_layouts::{
        ConfigView, DegenClaimView, DegenConfigView, RoundLifecycleView,
        DEGEN_CANDIDATE_WINDOW, DEGEN_CLAIM_STATUS_VRF_READY, DEGEN_CLAIM_STATUS_VRF_REQUESTED,
        DEGEN_FALLBACK_REASON_NONE, DEGEN_MODE_VRF_READY, DEGEN_MODE_VRF_REQUESTED,
        DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC, ROUND_STATUS_SETTLED, PUBKEY_LEN,
    },
};

use super::degen_common::{compute_claim_amounts, map_layout_err};

const DEGEN_POOL_VERSION: u32 = 1;

pub fn process_anchor_bytes(
    round_pubkey: [u8; PUBKEY_LEN],
    now_ts: i64,
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    degen_claim_account_data: &mut [u8],
    degen_config_account_data: Option<&[u8]>,
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let randomness =
        parse_degen_vrf_callback_ix(ix_data).map_err(|_| ProgramError::InvalidInstructionData)?;
    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let mut degen_claim = DegenClaimView::read_from_account_data(degen_claim_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let winner_key = RoundLifecycleView::read_winner_from_account_data(round_account_data)
        .map_err(map_layout_err)?;

    if round.status != ROUND_STATUS_SETTLED {
        return Err(JackpotCompatError::RoundNotSettled.into());
    }
    if RoundLifecycleView::read_degen_mode_status_from_account_data(round_account_data)
        .map_err(map_layout_err)?
        != DEGEN_MODE_VRF_REQUESTED
    {
        return Err(JackpotCompatError::DegenVrfNotRequested.into());
    }
    if degen_claim.round != round_pubkey
        || degen_claim.round_id != round.round_id
        || degen_claim.winner != winner_key
    {
        return Err(JackpotCompatError::InvalidDegenClaim.into());
    }
    if degen_claim.status != DEGEN_CLAIM_STATUS_VRF_REQUESTED {
        return Err(JackpotCompatError::DegenVrfNotRequested.into());
    }

    let fallback_timeout_sec = match degen_config_account_data {
        Some(data) if !data.is_empty() => {
            let degen_cfg = DegenConfigView::read_from_account_data(data)
                .map_err(|_| ProgramError::InvalidAccountData)?;
            if degen_cfg.fallback_timeout_sec == 0 {
                DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC
            } else {
                degen_cfg.fallback_timeout_sec
            }
        }
        _ => DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC,
    };
    let fallback_after_ts = checked_add_i64(now_ts, fallback_timeout_sec as i64)?;

    let reimburse_vrf = RoundLifecycleView::read_vrf_payer_from_account_data(round_account_data)
        .map_err(map_layout_err)?
        != [0u8; 32]
        && RoundLifecycleView::read_vrf_reimbursed_from_account_data(round_account_data)
            .map_err(map_layout_err)?
            == 0;
    let payout_raw = compute_claim_amounts(round.total_usdc, config.fee_bps, reimburse_vrf)?.payout;

    degen_claim.status = DEGEN_CLAIM_STATUS_VRF_READY;
    degen_claim.randomness = randomness;
    degen_claim.selected_candidate_rank = u8::MAX;
    degen_claim.fallback_reason = DEGEN_FALLBACK_REASON_NONE;
    degen_claim.token_index = 0;
    degen_claim.pool_version = DEGEN_POOL_VERSION;
    degen_claim.candidate_window = DEGEN_CANDIDATE_WINDOW;
    degen_claim.padding0 = [0u8; 7];
    degen_claim.token_mint = [0u8; 32];
    degen_claim.fulfilled_at = now_ts;
    degen_claim.fallback_after_ts = fallback_after_ts;
    degen_claim.payout_raw = payout_raw;
    degen_claim.min_out_raw = 0;
    degen_claim.receiver_pre_balance = 0;
    degen_claim.executor = [0u8; 32];
    degen_claim.receiver_token_ata = [0u8; 32];
    degen_claim.route_hash = [0u8; 32];
    degen_claim
        .write_to_account_data(degen_claim_account_data)
        .map_err(map_layout_err)?;

    RoundLifecycleView::write_degen_mode_status_to_account_data(round_account_data, DEGEN_MODE_VRF_READY)
        .map_err(map_layout_err)?;

    Ok(())
}

fn checked_add_i64(a: i64, b: i64) -> Result<i64, ProgramError> {
    a.checked_add(b)
        .ok_or_else(|| JackpotCompatError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, DegenClaimView, RoundLifecycleView, CONFIG_ACCOUNT_LEN,
            DEGEN_CLAIM_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ROUND_STATUS_SETTLED,
        },
    };

    fn sample_config() -> [u8; CONFIG_ACCOUNT_LEN] {
        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin: [7u8; 32],
            usdc_mint: [2u8; 32],
            treasury_usdc_ata: [3u8; 32],
            fee_bps: 25,
            ticket_unit: 10_000,
            round_duration_sec: 120,
            min_participants: 2,
            min_total_tickets: 200,
            paused: false,
            bump: 254,
            max_deposit_per_user: 1_000_000,
            reserved: [0u8; 24],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

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
            total_usdc: 1_000_000,
            total_tickets: 200,
            participants_count: 2,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        RoundLifecycleView::write_winner_to_account_data(&mut data, &[9u8; 32]).unwrap();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut data, DEGEN_MODE_VRF_REQUESTED)
            .unwrap();
        data
    }

    fn sample_degen_claim() -> [u8; DEGEN_CLAIM_ACCOUNT_LEN] {
        let mut data = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: [8u8; 32],
            winner: [9u8; 32],
            round_id: 81,
            status: DEGEN_CLAIM_STATUS_VRF_REQUESTED,
            bump: 203,
            selected_candidate_rank: u8::MAX,
            fallback_reason: 0,
            token_index: 0,
            pool_version: 1,
            candidate_window: DEGEN_CANDIDATE_WINDOW,
            padding0: [0u8; 7],
            requested_at: 777,
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
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    #[test]
    fn degen_callback_marks_ready_and_sets_payout() {
        let config = sample_config();
        let mut round = sample_round();
        let mut degen_claim = sample_degen_claim();
        let randomness = [7u8; 32];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("degen_vrf_callback"));
        ix.extend_from_slice(&randomness);

        process_anchor_bytes(
            [8u8; 32],
            1_000,
            &config,
            &mut round,
            &mut degen_claim,
            None,
            &ix,
        )
        .unwrap();

        let parsed = DegenClaimView::read_from_account_data(&degen_claim).unwrap();
        assert_eq!(parsed.status, DEGEN_CLAIM_STATUS_VRF_READY);
        assert_eq!(parsed.randomness, randomness);
        assert_eq!(parsed.payout_raw, 997_500);
        assert_eq!(parsed.fulfilled_at, 1_000);
        assert_eq!(parsed.fallback_after_ts, 1_300);
        assert_eq!(
            RoundLifecycleView::read_degen_mode_status_from_account_data(&round).unwrap(),
            DEGEN_MODE_VRF_READY
        );
    }
}
