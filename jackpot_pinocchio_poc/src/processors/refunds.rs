use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers,
    legacy_layouts::PUBKEY_LEN,
};

pub struct RefundProcessor<'a> {
    pub user_pubkey: [u8; PUBKEY_LEN],
    pub round_pubkey: [u8; PUBKEY_LEN],
    pub vault_pubkey: [u8; PUBKEY_LEN],
    pub config_account_data: &'a [u8],
    pub round_account_data: &'a mut [u8],
    pub participant_account_data: &'a mut [u8],
    pub vault_account_data: &'a [u8],
    pub user_usdc_ata_data: &'a [u8],
}

impl<'a> RefundProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<u64, ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("cancel_round") {
            return handlers::cancel_round::process_anchor_bytes(
                self.user_pubkey,
                self.round_pubkey,
                self.vault_pubkey,
                self.config_account_data,
                self.round_account_data,
                self.participant_account_data,
                self.vault_account_data,
                self.user_usdc_ata_data,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("claim_refund") {
            return handlers::claim_refund::process_anchor_bytes(
                self.user_pubkey,
                self.round_pubkey,
                self.vault_pubkey,
                self.config_account_data,
                self.round_account_data,
                self.participant_account_data,
                self.vault_account_data,
                self.user_usdc_ata_data,
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
            ConfigView, ParticipantView, RoundLifecycleView, CONFIG_ACCOUNT_LEN,
            PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ROUND_STATUS_CANCELLED,
            ROUND_STATUS_OPEN, TOKEN_ACCOUNT_CORE_LEN,
        },
    };

    fn sample_config(usdc_mint: [u8; 32]) -> [u8; CONFIG_ACCOUNT_LEN] {
        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin: [7u8; 32],
            usdc_mint,
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

    fn sample_round(status: u8, round_id: u64, vault: [u8; 32], total_usdc: u64) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status,
            bump: 201,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc,
            total_tickets: 100,
            participants_count: 1,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data[48..80].copy_from_slice(&vault);
        let mut idx = 1usize;
        while idx <= 128 {
            RoundLifecycleView::write_bit_node_to_account_data(&mut data, idx, 100).unwrap();
            idx <<= 1;
        }
        data
    }

    fn sample_participant(round: [u8; 32], user: [u8; 32], usdc_total: u64) -> [u8; PARTICIPANT_ACCOUNT_LEN] {
        let mut data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Participant"));
        ParticipantView {
            round,
            user,
            index: 1,
            bump: 202,
            tickets_total: 100,
            usdc_total,
            deposits_count: 1,
            reserved: [0u8; 16],
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
    fn routes_cancel_round() {
        let user = [1u8; 32];
        let round = [2u8; 32];
        let vault = [3u8; 32];
        let usdc_mint = [4u8; 32];
        let config = sample_config(usdc_mint);
        let mut round_data = sample_round(ROUND_STATUS_OPEN, 81, vault, 1_000_000);
        let mut participant = sample_participant(round, user, 1_000_000);
        let vault_data = token_account(usdc_mint, round);
        let user_ata = token_account(usdc_mint, user);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("cancel_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = RefundProcessor {
            user_pubkey: user,
            round_pubkey: round,
            vault_pubkey: vault,
            config_account_data: &config,
            round_account_data: &mut round_data,
            participant_account_data: &mut participant,
            vault_account_data: &vault_data,
            user_usdc_ata_data: &user_ata,
        };

        let refund = processor.process(&ix).unwrap();
        assert_eq!(refund, 1_000_000);
    }

    #[test]
    fn routes_claim_refund() {
        let user = [1u8; 32];
        let round = [2u8; 32];
        let vault = [3u8; 32];
        let usdc_mint = [4u8; 32];
        let config = sample_config(usdc_mint);
        let mut round_data = sample_round(ROUND_STATUS_CANCELLED, 81, vault, 1_000_000);
        let mut participant = sample_participant(round, user, 1_000_000);
        let vault_data = token_account(usdc_mint, round);
        let user_ata = token_account(usdc_mint, user);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_refund"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = RefundProcessor {
            user_pubkey: user,
            round_pubkey: round,
            vault_pubkey: vault,
            config_account_data: &config,
            round_account_data: &mut round_data,
            participant_account_data: &mut participant,
            vault_account_data: &vault_data,
            user_usdc_ata_data: &user_ata,
        };

        let refund = processor.process(&ix).unwrap();
        assert_eq!(refund, 1_000_000);
    }
}
