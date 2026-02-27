use pinocchio::error::ProgramError;

use crate::{
    degen_pool_compat::{degen_token_mint_by_index, derive_degen_candidate_index_at_rank, pool_version},
    errors::JackpotCompatError,
    handlers::degen_common::{ClaimAmountsCompat, compute_claim_amounts, map_layout_err},
    instruction_layouts::BeginDegenExecutionArgsCompat,
    legacy_layouts::{
        ConfigView, DegenClaimView, DegenConfigView, RoundLifecycleView, TokenAccountCoreView,
        TokenAccountWithAmountView, DEGEN_CLAIM_STATUS_EXECUTING, DEGEN_CLAIM_STATUS_VRF_READY,
        DEGEN_FALLBACK_REASON_NONE, DEGEN_MODE_EXECUTING, DEGEN_MODE_VRF_READY, ROUND_STATUS_SETTLED,
    },
};

pub fn process_anchor_bytes(
    executor_pubkey: [u8; 32],
    round_pubkey: [u8; 32],
    vault_pubkey: [u8; 32],
    treasury_usdc_ata_pubkey: [u8; 32],
    selected_token_mint_pubkey: [u8; 32],
    receiver_token_ata_pubkey: [u8; 32],
    vrf_payer_authority_pubkey: Option<[u8; 32]>,
    now_ts: i64,
    config_account_data: &[u8],
    degen_config_account_data: &[u8],
    round_account_data: &mut [u8],
    degen_claim_account_data: &mut [u8],
    vault_account_data: &[u8],
    executor_usdc_ata_data: &[u8],
    treasury_usdc_ata_data: &[u8],
    receiver_token_ata_data: &[u8],
    vrf_payer_usdc_ata_data: Option<&[u8]>,
    ix_data: &[u8],
) -> Result<ClaimAmountsCompat, ProgramError> {
    let args =
        BeginDegenExecutionArgsCompat::parse(ix_data).map_err(|_| ProgramError::InvalidInstructionData)?;
    let config = ConfigView::read_from_account_data(config_account_data).map_err(map_layout_err)?;
    let degen_config = DegenConfigView::read_from_account_data(degen_config_account_data)
        .map_err(map_layout_err)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data).map_err(map_layout_err)?;
    let mut degen_claim =
        DegenClaimView::read_from_account_data(degen_claim_account_data).map_err(map_layout_err)?;
    let vault = TokenAccountCoreView::read_from_account_data(vault_account_data).map_err(map_layout_err)?;
    let executor_usdc_ata =
        TokenAccountWithAmountView::read_from_account_data(executor_usdc_ata_data).map_err(map_layout_err)?;
    let treasury_usdc_ata =
        TokenAccountCoreView::read_from_account_data(treasury_usdc_ata_data).map_err(map_layout_err)?;
    let receiver_token_ata =
        TokenAccountWithAmountView::read_from_account_data(receiver_token_ata_data).map_err(map_layout_err)?;

    if degen_config.executor != executor_pubkey {
        return Err(JackpotCompatError::UnauthorizedDegenExecutor.into());
    }
    if executor_usdc_ata.owner != executor_pubkey || executor_usdc_ata.mint != config.usdc_mint || executor_usdc_ata.amount != 0 {
        return Err(JackpotCompatError::InvalidDegenExecutorAta.into());
    }
    if args.candidate_rank >= degen_claim.candidate_window {
        return Err(JackpotCompatError::InvalidDegenCandidate.into());
    }
    if degen_claim.pool_version != pool_version() {
        return Err(JackpotCompatError::InvalidDegenCandidate.into());
    }
    let expected_index = derive_degen_candidate_index_at_rank(
        &degen_claim.randomness,
        degen_claim.pool_version,
        args.candidate_rank as usize,
    );
    if expected_index != args.token_index {
        return Err(JackpotCompatError::InvalidDegenCandidate.into());
    }
    let expected_token_mint =
        degen_token_mint_by_index(args.token_index).ok_or::<ProgramError>(JackpotCompatError::InvalidDegenCandidate.into())?;
    if selected_token_mint_pubkey != expected_token_mint {
        return Err(JackpotCompatError::InvalidDegenCandidate.into());
    }
    if round.round_id != args.round_id {
        return Err(ProgramError::InvalidInstructionData);
    }
    if round.status != ROUND_STATUS_SETTLED {
        return Err(JackpotCompatError::RoundNotSettled.into());
    }
    if RoundLifecycleView::read_degen_mode_status_from_account_data(round_account_data).map_err(map_layout_err)?
        != DEGEN_MODE_VRF_READY
    {
        return Err(JackpotCompatError::DegenVrfNotReady.into());
    }
    if degen_claim.status != DEGEN_CLAIM_STATUS_VRF_READY {
        return Err(JackpotCompatError::DegenVrfNotReady.into());
    }
    if degen_claim.round != round_pubkey || degen_claim.round_id != args.round_id {
        return Err(JackpotCompatError::InvalidDegenClaim.into());
    }
    if vault_pubkey != RoundLifecycleView::read_vault_pubkey_from_account_data(round_account_data).map_err(map_layout_err)?
        || vault.mint != config.usdc_mint
        || vault.owner != round_pubkey
    {
        return Err(JackpotCompatError::InvalidVault.into());
    }
    if treasury_usdc_ata_pubkey != config.treasury_usdc_ata || treasury_usdc_ata.mint != config.usdc_mint {
        return Err(JackpotCompatError::InvalidTreasury.into());
    }
    if receiver_token_ata.owner != degen_claim.winner
        || receiver_token_ata.mint != selected_token_mint_pubkey
    {
        return Err(JackpotCompatError::InvalidDegenReceiverAta.into());
    }

    let reimburse_vrf = RoundLifecycleView::read_vrf_payer_from_account_data(round_account_data).map_err(map_layout_err)? != [0u8; 32]
        && RoundLifecycleView::read_vrf_reimbursed_from_account_data(round_account_data).map_err(map_layout_err)? == 0;

    if reimburse_vrf {
        let expected_vrf_payer = RoundLifecycleView::read_vrf_payer_from_account_data(round_account_data).map_err(map_layout_err)?;
        let authority = vrf_payer_authority_pubkey.ok_or::<ProgramError>(JackpotCompatError::InvalidVrfPayerAta.into())?;
        if authority != expected_vrf_payer {
            return Err(JackpotCompatError::InvalidVrfPayerAta.into());
        }
        let vrf_payer_usdc_ata_data = vrf_payer_usdc_ata_data.ok_or::<ProgramError>(JackpotCompatError::InvalidVrfPayerAta.into())?;
        let vrf_payer_usdc_ata = TokenAccountCoreView::read_from_account_data(vrf_payer_usdc_ata_data).map_err(map_layout_err)?;
        if vrf_payer_usdc_ata.mint != config.usdc_mint || vrf_payer_usdc_ata.owner != authority {
            return Err(JackpotCompatError::InvalidVrfPayerAta.into());
        }
    }

    let amounts = compute_claim_amounts(round.total_usdc, config.fee_bps, reimburse_vrf)?;

    RoundLifecycleView::write_degen_mode_status_to_account_data(round_account_data, DEGEN_MODE_EXECUTING)
        .map_err(map_layout_err)?;
    if amounts.vrf_reimburse > 0 {
        RoundLifecycleView::write_vrf_reimbursed_to_account_data(round_account_data, 1).map_err(map_layout_err)?;
    }

    degen_claim.status = DEGEN_CLAIM_STATUS_EXECUTING;
    degen_claim.selected_candidate_rank = args.candidate_rank;
    degen_claim.fallback_reason = DEGEN_FALLBACK_REASON_NONE;
    degen_claim.token_index = args.token_index;
    degen_claim.token_mint = expected_token_mint;
    degen_claim.executor = executor_pubkey;
    degen_claim.receiver_token_ata = receiver_token_ata_pubkey;
    degen_claim.receiver_pre_balance = receiver_token_ata.amount;
    degen_claim.min_out_raw = args.min_out_raw;
    degen_claim.payout_raw = amounts.payout;
    degen_claim.route_hash = args.route_hash;
    degen_claim.claimed_at = 0;
    degen_claim.fulfilled_at = now_ts;
    degen_claim.write_to_account_data(degen_claim_account_data).map_err(map_layout_err)?;

    Ok(amounts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        degen_pool_compat::{degen_token_mint_by_index, derive_degen_candidate_index_at_rank},
        legacy_layouts::{
            ConfigView, DegenClaimView, DegenConfigView, RoundLifecycleView, TokenAccountWithAmountView,
            CONFIG_ACCOUNT_LEN, DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_SETTLED, DEGEN_MODE_VRF_READY, DEGEN_CLAIM_STATUS_VRF_READY, TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
        },
    };

    fn token_account(mint: [u8; 32], owner: [u8; 32], amount: u64) -> [u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&mint);
        data[32..64].copy_from_slice(&owner);
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn begin_degen_execution_marks_executing_and_returns_amounts() {
        let executor = [5u8; 32];
        let round_key = [8u8; 32];
        let winner = [9u8; 32];
        let treasury = [3u8; 32];
        let receiver_token_ata = [12u8; 32];
        let usdc_mint = [2u8; 32];
        let token_index = derive_degen_candidate_index_at_rank(&[7u8; 32], 1, 0);
        let selected_token_mint = degen_token_mint_by_index(token_index).unwrap();

        let mut config = [0u8; CONFIG_ACCOUNT_LEN];
        config[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin: [7u8; 32],
            usdc_mint,
            treasury_usdc_ata: treasury,
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
        .write_to_account_data(&mut config)
        .unwrap();

        let mut degen_config = [0u8; DEGEN_CONFIG_ACCOUNT_LEN];
        degen_config[..8].copy_from_slice(&account_discriminator("DegenConfig"));
        DegenConfigView {
            executor,
            fallback_timeout_sec: 300,
            bump: 201,
            reserved: [0u8; 27],
        }
        .write_to_account_data(&mut degen_config)
        .unwrap();

        let mut round = [0u8; ROUND_ACCOUNT_LEN];
        round[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id: 81,
            status: ROUND_STATUS_SETTLED,
            bump: 202,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_000_000,
            total_tickets: 200,
            participants_count: 2,
        }
        .write_to_account_data(&mut round)
        .unwrap();
        round[48..80].copy_from_slice(&round_key);
        RoundLifecycleView::write_winner_to_account_data(&mut round, &winner).unwrap();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut round, DEGEN_MODE_VRF_READY).unwrap();

        let mut degen_claim = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        degen_claim[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: round_key,
            winner,
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
            fallback_after_ts: 1_200,
            payout_raw: 0,
            min_out_raw: 0,
            receiver_pre_balance: 0,
            token_mint: [0u8; 32],
            executor: [0u8; 32],
            receiver_token_ata: [0u8; 32],
            randomness: [7u8; 32],
            route_hash: [0u8; 32],
            reserved: [0u8; 32],
        }
        .write_to_account_data(&mut degen_claim)
        .unwrap();

        let vault = token_account(usdc_mint, round_key, 1_000_000);
        let executor_ata = token_account(usdc_mint, executor, 0);
        let treasury_ata = token_account(usdc_mint, [7u8; 32], 0);
        let receiver_ata = token_account(selected_token_mint, winner, 500);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("begin_degen_execution"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(0);
        ix.extend_from_slice(&token_index.to_le_bytes());
        ix.extend_from_slice(&777u64.to_le_bytes());
        ix.extend_from_slice(&[33u8; 32]);

        let amounts = process_anchor_bytes(
            executor,
            round_key,
            round_key,
            treasury,
            selected_token_mint,
            receiver_token_ata,
            None,
            1_001,
            &config,
            &degen_config,
            &mut round,
            &mut degen_claim,
            &vault,
            &executor_ata,
            &treasury_ata,
            &receiver_ata,
            None,
            &ix,
        )
        .unwrap();

        assert_eq!(amounts.payout, 997_500);
        assert_eq!(amounts.fee, 2_500);
        assert_eq!(RoundLifecycleView::read_degen_mode_status_from_account_data(&round).unwrap(), 3);
        let claim = DegenClaimView::read_from_account_data(&degen_claim).unwrap();
        assert_eq!(claim.status, 3);
        assert_eq!(claim.selected_candidate_rank, 0);
        assert_eq!(claim.token_index, token_index);
        assert_eq!(claim.token_mint, selected_token_mint);
        assert_eq!(claim.executor, executor);
        assert_eq!(claim.receiver_token_ata, receiver_token_ata);
        assert_eq!(claim.receiver_pre_balance, 500);
        assert_eq!(claim.min_out_raw, 777);
        assert_eq!(claim.payout_raw, 997_500);
        assert_eq!(claim.route_hash, [33u8; 32]);
        assert_eq!(claim.fulfilled_at, 1_001);
    }
}
