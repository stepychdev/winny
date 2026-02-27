use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers,
};

pub struct DepositProcessor<'a> {
    pub user_pubkey: [u8; 32],
    pub round_pubkey: [u8; 32],
    pub vault_pubkey: [u8; 32],
    pub participant_bump: u8,
    pub current_unix_timestamp: i64,
    pub config_account_data: &'a [u8],
    pub round_account_data: &'a mut [u8],
    pub participant_account_data: &'a mut [u8],
    pub user_usdc_ata_data: &'a [u8],
    pub vault_account_data: &'a [u8],
}

impl<'a> DepositProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<u64, ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("deposit_any") {
            return handlers::deposit_any::process_anchor_bytes(
                self.user_pubkey,
                self.round_pubkey,
                self.vault_pubkey,
                self.participant_bump,
                self.current_unix_timestamp,
                self.config_account_data,
                self.round_account_data,
                self.participant_account_data,
                self.user_usdc_ata_data,
                self.vault_account_data,
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
            ConfigView, RoundLifecycleView, TokenAccountWithAmountView, CONFIG_ACCOUNT_LEN,
            PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ROUND_STATUS_OPEN,
            TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
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

    fn sample_round(round_id: u64, vault_pubkey: [u8; 32]) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status: ROUND_STATUS_OPEN,
            bump: 201,
            start_ts: 10,
            end_ts: 0,
            first_deposit_ts: 0,
            total_usdc: 0,
            total_tickets: 0,
            participants_count: 0,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        RoundLifecycleView::write_vault_pubkey_to_account_data(&mut data, &vault_pubkey).unwrap();
        data
    }

    fn token_account(amount: u64, owner: [u8; 32]) -> [u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&[2u8; 32]);
        data[32..64].copy_from_slice(&owner);
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn routes_deposit_any() {
        let user = [4u8; 32];
        let round = [8u8; 32];
        let vault = [9u8; 32];
        let config = sample_config();
        let mut round_data = sample_round(81, vault);
        let mut participant_data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        let user_ata = token_account(40_000, user);
        let vault_ata = token_account(0, round);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("deposit_any"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());

        let mut processor = DepositProcessor {
            user_pubkey: user,
            round_pubkey: round,
            vault_pubkey: vault,
            participant_bump: 99,
            current_unix_timestamp: 1_000,
            config_account_data: &config,
            round_account_data: &mut round_data,
            participant_account_data: &mut participant_data,
            user_usdc_ata_data: &user_ata,
            vault_account_data: &vault_ata,
        };

        let delta = processor.process(&ix).unwrap();
        assert_eq!(delta, 20_000);
        let participant = crate::legacy_layouts::ParticipantView::read_from_account_data(&participant_data).unwrap();
        assert_eq!(participant.index, 1);
    }
}
