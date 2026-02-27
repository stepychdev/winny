use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        ConfigView, RoundLifecycleView, ROUND_STATUS_LOCKED, ROUND_STATUS_VRF_REQUESTED, PUBKEY_LEN,
    },
};

pub fn process_anchor_bytes(
    payer_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let _round_id =
        parse_round_id_ix(ix_data, "request_vrf").map_err(|_| ProgramError::InvalidInstructionData)?;

    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if round.status != ROUND_STATUS_LOCKED {
        return Err(JackpotCompatError::RoundNotLocked.into());
    }
    if round.participants_count < config.min_participants {
        return Err(JackpotCompatError::NotEnoughParticipants.into());
    }
    if round.total_tickets < config.min_total_tickets {
        return Err(JackpotCompatError::NotEnoughTickets.into());
    }

    RoundLifecycleView::write_status_to_account_data(round_account_data, ROUND_STATUS_VRF_REQUESTED)
        .map_err(map_layout_err)?;
    RoundLifecycleView::write_vrf_payer_to_account_data(round_account_data, &payer_pubkey)
        .map_err(map_layout_err)?;

    Ok(())
}

fn map_layout_err(err: crate::legacy_layouts::LayoutError) -> ProgramError {
    match err {
        crate::legacy_layouts::LayoutError::MathOverflow => JackpotCompatError::MathOverflow.into(),
        _ => ProgramError::InvalidAccountData,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_LOCKED, ROUND_STATUS_VRF_REQUESTED,
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

    fn sample_round() -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id: 81,
            status: ROUND_STATUS_LOCKED,
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
    fn marks_round_vrf_requested_and_records_payer() {
        let payer = [9u8; 32];
        let config_data = sample_config();
        let mut round_data = sample_round();

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_vrf"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_anchor_bytes(payer, &config_data, &mut round_data, &ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        let vrf_payer = RoundLifecycleView::read_vrf_payer_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_VRF_REQUESTED);
        assert_eq!(vrf_payer, payer);
    }
}
