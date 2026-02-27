use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        ConfigView, RoundLifecycleView, ROUND_STATUS_CANCELLED, ROUND_STATUS_LOCKED,
        ROUND_STATUS_OPEN, ROUND_STATUS_VRF_REQUESTED, PUBKEY_LEN,
    },
};

pub fn process_anchor_bytes(
    admin_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let _round_id = parse_round_id_ix(ix_data, "admin_force_cancel")
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if config.admin != admin_pubkey {
        return Err(JackpotCompatError::Unauthorized.into());
    }

    let cancellable = round.status == ROUND_STATUS_OPEN
        || round.status == ROUND_STATUS_LOCKED
        || round.status == ROUND_STATUS_VRF_REQUESTED;
    if !cancellable {
        return Err(JackpotCompatError::RoundNotCancellable.into());
    }

    RoundLifecycleView::write_status_to_account_data(round_account_data, ROUND_STATUS_CANCELLED)
        .map_err(|_| ProgramError::AccountDataTooSmall)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_CANCELLED, ROUND_STATUS_OPEN, ROUND_STATUS_SETTLED,
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
    fn applies_force_cancel_to_live_round_layout() {
        let admin = [7u8; 32];
        let config_data = sample_config(admin);
        let mut round_data = sample_round(ROUND_STATUS_OPEN);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("admin_force_cancel"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_anchor_bytes(admin, &config_data, &mut round_data, &ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_CANCELLED);
    }

    #[test]
    fn rejects_force_cancel_on_settled_round() {
        let admin = [7u8; 32];
        let config_data = sample_config(admin);
        let mut round_data = sample_round(ROUND_STATUS_SETTLED);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("admin_force_cancel"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let err =
            process_anchor_bytes(admin, &config_data, &mut round_data, &ix).unwrap_err();
        assert_eq!(err, JackpotCompatError::RoundNotCancellable.into());
    }
}
