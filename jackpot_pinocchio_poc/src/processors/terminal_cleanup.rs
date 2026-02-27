use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers,
    legacy_layouts::PUBKEY_LEN,
};

pub struct TerminalCleanupProcessor<'a> {
    pub user_pubkey: Option<[u8; PUBKEY_LEN]>,
    pub round_pubkey: [u8; PUBKEY_LEN],
    pub round_account_data: &'a [u8],
    pub participant_account_data: Option<&'a [u8]>,
    pub vault_account_data: Option<&'a [u8]>,
}

impl<'a> TerminalCleanupProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<(), ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("close_participant") {
            return handlers::close_participant::process_anchor_bytes(
                self.user_pubkey.ok_or(ProgramError::NotEnoughAccountKeys)?,
                self.round_pubkey,
                self.round_account_data,
                self.participant_account_data
                    .ok_or(ProgramError::NotEnoughAccountKeys)?,
                ix_data,
            );
        }

        if discriminator == instruction_discriminator("close_round") {
            return handlers::close_round::process_anchor_bytes(
                self.round_pubkey,
                self.round_account_data,
                self.vault_account_data
                    .ok_or(ProgramError::NotEnoughAccountKeys)?,
                ix_data,
            );
        }

        Err(ProgramError::InvalidInstructionData)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ParticipantView, RoundLifecycleView, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_CLAIMED,
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

    fn sample_participant(round: [u8; 32], user: [u8; 32]) -> [u8; PARTICIPANT_ACCOUNT_LEN] {
        let mut data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Participant"));
        ParticipantView {
            round,
            user,
            index: 1,
            bump: 202,
            tickets_total: 100,
            usdc_total: 1_000_000,
            deposits_count: 1,
            reserved: [0u8; 16],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    #[test]
    fn routes_close_participant() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let user_pubkey = [5u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_CLAIMED);
        let participant_data = sample_participant(round_pubkey, user_pubkey);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        let mut processor = TerminalCleanupProcessor {
            user_pubkey: Some(user_pubkey),
            round_pubkey,
            round_account_data: &round_data,
            participant_account_data: Some(&participant_data),
            vault_account_data: None,
        };

        processor.process(&ix).unwrap();
    }

    #[test]
    fn routes_close_round() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_CLAIMED);
        let vault_data = {
            let mut data = [0u8; 72];
            data[32..64].copy_from_slice(&round_pubkey);
            data
        };

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_round"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        let mut processor = TerminalCleanupProcessor {
            user_pubkey: None,
            round_pubkey,
            round_account_data: &round_data,
            participant_account_data: None,
            vault_account_data: Some(&vault_data),
        };

        processor.process(&ix).unwrap();
    }
}
