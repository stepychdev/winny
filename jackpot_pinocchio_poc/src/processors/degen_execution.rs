use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers::{self, degen_common::ClaimAmountsCompat},
    legacy_layouts::PUBKEY_LEN,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DegenExecutionEffect {
    Begin(ClaimAmountsCompat),
    Fallback(ClaimAmountsCompat),
    ClaimDegen(ClaimAmountsCompat),
    Finalize,
}

pub struct DegenExecutionProcessor<'a> {
    pub executor_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub winner_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub round_pubkey: [u8; PUBKEY_LEN],
    pub vault_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub treasury_usdc_ata_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub selected_token_mint_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub receiver_token_ata_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub vrf_payer_authority_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub now_ts: i64,
    pub config_account_data: Option<&'a [u8]>,
    pub degen_config_account_data: Option<&'a [u8]>,
    pub round_account_data: &'a mut [u8],
    pub degen_claim_account_data: &'a mut [u8],
    pub vault_account_data: Option<&'a [u8]>,
    pub executor_usdc_ata_data: Option<&'a [u8]>,
    pub winner_usdc_ata_data: Option<&'a [u8]>,
    pub treasury_usdc_ata_data: Option<&'a [u8]>,
    pub receiver_token_ata_data: Option<&'a [u8]>,
    pub vrf_payer_usdc_ata_data: Option<&'a [u8]>,
}

impl<'a> DegenExecutionProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<DegenExecutionEffect, ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("begin_degen_execution") {
            return Ok(DegenExecutionEffect::Begin(
                handlers::begin_degen_execution::process_anchor_bytes(
                    self.executor_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.round_pubkey,
                    self.vault_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.treasury_usdc_ata_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.selected_token_mint_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.receiver_token_ata_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.vrf_payer_authority_pubkey,
                    self.now_ts,
                    self.config_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.degen_config_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.round_account_data,
                    self.degen_claim_account_data,
                    self.vault_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.executor_usdc_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.treasury_usdc_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.receiver_token_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.vrf_payer_usdc_ata_data,
                    ix_data,
                )?,
            ));
        }

        if discriminator == instruction_discriminator("claim_degen_fallback") {
            return Ok(DegenExecutionEffect::Fallback(
                handlers::claim_degen_fallback::process_anchor_bytes(
                    self.winner_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.round_pubkey,
                    self.vault_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.now_ts,
                    self.config_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.round_account_data,
                    self.degen_claim_account_data,
                    self.vault_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.winner_usdc_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.treasury_usdc_ata_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.treasury_usdc_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.vrf_payer_authority_pubkey,
                    self.vrf_payer_usdc_ata_data,
                    ix_data,
                )?,
            ));
        }

        if discriminator == instruction_discriminator("claim_degen") {
            return Ok(DegenExecutionEffect::ClaimDegen(
                handlers::claim_degen::process_anchor_bytes(
                    self.winner_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.round_pubkey,
                    self.vault_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.now_ts,
                    self.config_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.round_account_data,
                    self.degen_claim_account_data,
                    self.vault_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.winner_usdc_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.treasury_usdc_ata_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                    self.treasury_usdc_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                    self.vrf_payer_authority_pubkey,
                    self.vrf_payer_usdc_ata_data,
                    ix_data,
                )?,
            ));
        }

        if discriminator == instruction_discriminator("finalize_degen_success") {
            handlers::finalize_degen_success::process_anchor_bytes(
                self.executor_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                self.receiver_token_ata_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                self.now_ts,
                self.degen_config_account_data.ok_or(ProgramError::InvalidInstructionData)?,
                self.round_account_data,
                self.degen_claim_account_data,
                self.executor_usdc_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                self.receiver_token_ata_data.ok_or(ProgramError::InvalidInstructionData)?,
                ix_data,
            )?;
            return Ok(DegenExecutionEffect::Finalize);
        }

        Err(ProgramError::InvalidInstructionData)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        degen_pool_compat::{degen_token_mint_by_index, derive_degen_candidate_index_at_rank},
        legacy_layouts::{
            ConfigView, DegenClaimView, DegenConfigView, RoundLifecycleView, TokenAccountWithAmountView,
            CONFIG_ACCOUNT_LEN, DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CONFIG_ACCOUNT_LEN,
            ROUND_ACCOUNT_LEN, DEGEN_CLAIM_STATUS_EXECUTING, DEGEN_CLAIM_STATUS_VRF_READY,
            DEGEN_MODE_EXECUTING, DEGEN_MODE_VRF_READY, ROUND_STATUS_SETTLED, TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
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

    fn sample_degen_config() -> [u8; DEGEN_CONFIG_ACCOUNT_LEN] {
        let mut data = [0u8; DEGEN_CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenConfig"));
        DegenConfigView {
            executor: [5u8; 32],
            fallback_timeout_sec: 300,
            bump: 201,
            reserved: [0u8; 27],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn sample_round(degen_mode: u8) -> [u8; ROUND_ACCOUNT_LEN] {
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
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut data, degen_mode).unwrap();
        data
    }

    fn sample_degen_claim(status: u8, token_mint: [u8; 32], receiver_token_ata: [u8; 32]) -> [u8; DEGEN_CLAIM_ACCOUNT_LEN] {
        let mut data = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: [8u8; 32],
            winner: [9u8; 32],
            round_id: 81,
            status,
            bump: 203,
            selected_candidate_rank: if status == DEGEN_CLAIM_STATUS_EXECUTING { 0 } else { u8::MAX },
            fallback_reason: 0,
            token_index: 0,
            pool_version: 1,
            candidate_window: 10,
            padding0: [0u8; 7],
            requested_at: 777,
            fulfilled_at: 900,
            claimed_at: 0,
            fallback_after_ts: 1_000,
            payout_raw: if status == DEGEN_CLAIM_STATUS_EXECUTING { 997_500 } else { 0 },
            min_out_raw: if status == DEGEN_CLAIM_STATUS_EXECUTING { 777 } else { 0 },
            receiver_pre_balance: if status == DEGEN_CLAIM_STATUS_EXECUTING { 500 } else { 0 },
            token_mint,
            executor: if status == DEGEN_CLAIM_STATUS_EXECUTING { [5u8; 32] } else { [0u8; 32] },
            receiver_token_ata,
            randomness: [7u8; 32],
            route_hash: [0u8; 32],
            reserved: [0u8; 32],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn token_account(mint: [u8; 32], owner: [u8; 32], amount: u64) -> [u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&mint);
        data[32..64].copy_from_slice(&owner);
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn routes_claim_degen_fallback() {
        let config = sample_config();
        let mut round = sample_round(DEGEN_MODE_VRF_READY);
        let mut degen_claim = sample_degen_claim(DEGEN_CLAIM_STATUS_VRF_READY, [0u8; 32], [0u8; 32]);
        let vault = token_account([2u8; 32], [8u8; 32], 1_000_000);
        let winner_ata = token_account([2u8; 32], [9u8; 32], 0);
        let treasury_ata = token_account([2u8; 32], [7u8; 32], 0);
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(3);

        let mut processor = DegenExecutionProcessor {
            executor_pubkey: None,
            winner_pubkey: Some([9u8; 32]),
            round_pubkey: [8u8; 32],
            vault_pubkey: Some([8u8; 32]),
            treasury_usdc_ata_pubkey: Some([3u8; 32]),
            selected_token_mint_pubkey: None,
            receiver_token_ata_pubkey: None,
            vrf_payer_authority_pubkey: None,
            now_ts: 1_001,
            config_account_data: Some(&config),
            degen_config_account_data: None,
            round_account_data: &mut round,
            degen_claim_account_data: &mut degen_claim,
            vault_account_data: Some(&vault),
            executor_usdc_ata_data: None,
            winner_usdc_ata_data: Some(&winner_ata),
            treasury_usdc_ata_data: Some(&treasury_ata),
            receiver_token_ata_data: None,
            vrf_payer_usdc_ata_data: None,
        };

        let effect = processor.process(&ix).unwrap();
        match effect {
            DegenExecutionEffect::Fallback(amounts) => {
                assert_eq!(amounts.payout, 997_500);
                assert_eq!(amounts.fee, 2_500);
            }
            other => panic!("unexpected effect: {other:?}"),
        }
    }

    #[test]
    fn routes_begin_degen_execution() {
        let config = sample_config();
        let degen_config = sample_degen_config();
        let mut round = sample_round(DEGEN_MODE_VRF_READY);
        let token_index = derive_degen_candidate_index_at_rank(&[7u8; 32], 1, 0);
        let token_mint = degen_token_mint_by_index(token_index).unwrap();
        let mut degen_claim = sample_degen_claim(DEGEN_CLAIM_STATUS_VRF_READY, [0u8; 32], [0u8; 32]);
        let vault = token_account([2u8; 32], [8u8; 32], 1_000_000);
        let executor_ata = token_account([2u8; 32], [5u8; 32], 0);
        let treasury_ata = token_account([2u8; 32], [7u8; 32], 0);
        let receiver_ata = token_account(token_mint, [9u8; 32], 500);
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("begin_degen_execution"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(0);
        ix.extend_from_slice(&token_index.to_le_bytes());
        ix.extend_from_slice(&777u64.to_le_bytes());
        ix.extend_from_slice(&[33u8; 32]);

        let mut processor = DegenExecutionProcessor {
            executor_pubkey: Some([5u8; 32]),
            winner_pubkey: None,
            round_pubkey: [8u8; 32],
            vault_pubkey: Some([8u8; 32]),
            treasury_usdc_ata_pubkey: Some([3u8; 32]),
            selected_token_mint_pubkey: Some(token_mint),
            receiver_token_ata_pubkey: Some([12u8; 32]),
            vrf_payer_authority_pubkey: None,
            now_ts: 1_001,
            config_account_data: Some(&config),
            degen_config_account_data: Some(&degen_config),
            round_account_data: &mut round,
            degen_claim_account_data: &mut degen_claim,
            vault_account_data: Some(&vault),
            executor_usdc_ata_data: Some(&executor_ata),
            winner_usdc_ata_data: None,
            treasury_usdc_ata_data: Some(&treasury_ata),
            receiver_token_ata_data: Some(&receiver_ata),
            vrf_payer_usdc_ata_data: None,
        };

        let effect = processor.process(&ix).unwrap();
        match effect {
            DegenExecutionEffect::Begin(amounts) => {
                assert_eq!(amounts.payout, 997_500);
            }
            other => panic!("unexpected effect: {other:?}"),
        }
    }

    #[test]
    fn routes_finalize_degen_success() {
        let degen_config = sample_degen_config();
        let mut round = sample_round(DEGEN_MODE_EXECUTING);
        let token_mint = [11u8; 32];
        let mut degen_claim = sample_degen_claim(DEGEN_CLAIM_STATUS_EXECUTING, token_mint, [12u8; 32]);
        let executor_ata = token_account([2u8; 32], [5u8; 32], 0);
        let receiver_ata = token_account(token_mint, [9u8; 32], 1_500);
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("finalize_degen_success"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = DegenExecutionProcessor {
            executor_pubkey: Some([5u8; 32]),
            winner_pubkey: None,
            round_pubkey: [8u8; 32],
            vault_pubkey: None,
            treasury_usdc_ata_pubkey: None,
            selected_token_mint_pubkey: None,
            receiver_token_ata_pubkey: Some([12u8; 32]),
            vrf_payer_authority_pubkey: None,
            now_ts: 1_234,
            config_account_data: None,
            degen_config_account_data: Some(&degen_config),
            round_account_data: &mut round,
            degen_claim_account_data: &mut degen_claim,
            vault_account_data: None,
            executor_usdc_ata_data: Some(&executor_ata),
            winner_usdc_ata_data: None,
            treasury_usdc_ata_data: None,
            receiver_token_ata_data: Some(&receiver_ata),
            vrf_payer_usdc_ata_data: None,
        };

        let effect = processor.process(&ix).unwrap();
        assert_eq!(effect, DegenExecutionEffect::Finalize);
    }
}
