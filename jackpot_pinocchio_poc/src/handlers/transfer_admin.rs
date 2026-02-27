use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::TransferAdminArgsCompat,
    legacy_layouts::{ConfigView, PUBKEY_LEN},
};

pub fn process_anchor_bytes(
    admin_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &mut [u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let args = TransferAdminArgsCompat::parse(ix_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let mut config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if config.admin != admin_pubkey {
        return Err(JackpotCompatError::Unauthorized.into());
    }
    if args.new_admin == [0u8; PUBKEY_LEN] || args.new_admin == config.admin {
        return Err(JackpotCompatError::InvalidAdmin.into());
    }

    config.admin = args.new_admin;
    config
        .write_to_account_data(config_account_data)
        .map_err(|_| ProgramError::AccountDataTooSmall)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{ConfigView, CONFIG_ACCOUNT_LEN},
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
    fn applies_transfer_admin_to_legacy_layout() {
        let admin = [7u8; 32];
        let mut config_data = sample_config(admin);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("transfer_admin"));
        ix.extend_from_slice(&[8u8; 32]);

        process_anchor_bytes(admin, &mut config_data, &ix).unwrap();

        let parsed = ConfigView::read_from_account_data(&config_data).unwrap();
        assert_eq!(parsed.admin, [8u8; 32]);
    }
}
