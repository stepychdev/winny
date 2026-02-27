use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_vrf_callback_ix,
    legacy_layouts::{
        ConfigView, RoundLifecycleView, ROUND_STATUS_SETTLED, ROUND_STATUS_VRF_REQUESTED,
    },
};

pub fn process_anchor_bytes(
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let randomness = parse_vrf_callback_ix(ix_data).map_err(|_| ProgramError::InvalidInstructionData)?;
    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if round.status != ROUND_STATUS_VRF_REQUESTED {
        return Err(JackpotCompatError::RoundNotVrfRequested.into());
    }
    if round.participants_count < config.min_participants {
        return Err(JackpotCompatError::NotEnoughParticipants.into());
    }
    if round.total_tickets < config.min_total_tickets {
        return Err(JackpotCompatError::NotEnoughTickets.into());
    }

    let mut bytes16 = [0u8; 16];
    bytes16.copy_from_slice(&randomness[..16]);
    let randomness_u128 = u128::from_le_bytes(bytes16);
    let winning_ticket = (randomness_u128 % (round.total_tickets as u128)) as u64 + 1;
    let winner_idx = RoundLifecycleView::bit_find_prefix_in_account_data(round_account_data, winning_ticket)
        .map_err(map_layout_err)?;
    let winner = RoundLifecycleView::read_participant_pubkey_from_account_data(
        round_account_data,
        winner_idx - 1,
    )
    .map_err(map_layout_err)?;

    RoundLifecycleView::write_randomness_to_account_data(round_account_data, &randomness)
        .map_err(map_layout_err)?;
    RoundLifecycleView::write_winning_ticket_to_account_data(round_account_data, winning_ticket)
        .map_err(map_layout_err)?;
    RoundLifecycleView::write_winner_to_account_data(round_account_data, &winner)
        .map_err(map_layout_err)?;
    RoundLifecycleView::write_status_to_account_data(round_account_data, ROUND_STATUS_SETTLED)
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
            ROUND_STATUS_SETTLED, ROUND_STATUS_VRF_REQUESTED,
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
            status: ROUND_STATUS_VRF_REQUESTED,
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
        data[176..208].copy_from_slice(&[11u8; 32]);
        data[208..240].copy_from_slice(&[22u8; 32]);
        RoundLifecycleView::write_bit_node_to_account_data(&mut data, 1, 100).unwrap();
        let mut idx = 2usize;
        while idx <= 128 {
            RoundLifecycleView::write_bit_node_to_account_data(&mut data, idx, 200).unwrap();
            idx <<= 1;
        }
        data
    }

    #[test]
    fn settles_round_and_picks_winner_from_fenwick_tree() {
        let config_data = sample_config();
        let mut round_data = sample_round();
        let randomness = [0u8; 32];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("vrf_callback"));
        ix.extend_from_slice(&randomness);

        process_anchor_bytes(&config_data, &mut round_data, &ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_SETTLED);
        assert_eq!(
            RoundLifecycleView::read_randomness_from_account_data(&round_data).unwrap(),
            randomness
        );
        assert_eq!(
            RoundLifecycleView::read_winning_ticket_from_account_data(&round_data).unwrap(),
            1
        );
        assert_eq!(
            RoundLifecycleView::read_winner_from_account_data(&round_data).unwrap(),
            [11u8; 32]
        );
    }
}
