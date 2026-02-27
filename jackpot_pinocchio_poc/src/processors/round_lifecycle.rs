use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers,
    legacy_layouts::PUBKEY_LEN,
};

pub struct RoundLifecycleProcessor<'a> {
    pub caller_pubkey: [u8; PUBKEY_LEN],
    pub round_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub round_bump: Option<u8>,
    pub vault_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub usdc_mint_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub config_account_data: &'a [u8],
    pub round_account_data: &'a mut [u8],
    pub vault_account_data: Option<&'a [u8]>,
    pub current_unix_timestamp: i64,
}

impl<'a> RoundLifecycleProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<(), ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("lock_round") {
            return handlers::lock_round::process_anchor_bytes(
                self.caller_pubkey,
                self.config_account_data,
                self.round_account_data,
                self.current_unix_timestamp,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("admin_force_cancel") {
            return handlers::admin_force_cancel::process_anchor_bytes(
                self.caller_pubkey,
                self.config_account_data,
                self.round_account_data,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("start_round") {
            return handlers::start_round::process_anchor_bytes(
                self.round_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                self.vault_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                self.usdc_mint_pubkey.ok_or(ProgramError::InvalidInstructionData)?,
                self.round_bump.ok_or(ProgramError::InvalidInstructionData)?,
                self.current_unix_timestamp,
                self.config_account_data,
                self.round_account_data,
                self.vault_account_data.ok_or(ProgramError::InvalidInstructionData)?,
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
            ROUND_STATUS_CANCELLED, ROUND_STATUS_LOCKED, ROUND_STATUS_OPEN,
        },
    };

    fn sample_config(admin: [u8; 32]) -> [u8; CONFIG_ACCOUNT_LEN] {
        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin,
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
        data
    }

    #[test]
    fn routes_lock_round() {
        let mut round_data = sample_round(ROUND_STATUS_OPEN);
        let config_data = sample_config([7u8; 32]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("lock_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = RoundLifecycleProcessor {
            caller_pubkey: [9u8; 32],
            round_pubkey: None,
            round_bump: None,
            vault_pubkey: None,
            usdc_mint_pubkey: None,
            config_account_data: &config_data,
            round_account_data: &mut round_data,
            vault_account_data: None,
            current_unix_timestamp: 130,
        };

        processor.process(&ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_LOCKED);
    }

    #[test]
    fn routes_admin_force_cancel() {
        let admin = [7u8; 32];
        let config_data = sample_config(admin);
        let mut round_data = sample_round(ROUND_STATUS_OPEN);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("admin_force_cancel"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = RoundLifecycleProcessor {
            caller_pubkey: admin,
            round_pubkey: None,
            round_bump: None,
            vault_pubkey: None,
            usdc_mint_pubkey: None,
            config_account_data: &config_data,
            round_account_data: &mut round_data,
            vault_account_data: None,
            current_unix_timestamp: 10,
        };

        processor.process(&ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_CANCELLED);
    }

    #[test]
    fn routes_start_round() {
        let round_pubkey = [8u8; 32];
        let vault_pubkey = [9u8; 32];
        let usdc_mint = [2u8; 32];
        let config_data = sample_config([7u8; 32]);
        let mut round_data = [0u8; ROUND_ACCOUNT_LEN];
        let mut vault_data = [0u8; crate::legacy_layouts::TOKEN_ACCOUNT_CORE_LEN];
        vault_data[..32].copy_from_slice(&usdc_mint);
        vault_data[32..64].copy_from_slice(&round_pubkey);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("start_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = RoundLifecycleProcessor {
            caller_pubkey: [9u8; 32],
            round_pubkey: Some(round_pubkey),
            round_bump: Some(201),
            vault_pubkey: Some(vault_pubkey),
            usdc_mint_pubkey: Some(usdc_mint),
            config_account_data: &config_data,
            round_account_data: &mut round_data,
            vault_account_data: Some(&vault_data),
            current_unix_timestamp: 130,
        };

        processor.process(&ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.round_id, 81);
        assert_eq!(parsed.status, ROUND_STATUS_OPEN);
        assert_eq!(parsed.start_ts, 130);
        assert_eq!(
            RoundLifecycleView::read_vault_pubkey_from_account_data(&round_data).unwrap(),
            vault_pubkey,
        );
    }
}
