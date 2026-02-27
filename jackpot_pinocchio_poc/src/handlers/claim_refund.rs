use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        ConfigView, ParticipantView, RoundLifecycleView, TokenAccountCoreView, ROUND_STATUS_CANCELLED,
        PUBKEY_LEN,
    },
};

pub fn process_anchor_bytes(
    user_pubkey: [u8; PUBKEY_LEN],
    round_pubkey: [u8; PUBKEY_LEN],
    vault_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &[u8],
    round_account_data: &[u8],
    participant_account_data: &mut [u8],
    vault_account_data: &[u8],
    user_usdc_ata_data: &[u8],
    ix_data: &[u8],
) -> Result<u64, ProgramError> {
    let _round_id = parse_round_id_ix(ix_data, "claim_refund")
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let mut participant = ParticipantView::read_from_account_data(participant_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let vault = TokenAccountCoreView::read_from_account_data(vault_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let user_usdc_ata = TokenAccountCoreView::read_from_account_data(user_usdc_ata_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if participant.user != user_pubkey {
        return Err(JackpotCompatError::Unauthorized.into());
    }
    if participant.round != round_pubkey {
        return Err(JackpotCompatError::ParticipantRoundMismatch.into());
    }

    let refund_amount = participant.usdc_total;
    if refund_amount == 0 {
        return Err(JackpotCompatError::NoDepositToRefund.into());
    }
    if round.status != ROUND_STATUS_CANCELLED {
        return Err(JackpotCompatError::RoundNotCancellable.into());
    }

    let expected_vault = RoundLifecycleView::read_vault_pubkey_from_account_data(round_account_data)
        .map_err(map_layout_err)?;
    if expected_vault != vault_pubkey || vault.owner != round_pubkey {
        return Err(JackpotCompatError::InvalidVault.into());
    }

    if user_usdc_ata.owner != user_pubkey || user_usdc_ata.mint != config.usdc_mint {
        return Err(JackpotCompatError::InvalidUserUsdcAta.into());
    }

    participant.usdc_total = 0;
    participant.tickets_total = 0;
    participant
        .write_to_account_data(participant_account_data)
        .map_err(map_layout_err)?;

    Ok(refund_amount)
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
            ConfigView, ParticipantView, RoundLifecycleView, CONFIG_ACCOUNT_LEN,
            PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ROUND_STATUS_CANCELLED,
            TOKEN_ACCOUNT_CORE_LEN,
        },
    };

    fn sample_config(admin: [u8; 32], usdc_mint: [u8; 32]) -> [u8; CONFIG_ACCOUNT_LEN] {
        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin,
            usdc_mint,
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

    fn sample_round(round_id: u64, vault_pubkey: [u8; 32]) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status: ROUND_STATUS_CANCELLED,
            bump: 201,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_000_000,
            total_tickets: 100,
            participants_count: 1,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data[48..80].copy_from_slice(&vault_pubkey);
        data
    }

    fn sample_participant(round: [u8; 32], user: [u8; 32], usdc_total: u64) -> [u8; PARTICIPANT_ACCOUNT_LEN] {
        let mut data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Participant"));
        ParticipantView {
            round,
            user,
            index: 1,
            bump: 202,
            tickets_total: 100,
            usdc_total,
            deposits_count: 1,
            reserved: [0u8; 16],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn token_account(mint: [u8; 32], owner: [u8; 32]) -> [u8; TOKEN_ACCOUNT_CORE_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        data[..32].copy_from_slice(&mint);
        data[32..64].copy_from_slice(&owner);
        data
    }

    #[test]
    fn applies_claim_refund_and_zeroes_participant() {
        let user = [7u8; 32];
        let round = [4u8; 32];
        let vault = [8u8; 32];
        let usdc_mint = [9u8; 32];
        let config = sample_config([1u8; 32], usdc_mint);
        let round_data = sample_round(81, vault);
        let mut participant = sample_participant(round, user, 1_000_000);
        let vault_data = token_account(usdc_mint, round);
        let user_ata = token_account(usdc_mint, user);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_refund"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let refund = process_anchor_bytes(
            user,
            round,
            vault,
            &config,
            &round_data,
            &mut participant,
            &vault_data,
            &user_ata,
            &ix,
        )
        .unwrap();

        assert_eq!(refund, 1_000_000);
        let participant_view = ParticipantView::read_from_account_data(&participant).unwrap();
        assert_eq!(participant_view.usdc_total, 0);
        assert_eq!(participant_view.tickets_total, 0);
    }

    #[test]
    fn rejects_wrong_round_binding() {
        let user = [7u8; 32];
        let round = [4u8; 32];
        let vault = [8u8; 32];
        let usdc_mint = [9u8; 32];
        let config = sample_config([1u8; 32], usdc_mint);
        let round_data = sample_round(81, vault);
        let mut participant = sample_participant([5u8; 32], user, 1_000_000);
        let vault_data = token_account(usdc_mint, round);
        let user_ata = token_account(usdc_mint, user);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_refund"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let err = process_anchor_bytes(
            user,
            round,
            vault,
            &config,
            &round_data,
            &mut participant,
            &vault_data,
            &user_ata,
            &ix,
        )
        .unwrap_err();
        assert_eq!(err, JackpotCompatError::ParticipantRoundMismatch.into());
    }
}
