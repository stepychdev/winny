use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers,
    legacy_layouts::PUBKEY_LEN,
};

pub struct VrfProcessor<'a> {
    pub payer_pubkey: [u8; PUBKEY_LEN],
    pub config_account_data: &'a [u8],
    pub round_account_data: &'a mut [u8],
}

impl<'a> VrfProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<(), ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("request_vrf") {
            return handlers::request_vrf::process_anchor_bytes(
                self.payer_pubkey,
                self.config_account_data,
                self.round_account_data,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("vrf_callback") {
            return handlers::vrf_callback::process_anchor_bytes(
                self.config_account_data,
                self.round_account_data,
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
            ConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_LOCKED, ROUND_STATUS_SETTLED, ROUND_STATUS_VRF_REQUESTED,
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

    fn sample_round(status: u8) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id: 81,
            status,
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
        data[176..208].copy_from_slice(&[11u8; 32]);
        data[208..240].copy_from_slice(&[22u8; 32]);
        RoundLifecycleView::write_bit_node_to_account_data(&mut data, 1, 100).unwrap();
        let mut idx = 2usize;
        while idx <= 128 {
            RoundLifecycleView::write_bit_node_to_account_data(&mut data, idx, 200).unwrap();
            idx <<= 1;
        }
        data
    }

    #[test]
    fn routes_request_vrf() {
        let config = sample_config();
        let mut round_data = sample_round(ROUND_STATUS_LOCKED);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_vrf"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = VrfProcessor {
            payer_pubkey: [9u8; 32],
            config_account_data: &config,
            round_account_data: &mut round_data,
        };

        processor.process(&ix).unwrap();
        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_VRF_REQUESTED);
    }

    #[test]
    fn routes_vrf_callback() {
        let config = sample_config();
        let mut round_data = sample_round(ROUND_STATUS_VRF_REQUESTED);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("vrf_callback"));
        ix.extend_from_slice(&[0u8; 32]);

        let mut processor = VrfProcessor {
            payer_pubkey: [0u8; 32],
            config_account_data: &config,
            round_account_data: &mut round_data,
        };

        processor.process(&ix).unwrap();
        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_SETTLED);
    }
}
