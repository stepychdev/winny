use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers,
    legacy_layouts::PUBKEY_LEN,
};

pub struct DegenVrfProcessor<'a> {
    pub winner_pubkey: [u8; PUBKEY_LEN],
    pub round_pubkey: [u8; PUBKEY_LEN],
    pub degen_claim_bump: u8,
    pub now_ts: i64,
    pub config_account_data: &'a [u8],
    pub round_account_data: &'a mut [u8],
    pub degen_claim_account_data: &'a mut [u8],
    pub degen_config_account_data: Option<&'a [u8]>,
}

impl<'a> DegenVrfProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<(), ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("request_degen_vrf") {
            return handlers::request_degen_vrf::process_anchor_bytes(
                self.winner_pubkey,
                self.round_pubkey,
                self.degen_claim_bump,
                self.now_ts,
                self.round_account_data,
                self.degen_claim_account_data,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("degen_vrf_callback") {
            return handlers::degen_vrf_callback::process_anchor_bytes(
                self.round_pubkey,
                self.now_ts,
                self.config_account_data,
                self.round_account_data,
                self.degen_claim_account_data,
                self.degen_config_account_data,
                ix_data,
            );
        }

        Err(ProgramError::InvalidInstructionData)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, DegenClaimView, RoundLifecycleView, CONFIG_ACCOUNT_LEN,
            DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CLAIM_STATUS_VRF_READY,
            DEGEN_CLAIM_STATUS_VRF_REQUESTED, DEGEN_CANDIDATE_WINDOW, ROUND_ACCOUNT_LEN,
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
        data
    }

    fn empty_degen_claim() -> [u8; DEGEN_CLAIM_ACCOUNT_LEN] {
        let mut data = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
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
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn ready_degen_claim() -> [u8; DEGEN_CLAIM_ACCOUNT_LEN] {
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
            requested_at: 100,
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
    fn routes_request_degen_vrf() {
        let config = sample_config();
        let mut round_data = sample_round();
        let mut degen_claim = empty_degen_claim();

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_degen_vrf"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = DegenVrfProcessor {
            winner_pubkey: [9u8; 32],
            round_pubkey: [8u8; 32],
            degen_claim_bump: 203,
            now_ts: 777,
            config_account_data: &config,
            round_account_data: &mut round_data,
            degen_claim_account_data: &mut degen_claim,
            degen_config_account_data: None,
        };

        processor.process(&ix).unwrap();
        let parsed = DegenClaimView::read_from_account_data(&degen_claim).unwrap();
        assert_eq!(parsed.status, DEGEN_CLAIM_STATUS_VRF_REQUESTED);
    }

    #[test]
    fn routes_degen_vrf_callback() {
        let config = sample_config();
        let mut round_data = sample_round();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut round_data, 1).unwrap();
        let mut degen_claim = ready_degen_claim();

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("degen_vrf_callback"));
        ix.extend_from_slice(&[7u8; 32]);

        let mut processor = DegenVrfProcessor {
            winner_pubkey: [0u8; 32],
            round_pubkey: [8u8; 32],
            degen_claim_bump: 203,
            now_ts: 1_000,
            config_account_data: &config,
            round_account_data: &mut round_data,
            degen_claim_account_data: &mut degen_claim,
            degen_config_account_data: None,
        };

        processor.process(&ix).unwrap();
        let parsed = DegenClaimView::read_from_account_data(&degen_claim).unwrap();
        assert_eq!(parsed.status, DEGEN_CLAIM_STATUS_VRF_READY);
    }
}
