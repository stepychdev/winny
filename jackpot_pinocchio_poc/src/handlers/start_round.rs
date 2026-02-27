use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::account_discriminator,
    errors::JackpotCompatError,
    handlers::degen_common::map_layout_err,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        ConfigView, RoundLifecycleView, TokenAccountCoreView, ROUND_ACCOUNT_LEN, ROUND_STATUS_OPEN,
    },
};

pub fn process_anchor_bytes(
    round_pubkey: [u8; 32],
    vault_pubkey: [u8; 32],
    usdc_mint_pubkey: [u8; 32],
    round_bump: u8,
    current_unix_timestamp: i64,
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    vault_account_data: &[u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let round_id = parse_round_id_ix(ix_data, "start_round").map_err(|_| ProgramError::InvalidInstructionData)?;
    let config = ConfigView::read_from_account_data(config_account_data).map_err(map_layout_err)?;
    if config.paused {
        return Err(JackpotCompatError::Paused.into());
    }
    if config.usdc_mint != usdc_mint_pubkey {
        return Err(JackpotCompatError::InvalidVault.into());
    }

    if round_account_data.len() != ROUND_ACCOUNT_LEN || round_account_data.iter().any(|byte| *byte != 0) {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let vault = TokenAccountCoreView::read_from_account_data(vault_account_data).map_err(map_layout_err)?;
    if vault.mint != config.usdc_mint || vault.owner != round_pubkey {
        return Err(JackpotCompatError::InvalidVault.into());
    }

    round_account_data[..8].copy_from_slice(&account_discriminator("Round"));
    RoundLifecycleView {
        round_id,
        status: ROUND_STATUS_OPEN,
        bump: round_bump,
        start_ts: current_unix_timestamp,
        end_ts: 0,
        first_deposit_ts: 0,
        total_usdc: 0,
        total_tickets: 0,
        participants_count: 0,
    }
    .write_to_account_data(round_account_data)
    .map_err(map_layout_err)?;
    RoundLifecycleView::write_vault_pubkey_to_account_data(round_account_data, &vault_pubkey)
        .map_err(map_layout_err)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN, TOKEN_ACCOUNT_CORE_LEN,
        },
    };

    fn config_data(usdc_mint: [u8; 32], paused: bool) -> [u8; CONFIG_ACCOUNT_LEN] {
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
            paused,
            bump: 254,
            max_deposit_per_user: 1_000_000,
            reserved: [0u8; 24],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn token_account_core(mint: [u8; 32], owner: [u8; 32]) -> [u8; TOKEN_ACCOUNT_CORE_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        data[..32].copy_from_slice(&mint);
        data[32..64].copy_from_slice(&owner);
        data
    }

    #[test]
    fn initializes_zeroed_round_layout_for_start_round() {
        let round_pubkey = [8u8; 32];
        let vault_pubkey = [9u8; 32];
        let usdc_mint = [2u8; 32];
        let config = config_data(usdc_mint, false);
        let vault = token_account_core(usdc_mint, round_pubkey);
        let mut round = [0u8; ROUND_ACCOUNT_LEN];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("start_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_anchor_bytes(
            round_pubkey,
            vault_pubkey,
            usdc_mint,
            203,
            1_234,
            &config,
            &mut round,
            &vault,
            &ix,
        )
        .unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&round).unwrap();
        assert_eq!(parsed.round_id, 81);
        assert_eq!(parsed.status, ROUND_STATUS_OPEN);
        assert_eq!(parsed.bump, 203);
        assert_eq!(parsed.start_ts, 1_234);
        assert_eq!(
            RoundLifecycleView::read_vault_pubkey_from_account_data(&round).unwrap(),
            vault_pubkey
        );
    }

    #[test]
    fn rejects_start_round_when_paused() {
        let round_pubkey = [8u8; 32];
        let vault_pubkey = [9u8; 32];
        let usdc_mint = [2u8; 32];
        let config = config_data(usdc_mint, true);
        let vault = token_account_core(usdc_mint, round_pubkey);
        let mut round = [0u8; ROUND_ACCOUNT_LEN];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("start_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let err = process_anchor_bytes(
            round_pubkey,
            vault_pubkey,
            usdc_mint,
            203,
            1_234,
            &config,
            &mut round,
            &vault,
            &ix,
        )
        .unwrap_err();

        assert_eq!(err, JackpotCompatError::Paused.into());
    }
}
