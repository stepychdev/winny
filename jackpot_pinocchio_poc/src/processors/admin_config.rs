use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers,
    legacy_layouts::PUBKEY_LEN,
};

pub struct AdminConfigProcessor<'a> {
    pub admin_pubkey: [u8; PUBKEY_LEN],
    pub config_account_data: &'a mut [u8],
    pub config_bump: Option<u8>,
    pub degen_config_account_data: Option<&'a mut [u8]>,
    pub degen_config_bump: Option<u8>,
    pub new_treasury_ata_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub new_treasury_token_account_data: Option<&'a [u8]>,
    pub expected_owner_pubkey: Option<[u8; PUBKEY_LEN]>,
}

impl<'a> AdminConfigProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<(), ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("init_config") {
            let config_bump = self
                .config_bump
                .ok_or(ProgramError::NotEnoughAccountKeys)?;

            return handlers::init_config::process_anchor_bytes(
                self.admin_pubkey,
                self.config_account_data,
                config_bump,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("upsert_degen_config") {
            let degen_config_account_data = self
                .degen_config_account_data
                .as_deref_mut()
                .ok_or(ProgramError::NotEnoughAccountKeys)?;
            let degen_config_bump = self
                .degen_config_bump
                .ok_or(ProgramError::NotEnoughAccountKeys)?;

            return handlers::upsert_degen_config::process_anchor_bytes(
                self.admin_pubkey,
                self.config_account_data,
                degen_config_account_data,
                degen_config_bump,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("update_config") {
            return handlers::update_config::process_anchor_bytes(
                self.admin_pubkey,
                self.config_account_data,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("transfer_admin") {
            return handlers::transfer_admin::process_anchor_bytes(
                self.admin_pubkey,
                self.config_account_data,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("set_treasury_usdc_ata") {
            let new_treasury_ata_pubkey = self
                .new_treasury_ata_pubkey
                .ok_or(ProgramError::NotEnoughAccountKeys)?;
            let new_treasury_token_account_data = self
                .new_treasury_token_account_data
                .ok_or(ProgramError::NotEnoughAccountKeys)?;
            let expected_owner_pubkey = self
                .expected_owner_pubkey
                .ok_or(ProgramError::NotEnoughAccountKeys)?;

            return handlers::set_treasury_usdc_ata::process_anchor_bytes(
                self.admin_pubkey,
                self.config_account_data,
                new_treasury_ata_pubkey,
                new_treasury_token_account_data,
                expected_owner_pubkey,
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
            ConfigView, DegenConfigView, TokenAccountCoreView, CONFIG_ACCOUNT_LEN,
            DEGEN_CONFIG_ACCOUNT_LEN, TOKEN_ACCOUNT_CORE_LEN,
        },
    };

    fn sample_config(admin: [u8; 32]) -> [u8; CONFIG_ACCOUNT_LEN] {
        let view = ConfigView {
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
        };

        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        view.write_to_account_data(&mut data).unwrap();
        data
    }

    #[test]
    fn routes_upsert_degen_config() {
        let admin = [7u8; 32];
        let mut config_data = sample_config(admin);
        let mut degen_data = [0u8; DEGEN_CONFIG_ACCOUNT_LEN];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
        ix.extend_from_slice(&[9u8; 32]);
        ix.extend_from_slice(&0u32.to_le_bytes());

        let mut processor = AdminConfigProcessor {
            admin_pubkey: admin,
            config_account_data: &mut config_data,
            config_bump: None,
            degen_config_account_data: Some(&mut degen_data),
            degen_config_bump: Some(201),
            new_treasury_ata_pubkey: None,
            new_treasury_token_account_data: None,
            expected_owner_pubkey: None,
        };

        processor.process(&ix).unwrap();

        let parsed = DegenConfigView::read_from_account_data(&degen_data).unwrap();
        assert_eq!(parsed.executor, [9u8; 32]);
        assert_eq!(parsed.fallback_timeout_sec, 300);
    }

    #[test]
    fn routes_update_config() {
        let admin = [7u8; 32];
        let mut config_data = sample_config(admin);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("update_config"));
        ix.push(1);
        ix.extend_from_slice(&50u16.to_le_bytes());
        ix.push(0);
        ix.push(0);
        ix.push(0);
        ix.push(0);
        ix.push(0);
        ix.push(0);

        let mut processor = AdminConfigProcessor {
            admin_pubkey: admin,
            config_account_data: &mut config_data,
            config_bump: None,
            degen_config_account_data: None,
            degen_config_bump: None,
            new_treasury_ata_pubkey: None,
            new_treasury_token_account_data: None,
            expected_owner_pubkey: None,
        };

        processor.process(&ix).unwrap();

        let parsed = ConfigView::read_from_account_data(&config_data).unwrap();
        assert_eq!(parsed.fee_bps, 50);
    }

    #[test]
    fn routes_transfer_admin() {
        let admin = [7u8; 32];
        let mut config_data = sample_config(admin);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("transfer_admin"));
        ix.extend_from_slice(&[8u8; 32]);

        let mut processor = AdminConfigProcessor {
            admin_pubkey: admin,
            config_account_data: &mut config_data,
            config_bump: None,
            degen_config_account_data: None,
            degen_config_bump: None,
            new_treasury_ata_pubkey: None,
            new_treasury_token_account_data: None,
            expected_owner_pubkey: None,
        };

        processor.process(&ix).unwrap();

        let parsed = ConfigView::read_from_account_data(&config_data).unwrap();
        assert_eq!(parsed.admin, [8u8; 32]);
    }

    #[test]
    fn routes_set_treasury() {
        let admin = [7u8; 32];
        let mut config_data = sample_config(admin);
        let new_treasury_pubkey = [4u8; 32];
        let expected_owner = [5u8; 32];

        let mut token_account = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        let token_core = TokenAccountCoreView {
            mint: [2u8; 32],
            owner: expected_owner,
        };
        token_account[..32].copy_from_slice(&token_core.mint);
        token_account[32..64].copy_from_slice(&token_core.owner);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("set_treasury_usdc_ata"));

        let mut processor = AdminConfigProcessor {
            admin_pubkey: admin,
            config_account_data: &mut config_data,
            config_bump: None,
            degen_config_account_data: None,
            degen_config_bump: None,
            new_treasury_ata_pubkey: Some(new_treasury_pubkey),
            new_treasury_token_account_data: Some(&token_account),
            expected_owner_pubkey: Some(expected_owner),
        };

        processor.process(&ix).unwrap();

        let parsed = ConfigView::read_from_account_data(&config_data).unwrap();
        assert_eq!(parsed.treasury_usdc_ata, new_treasury_pubkey);
    }

    #[test]
    fn routes_init_config() {
        let admin = [7u8; 32];
        let mut config_data = [0u8; CONFIG_ACCOUNT_LEN];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("init_config"));
        ix.extend_from_slice(&[2u8; 32]);
        ix.extend_from_slice(&[3u8; 32]);
        ix.extend_from_slice(&25u16.to_le_bytes());
        ix.extend_from_slice(&10_000u64.to_le_bytes());
        ix.extend_from_slice(&120u32.to_le_bytes());
        ix.extend_from_slice(&1u16.to_le_bytes());
        ix.extend_from_slice(&2u64.to_le_bytes());
        ix.extend_from_slice(&1_000_000u64.to_le_bytes());

        let mut processor = AdminConfigProcessor {
            admin_pubkey: admin,
            config_account_data: &mut config_data,
            config_bump: Some(254),
            degen_config_account_data: None,
            degen_config_bump: None,
            new_treasury_ata_pubkey: None,
            new_treasury_token_account_data: None,
            expected_owner_pubkey: None,
        };

        processor.process(&ix).unwrap();

        let parsed = ConfigView::read_from_account_data(&config_data).unwrap();
        assert_eq!(parsed.admin, admin);
        assert_eq!(parsed.usdc_mint, [2u8; 32]);
        assert_eq!(parsed.treasury_usdc_ata, [3u8; 32]);
    }
}
