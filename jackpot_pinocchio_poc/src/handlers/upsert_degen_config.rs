use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::account_discriminator,
    errors::JackpotCompatError,
    instruction_layouts::UpsertDegenConfigArgsCompat,
    legacy_layouts::{ConfigView, DegenConfigView, DEGEN_CONFIG_ACCOUNT_LEN, PUBKEY_LEN},
};

pub const DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC: u32 = 300;

pub fn process_anchor_bytes(
    admin_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &[u8],
    degen_config_account_data: &mut [u8],
    degen_config_bump: u8,
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let args = UpsertDegenConfigArgsCompat::parse(ix_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if config.admin != admin_pubkey {
        return Err(JackpotCompatError::Unauthorized.into());
    }
    if args.executor == [0u8; PUBKEY_LEN] {
        return Err(JackpotCompatError::UnauthorizedDegenExecutor.into());
    }
    if degen_config_account_data.len() < DEGEN_CONFIG_ACCOUNT_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }

    degen_config_account_data[..8].copy_from_slice(&account_discriminator("DegenConfig"));
    let timeout = if args.fallback_timeout_sec == 0 {
        DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC
    } else {
        args.fallback_timeout_sec
    };

    let view = DegenConfigView {
        executor: args.executor,
        fallback_timeout_sec: timeout,
        bump: degen_config_bump,
        reserved: [0u8; 27],
    };
    view.write_to_account_data(degen_config_account_data)
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
    fn applies_upsert_to_legacy_layout() {
        let admin = [7u8; 32];
        let config_data = sample_config(admin);
        let mut degen_data = [0u8; DEGEN_CONFIG_ACCOUNT_LEN];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
        ix.extend_from_slice(&[9u8; 32]);
        ix.extend_from_slice(&0u32.to_le_bytes());

        process_anchor_bytes(admin, &config_data, &mut degen_data, 201, &ix).unwrap();

        let parsed = DegenConfigView::read_from_account_data(&degen_data).unwrap();
        assert_eq!(parsed.executor, [9u8; 32]);
        assert_eq!(parsed.fallback_timeout_sec, DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC);
        assert_eq!(parsed.bump, 201);
    }
}
