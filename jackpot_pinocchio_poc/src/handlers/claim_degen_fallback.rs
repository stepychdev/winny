use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_u8_ix,
    legacy_layouts::{
        ConfigView, DegenClaimView, RoundLifecycleView, TokenAccountCoreView,
        DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK, DEGEN_CLAIM_STATUS_VRF_READY,
        DEGEN_MODE_CLAIMED, DEGEN_MODE_VRF_READY, ROUND_STATUS_CLAIMED, ROUND_STATUS_SETTLED,
        PUBKEY_LEN,
    },
};

use super::degen_common::{ClaimAmountsCompat, compute_claim_amounts, map_layout_err};

#[allow(clippy::too_many_arguments)]
pub fn process_anchor_bytes(
    winner_pubkey: [u8; PUBKEY_LEN],
    round_pubkey: [u8; PUBKEY_LEN],
    vault_pubkey: [u8; PUBKEY_LEN],
    now_ts: i64,
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    degen_claim_account_data: &mut [u8],
    vault_account_data: &[u8],
    winner_usdc_ata_data: &[u8],
    treasury_usdc_ata_pubkey: [u8; PUBKEY_LEN],
    treasury_usdc_ata_data: &[u8],
    vrf_payer_authority_pubkey: Option<[u8; PUBKEY_LEN]>,
    vrf_payer_usdc_ata_data: Option<&[u8]>,
    ix_data: &[u8],
) -> Result<ClaimAmountsCompat, ProgramError> {
    process_anchor_bytes_named(
        winner_pubkey, round_pubkey, vault_pubkey, now_ts,
        config_account_data, round_account_data, degen_claim_account_data,
        vault_account_data, winner_usdc_ata_data, treasury_usdc_ata_pubkey,
        treasury_usdc_ata_data, vrf_payer_authority_pubkey, vrf_payer_usdc_ata_data,
        ix_data, "claim_degen_fallback",
    )
}

/// Same as `process_anchor_bytes` but accepts an explicit instruction name
/// so `auto_claim_degen_fallback` can reuse the logic with its own discriminator.
#[allow(clippy::too_many_arguments)]
pub fn process_anchor_bytes_named(
    winner_pubkey: [u8; PUBKEY_LEN],
    round_pubkey: [u8; PUBKEY_LEN],
    vault_pubkey: [u8; PUBKEY_LEN],
    now_ts: i64,
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    degen_claim_account_data: &mut [u8],
    vault_account_data: &[u8],
    winner_usdc_ata_data: &[u8],
    treasury_usdc_ata_pubkey: [u8; PUBKEY_LEN],
    treasury_usdc_ata_data: &[u8],
    vrf_payer_authority_pubkey: Option<[u8; PUBKEY_LEN]>,
    vrf_payer_usdc_ata_data: Option<&[u8]>,
    ix_data: &[u8],
    ix_name: &str,
) -> Result<ClaimAmountsCompat, ProgramError> {
    let (round_id, fallback_reason) =
        parse_round_id_u8_ix(ix_data, ix_name)
            .map_err(|_| ProgramError::InvalidInstructionData)?;
    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let mut degen_claim = DegenClaimView::read_from_account_data(degen_claim_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if degen_claim.status != DEGEN_CLAIM_STATUS_VRF_READY {
        return Err(JackpotCompatError::InvalidDegenExecutionState.into());
    }
    if now_ts < degen_claim.fallback_after_ts {
        return Err(JackpotCompatError::DegenFallbackTooEarly.into());
    }
    if round.status != ROUND_STATUS_SETTLED {
        return Err(JackpotCompatError::RoundNotSettled.into());
    }
    if RoundLifecycleView::read_degen_mode_status_from_account_data(round_account_data)
        .map_err(map_layout_err)?
        != DEGEN_MODE_VRF_READY
    {
        return Err(JackpotCompatError::DegenVrfNotReady.into());
    }
    let winner_key = RoundLifecycleView::read_winner_from_account_data(round_account_data)
        .map_err(map_layout_err)?;
    if winner_pubkey != winner_key {
        return Err(JackpotCompatError::OnlyWinnerCanClaim.into());
    }
    if degen_claim.round != round_pubkey
        || degen_claim.winner != winner_pubkey
        || degen_claim.round_id != round_id
        || round.round_id != round_id
    {
        return Err(JackpotCompatError::InvalidDegenClaim.into());
    }

    let vault = TokenAccountCoreView::read_from_account_data(vault_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if RoundLifecycleView::read_vault_pubkey_from_account_data(round_account_data)
        .map_err(map_layout_err)?
        != vault_pubkey
        || vault.mint != config.usdc_mint
        || vault.owner != round_pubkey
    {
        return Err(JackpotCompatError::InvalidVault.into());
    }

    let winner_ata = TokenAccountCoreView::read_from_account_data(winner_usdc_ata_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if winner_ata.mint != config.usdc_mint || winner_ata.owner != winner_pubkey {
        return Err(JackpotCompatError::InvalidUserUsdcAta.into());
    }

    let treasury_ata = TokenAccountCoreView::read_from_account_data(treasury_usdc_ata_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if treasury_usdc_ata_pubkey != config.treasury_usdc_ata
        || treasury_ata.mint != config.usdc_mint
    {
        return Err(JackpotCompatError::InvalidTreasury.into());
    }

    let reimburse_vrf = RoundLifecycleView::read_vrf_payer_from_account_data(round_account_data)
        .map_err(map_layout_err)?
        != [0u8; 32]
        && RoundLifecycleView::read_vrf_reimbursed_from_account_data(round_account_data)
            .map_err(map_layout_err)?
            == 0;

    if reimburse_vrf {
        let vrf_payer_key = RoundLifecycleView::read_vrf_payer_from_account_data(round_account_data)
            .map_err(map_layout_err)?;
        if vrf_payer_authority_pubkey != Some(vrf_payer_key) {
            return Err(JackpotCompatError::InvalidVrfPayerAta.into());
        }
        let vrf_payer_ata = vrf_payer_usdc_ata_data
            .ok_or::<ProgramError>(JackpotCompatError::InvalidVrfPayerAta.into())
            .and_then(|data| {
                TokenAccountCoreView::read_from_account_data(data)
                    .map_err(|_| ProgramError::InvalidAccountData)
            })?;
        if vrf_payer_ata.mint != config.usdc_mint || vrf_payer_ata.owner != vrf_payer_key {
            return Err(JackpotCompatError::InvalidVrfPayerAta.into());
        }
    }

    let amounts = compute_claim_amounts(round.total_usdc, config.fee_bps, reimburse_vrf)?;

    RoundLifecycleView::write_status_to_account_data(round_account_data, ROUND_STATUS_CLAIMED)
        .map_err(map_layout_err)?;
    RoundLifecycleView::write_degen_mode_status_to_account_data(round_account_data, DEGEN_MODE_CLAIMED)
        .map_err(map_layout_err)?;
    if amounts.vrf_reimburse > 0 {
        RoundLifecycleView::write_vrf_reimbursed_to_account_data(round_account_data, 1)
            .map_err(map_layout_err)?;
    }

    degen_claim.status = DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK;
    degen_claim.claimed_at = now_ts;
    degen_claim.fallback_reason = fallback_reason;
    degen_claim.selected_candidate_rank = u8::MAX;
    degen_claim.token_index = u32::MAX;
    degen_claim.token_mint = [0u8; 32];
    degen_claim.executor = [0u8; 32];
    degen_claim.receiver_token_ata = [0u8; 32];
    degen_claim.receiver_pre_balance = 0;
    degen_claim.min_out_raw = 0;
    degen_claim.route_hash = [0u8; 32];
    degen_claim.payout_raw = amounts.payout;
    degen_claim
        .write_to_account_data(degen_claim_account_data)
        .map_err(map_layout_err)?;

    Ok(amounts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, DegenClaimView, RoundLifecycleView, CONFIG_ACCOUNT_LEN,
            DEGEN_CLAIM_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, TOKEN_ACCOUNT_CORE_LEN,
            ROUND_STATUS_SETTLED,
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

    fn sample_round(reimburse_vrf: bool) -> [u8; ROUND_ACCOUNT_LEN] {
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
        data[48..80].copy_from_slice(&[8u8; 32]);
        RoundLifecycleView::write_winner_to_account_data(&mut data, &[9u8; 32]).unwrap();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut data, DEGEN_MODE_VRF_READY)
            .unwrap();
        if reimburse_vrf {
            RoundLifecycleView::write_vrf_payer_to_account_data(&mut data, &[10u8; 32]).unwrap();
        }
        data
    }

    fn sample_degen_claim() -> [u8; DEGEN_CLAIM_ACCOUNT_LEN] {
        let mut data = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: [8u8; 32],
            winner: [9u8; 32],
            round_id: 81,
            status: DEGEN_CLAIM_STATUS_VRF_READY,
            bump: 203,
            selected_candidate_rank: u8::MAX,
            fallback_reason: 0,
            token_index: 0,
            pool_version: 1,
            candidate_window: 10,
            padding0: [0u8; 7],
            requested_at: 777,
            fulfilled_at: 900,
            claimed_at: 0,
            fallback_after_ts: 1_000,
            payout_raw: 0,
            min_out_raw: 0,
            receiver_pre_balance: 0,
            token_mint: [0u8; 32],
            executor: [0u8; 32],
            receiver_token_ata: [0u8; 32],
            randomness: [7u8; 32],
            route_hash: [1u8; 32],
            reserved: [0u8; 32],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn token_account(mint: [u8; 32], owner: [u8; 32]) -> [u8; TOKEN_ACCOUNT_CORE_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        data[..32].copy_from_slice(&mint);
        data[32..64].copy_from_slice(&owner);
        data
    }

    #[test]
    fn claim_degen_fallback_marks_claimed_and_computes_amounts() {
        let config = sample_config();
        let mut round = sample_round(false);
        let mut degen_claim = sample_degen_claim();
        let vault_data = token_account([2u8; 32], [8u8; 32]);
        let winner_usdc_ata = token_account([2u8; 32], [9u8; 32]);
        let treasury_usdc_ata = token_account([2u8; 32], [7u8; 32]);
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(4);

        let amounts = process_anchor_bytes(
            [9u8; 32],
            [8u8; 32],
            [8u8; 32],
            1_001,
            &config,
            &mut round,
            &mut degen_claim,
            &vault_data,
            &winner_usdc_ata,
            [3u8; 32],
            &treasury_usdc_ata,
            None,
            None,
            &ix,
        )
        .unwrap();

        assert_eq!(amounts.payout, 997_500);
        assert_eq!(amounts.fee, 2_500);
        assert_eq!(amounts.vrf_reimburse, 0);
        assert_eq!(
            RoundLifecycleView::read_degen_mode_status_from_account_data(&round).unwrap(),
            DEGEN_MODE_CLAIMED
        );
        let degen_claim = DegenClaimView::read_from_account_data(&degen_claim).unwrap();
        assert_eq!(degen_claim.status, DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK);
        assert_eq!(degen_claim.fallback_reason, 4);
        assert_eq!(degen_claim.token_index, u32::MAX);
    }

    #[test]
    fn claim_degen_fallback_rejects_too_early() {
        let config = sample_config();
        let mut round = sample_round(false);
        let mut degen_claim = sample_degen_claim();
        let vault_data = token_account([2u8; 32], [8u8; 32]);
        let winner_usdc_ata = token_account([2u8; 32], [9u8; 32]);
        let treasury_usdc_ata = token_account([2u8; 32], [7u8; 32]);
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(1);

        let err = process_anchor_bytes(
            [9u8; 32],
            [8u8; 32],
            [8u8; 32],
            999,
            &config,
            &mut round,
            &mut degen_claim,
            &vault_data,
            &winner_usdc_ata,
            [3u8; 32],
            &treasury_usdc_ata,
            None,
            None,
            &ix,
        )
        .unwrap_err();

        assert_eq!(err, JackpotCompatError::DegenFallbackTooEarly.into());
    }
}
