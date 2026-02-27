use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    handlers::degen_common::map_layout_err,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        DegenClaimView, DegenConfigView, RoundLifecycleView, TokenAccountWithAmountView,
        DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED, DEGEN_CLAIM_STATUS_EXECUTING, DEGEN_MODE_CLAIMED,
        DEGEN_MODE_EXECUTING, ROUND_STATUS_CLAIMED, ROUND_STATUS_SETTLED,
    },
};

pub fn process_anchor_bytes(
    executor_pubkey: [u8; 32],
    receiver_token_ata_pubkey: [u8; 32],
    now_ts: i64,
    degen_config_account_data: &[u8],
    round_account_data: &mut [u8],
    degen_claim_account_data: &mut [u8],
    executor_usdc_ata_data: &[u8],
    receiver_token_ata_data: &[u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let round_id = parse_round_id_ix(ix_data, "finalize_degen_success")
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let degen_config = DegenConfigView::read_from_account_data(degen_config_account_data)
        .map_err(map_layout_err)?;
    let mut round = RoundLifecycleView::read_from_account_data(round_account_data).map_err(map_layout_err)?;
    let mut degen_claim = DegenClaimView::read_from_account_data(degen_claim_account_data).map_err(map_layout_err)?;
    let executor_usdc_ata = TokenAccountWithAmountView::read_from_account_data(executor_usdc_ata_data)
        .map_err(map_layout_err)?;
    let receiver_token_ata = TokenAccountWithAmountView::read_from_account_data(receiver_token_ata_data)
        .map_err(map_layout_err)?;

    if degen_config.executor != executor_pubkey || degen_claim.executor != executor_pubkey {
        return Err(JackpotCompatError::UnauthorizedDegenExecutor.into());
    }
    if degen_claim.status != DEGEN_CLAIM_STATUS_EXECUTING {
        return Err(JackpotCompatError::InvalidDegenExecutionState.into());
    }
    if round.round_id != round_id {
        return Err(ProgramError::InvalidInstructionData);
    }
    if round.status != ROUND_STATUS_SETTLED {
        return Err(JackpotCompatError::RoundNotSettled.into());
    }
    if RoundLifecycleView::read_degen_mode_status_from_account_data(round_account_data).map_err(map_layout_err)?
        != DEGEN_MODE_EXECUTING
    {
        return Err(JackpotCompatError::InvalidDegenExecutionState.into());
    }
    if receiver_token_ata_pubkey != degen_claim.receiver_token_ata
        || receiver_token_ata.owner != degen_claim.winner
        || receiver_token_ata.mint != degen_claim.token_mint
    {
        return Err(JackpotCompatError::InvalidDegenReceiverAta.into());
    }
    let expected_min_balance = degen_claim
        .receiver_pre_balance
        .checked_add(degen_claim.min_out_raw)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    if receiver_token_ata.amount < expected_min_balance {
        return Err(JackpotCompatError::DegenOutputNotReceived.into());
    }
    if executor_usdc_ata.owner != executor_pubkey || executor_usdc_ata.amount != 0 {
        return Err(JackpotCompatError::InvalidDegenExecutorAta.into());
    }

    round.status = ROUND_STATUS_CLAIMED;
    round.write_to_account_data(round_account_data).map_err(map_layout_err)?;
    RoundLifecycleView::write_degen_mode_status_to_account_data(round_account_data, DEGEN_MODE_CLAIMED)
        .map_err(map_layout_err)?;

    degen_claim.status = DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED;
    degen_claim.claimed_at = now_ts;
    degen_claim.write_to_account_data(degen_claim_account_data).map_err(map_layout_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            DegenClaimView, DegenConfigView, RoundLifecycleView, TokenAccountWithAmountView,
            DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            DEGEN_CLAIM_STATUS_EXECUTING, ROUND_STATUS_SETTLED, TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
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
    fn finalize_degen_success_marks_claimed_swapped() {
        let executor = [5u8; 32];
        let round_key = [8u8; 32];
        let winner = [9u8; 32];
        let token_mint = [11u8; 32];
        let receiver_token_ata = [12u8; 32];

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
        RoundLifecycleView::write_winner_to_account_data(&mut round, &winner).unwrap();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut round, 3).unwrap();

        let mut degen_claim = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        degen_claim[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: round_key,
            winner,
            round_id: 81,
            status: DEGEN_CLAIM_STATUS_EXECUTING,
            bump: 203,
            selected_candidate_rank: 4,
            fallback_reason: 0,
            token_index: 123,
            pool_version: 1,
            candidate_window: 10,
            padding0: [0u8; 7],
            requested_at: 777,
            fulfilled_at: 900,
            claimed_at: 0,
            fallback_after_ts: 1_200,
            payout_raw: 997_500,
            min_out_raw: 777,
            receiver_pre_balance: 500,
            token_mint,
            executor,
            receiver_token_ata,
            randomness: [7u8; 32],
            route_hash: [33u8; 32],
            reserved: [0u8; 32],
        }
        .write_to_account_data(&mut degen_claim)
        .unwrap();

        let executor_ata = token_account([2u8; 32], executor, 0);
        let receiver_ata = token_account(token_mint, winner, 1_500);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("finalize_degen_success"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_anchor_bytes(
            executor,
            receiver_token_ata,
            1_234,
            &degen_config,
            &mut round,
            &mut degen_claim,
            &executor_ata,
            &receiver_ata,
            &ix,
        )
        .unwrap();

        let round_view = RoundLifecycleView::read_from_account_data(&round).unwrap();
        assert_eq!(round_view.status, 4);
        assert_eq!(RoundLifecycleView::read_degen_mode_status_from_account_data(&round).unwrap(), 4);
        let claim = DegenClaimView::read_from_account_data(&degen_claim).unwrap();
        assert_eq!(claim.status, 4);
        assert_eq!(claim.claimed_at, 1_234);
    }
}
