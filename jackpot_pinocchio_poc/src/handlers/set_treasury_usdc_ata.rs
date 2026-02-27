use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_no_arg_ix,
    legacy_layouts::{ConfigView, TokenAccountCoreView, PUBKEY_LEN},
};

pub fn process_anchor_bytes(
    admin_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &mut [u8],
    new_treasury_ata_pubkey: [u8; PUBKEY_LEN],
    new_treasury_token_account_data: &[u8],
    expected_owner_pubkey: [u8; PUBKEY_LEN],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    parse_no_arg_ix(ix_data, "set_treasury_usdc_ata")
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let mut config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let new_treasury = TokenAccountCoreView::read_from_account_data(new_treasury_token_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if config.admin != admin_pubkey {
        return Err(JackpotCompatError::Unauthorized.into());
    }
    if new_treasury.mint != config.usdc_mint {
        return Err(JackpotCompatError::InvalidTreasury.into());
    }
    if new_treasury.owner != expected_owner_pubkey {
        return Err(JackpotCompatError::InvalidTreasury.into());
    }
    if config.treasury_usdc_ata == new_treasury_ata_pubkey {
        return Err(JackpotCompatError::InvalidTreasury.into());
    }

    config.treasury_usdc_ata = new_treasury_ata_pubkey;
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
        legacy_layouts::{ConfigView, CONFIG_ACCOUNT_LEN, TOKEN_ACCOUNT_CORE_LEN},
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
    fn applies_set_treasury_to_legacy_layout() {
        let admin = [7u8; 32];
        let mut config_data = sample_config(admin);
        let new_treasury_pubkey = [4u8; 32];
        let expected_owner = [5u8; 32];

        let mut token_account = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        token_account[..32].copy_from_slice(&[2u8; 32]);
        token_account[32..64].copy_from_slice(&expected_owner);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("set_treasury_usdc_ata"));

        process_anchor_bytes(
            admin,
            &mut config_data,
            new_treasury_pubkey,
            &token_account,
            expected_owner,
            &ix,
        )
        .unwrap();

        let parsed = ConfigView::read_from_account_data(&config_data).unwrap();
        assert_eq!(parsed.treasury_usdc_ata, new_treasury_pubkey);
    }
}
