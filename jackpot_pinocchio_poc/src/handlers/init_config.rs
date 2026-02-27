use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::account_discriminator,
    errors::JackpotCompatError,
    instruction_layouts::InitConfigArgsCompat,
    legacy_layouts::{CONFIG_ACCOUNT_LEN, ConfigView, PUBKEY_LEN},
};

pub fn process_anchor_bytes(
    admin_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &mut [u8],
    config_bump: u8,
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let args = InitConfigArgsCompat::parse(ix_data).map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.fee_bps > 10_000 {
        return Err(JackpotCompatError::InvalidFeeBps.into());
    }
    if args.ticket_unit == 0 {
        return Err(JackpotCompatError::InvalidTicketUnit.into());
    }
    if args.round_duration_sec == 0 {
        return Err(JackpotCompatError::InvalidRoundDuration.into());
    }
    if config_account_data.len() != CONFIG_ACCOUNT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    config_account_data[..8].copy_from_slice(&account_discriminator("Config"));
    ConfigView {
        admin: admin_pubkey,
        usdc_mint: args.usdc_mint,
        treasury_usdc_ata: args.treasury_usdc_ata,
        fee_bps: args.fee_bps,
        ticket_unit: args.ticket_unit,
        round_duration_sec: args.round_duration_sec,
        min_participants: args.min_participants.max(1),
        min_total_tickets: args.min_total_tickets.max(1),
        paused: false,
        bump: config_bump,
        max_deposit_per_user: args.max_deposit_per_user,
        reserved: [0u8; 24],
    }
    .write_to_account_data(config_account_data)
    .map_err(|_| ProgramError::InvalidAccountData)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anchor_compat::instruction_discriminator;

    #[test]
    fn initializes_live_config_layout() {
        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("init_config"));
        ix.extend_from_slice(&[2u8; 32]);
        ix.extend_from_slice(&[3u8; 32]);
        ix.extend_from_slice(&25u16.to_le_bytes());
        ix.extend_from_slice(&10_000u64.to_le_bytes());
        ix.extend_from_slice(&120u32.to_le_bytes());
        ix.extend_from_slice(&0u16.to_le_bytes());
        ix.extend_from_slice(&0u64.to_le_bytes());
        ix.extend_from_slice(&1_000_000u64.to_le_bytes());

        process_anchor_bytes([7u8; 32], &mut data, 254, &ix).unwrap();

        let config = ConfigView::read_from_account_data(&data).unwrap();
        assert_eq!(config.admin, [7u8; 32]);
        assert_eq!(config.usdc_mint, [2u8; 32]);
        assert_eq!(config.treasury_usdc_ata, [3u8; 32]);
        assert_eq!(config.min_participants, 1);
        assert_eq!(config.min_total_tickets, 1);
        assert_eq!(config.bump, 254);
        assert!(!config.paused);
    }
}
