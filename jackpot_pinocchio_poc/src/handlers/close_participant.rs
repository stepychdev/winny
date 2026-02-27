use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        ParticipantView, RoundLifecycleView, ROUND_STATUS_CANCELLED, ROUND_STATUS_CLAIMED,
        PUBKEY_LEN,
    },
};

pub fn process_anchor_bytes(
    user_pubkey: [u8; PUBKEY_LEN],
    round_pubkey: [u8; PUBKEY_LEN],
    round_account_data: &[u8],
    participant_account_data: &[u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let _round_id = parse_round_id_ix(ix_data, "close_participant")
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let participant = ParticipantView::read_from_account_data(participant_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let closeable =
        round.status == ROUND_STATUS_CLAIMED || round.status == ROUND_STATUS_CANCELLED;
    if !closeable {
        return Err(JackpotCompatError::RoundNotCloseable.into());
    }

    if participant.round != round_pubkey {
        return Err(JackpotCompatError::ParticipantRoundMismatch.into());
    }

    if participant.user != user_pubkey {
        return Err(JackpotCompatError::Unauthorized.into());
    }

    if round.status == ROUND_STATUS_CANCELLED
        && (participant.usdc_total != 0 || participant.tickets_total != 0)
    {
        return Err(JackpotCompatError::ParticipantNotEmpty.into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ParticipantView, RoundLifecycleView, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_CANCELLED, ROUND_STATUS_CLAIMED, ROUND_STATUS_OPEN,
        },
    };

    fn sample_round(round_id: u64, status: u8) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
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

    fn sample_participant(
        round: [u8; 32],
        user: [u8; 32],
        tickets_total: u64,
        usdc_total: u64,
    ) -> [u8; PARTICIPANT_ACCOUNT_LEN] {
        let mut data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Participant"));
        ParticipantView {
            round,
            user,
            index: 1,
            bump: 202,
            tickets_total,
            usdc_total,
            deposits_count: 1,
            reserved: [0u8; 16],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    #[test]
    fn allows_close_for_claimed_participant() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let user_pubkey = [5u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_CLAIMED);
        let participant_data = sample_participant(round_pubkey, user_pubkey, 100, 1_000_000);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        process_anchor_bytes(
            user_pubkey,
            round_pubkey,
            &round_data,
            &participant_data,
            &ix,
        )
        .unwrap();
    }

    #[test]
    fn rejects_non_empty_cancelled_participant() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let user_pubkey = [5u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_CANCELLED);
        let participant_data = sample_participant(round_pubkey, user_pubkey, 100, 1_000_000);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        let err = process_anchor_bytes(
            user_pubkey,
            round_pubkey,
            &round_data,
            &participant_data,
            &ix,
        )
        .unwrap_err();
        assert_eq!(err, JackpotCompatError::ParticipantNotEmpty.into());
    }

    #[test]
    fn rejects_close_when_round_not_terminal() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let user_pubkey = [5u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_OPEN);
        let participant_data = sample_participant(round_pubkey, user_pubkey, 100, 1_000_000);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        let err = process_anchor_bytes(
            user_pubkey,
            round_pubkey,
            &round_data,
            &participant_data,
            &ix,
        )
        .unwrap_err();
        assert_eq!(err, JackpotCompatError::RoundNotCloseable.into());
    }
}
