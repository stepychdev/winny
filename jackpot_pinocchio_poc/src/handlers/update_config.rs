use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::UpdateConfigArgsCompat,
    legacy_layouts::{ConfigView, PUBKEY_LEN},
};

pub fn process_anchor_bytes(
    admin_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &mut [u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let args = UpdateConfigArgsCompat::parse(ix_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let mut config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if config.admin != admin_pubkey {
        return Err(JackpotCompatError::Unauthorized.into());
    }

    if let Some(v) = args.fee_bps {
        if v > 10_000 {
            return Err(JackpotCompatError::InvalidFeeBps.into());
        }
        config.fee_bps = v;
    }
    if let Some(v) = args.ticket_unit {
        if v == 0 {
            return Err(JackpotCompatError::InvalidTicketUnit.into());
        }
        config.ticket_unit = v;
    }
    if let Some(v) = args.round_duration_sec {
        if v == 0 {
            return Err(JackpotCompatError::InvalidRoundDuration.into());
        }
        config.round_duration_sec = v;
    }
    if let Some(v) = args.min_participants {
        config.min_participants = v.max(1);
    }
    if let Some(v) = args.min_total_tickets {
        config.min_total_tickets = v.max(1);
    }
    if let Some(v) = args.paused {
        config.paused = v;
    }
    if let Some(v) = args.max_deposit_per_user {
        config.max_deposit_per_user = v;
    }

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
    fn applies_update_config_to_legacy_layout() {
        let admin = [7u8; 32];
        let mut config_data = sample_config(admin);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("update_config"));
        ix.push(1);
        ix.extend_from_slice(&50u16.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&20_000u64.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&240u32.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&0u16.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&0u64.to_le_bytes());
        ix.push(1);
        ix.push(1);
        ix.push(1);
        ix.extend_from_slice(&2_000_000u64.to_le_bytes());

        process_anchor_bytes(admin, &mut config_data, &ix).unwrap();

        let parsed = ConfigView::read_from_account_data(&config_data).unwrap();
        assert_eq!(parsed.fee_bps, 50);
        assert_eq!(parsed.ticket_unit, 20_000);
        assert_eq!(parsed.round_duration_sec, 240);
        assert_eq!(parsed.min_participants, 1);
        assert_eq!(parsed.min_total_tickets, 1);
        assert!(parsed.paused);
        assert_eq!(parsed.max_deposit_per_user, 2_000_000);
    }
}
