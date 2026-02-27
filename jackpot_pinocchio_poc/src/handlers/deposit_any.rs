use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::account_discriminator,
    errors::JackpotCompatError,
    handlers::degen_common::map_layout_err,
    instruction_layouts::DepositAnyArgsCompat,
    legacy_layouts::{
        ConfigView, PARTICIPANT_ACCOUNT_LEN, ParticipantView,
        ROUND_STATUS_OPEN, RoundLifecycleView, TokenAccountWithAmountView,
    },
};

pub fn process_anchor_bytes(
    user_pubkey: [u8; 32],
    round_pubkey: [u8; 32],
    vault_pubkey: [u8; 32],
    participant_bump: u8,
    current_unix_timestamp: i64,
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    participant_account_data: &mut [u8],
    user_usdc_ata_data: &[u8],
    vault_account_data: &[u8],
    ix_data: &[u8],
) -> Result<u64, ProgramError> {
    let args = DepositAnyArgsCompat::parse(ix_data).map_err(|_| ProgramError::InvalidInstructionData)?;
    let config = ConfigView::read_from_account_data(config_account_data).map_err(map_layout_err)?;
    let mut round = RoundLifecycleView::read_from_account_data(round_account_data).map_err(map_layout_err)?;
    let user_usdc_ata = TokenAccountWithAmountView::read_from_account_data(user_usdc_ata_data).map_err(map_layout_err)?;
    let vault_ata = TokenAccountWithAmountView::read_from_account_data(vault_account_data).map_err(map_layout_err)?;

    if config.paused {
        return Err(JackpotCompatError::Paused.into());
    }
    if round.round_id != args.round_id {
        return Err(ProgramError::InvalidAccountData);
    }
    if round.status != ROUND_STATUS_OPEN {
        return Err(JackpotCompatError::RoundNotOpen.into());
    }
    if RoundLifecycleView::read_vault_pubkey_from_account_data(round_account_data).map_err(map_layout_err)? != vault_pubkey {
        return Err(JackpotCompatError::InvalidVault.into());
    }
    if vault_ata.mint != config.usdc_mint || vault_ata.owner != round_pubkey {
        return Err(JackpotCompatError::InvalidVault.into());
    }
    if user_usdc_ata.mint != config.usdc_mint || user_usdc_ata.owner != user_pubkey {
        return Err(JackpotCompatError::InvalidUserUsdcAta.into());
    }
    if round.end_ts != 0 && current_unix_timestamp >= round.end_ts {
        return Err(JackpotCompatError::RoundExpired.into());
    }
    if user_usdc_ata.amount < args.usdc_balance_before {
        return Err(JackpotCompatError::InvalidUsdcBalanceBefore.into());
    }

    let delta = user_usdc_ata
        .amount
        .checked_sub(args.usdc_balance_before)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    if delta < args.min_out {
        return Err(JackpotCompatError::SlippageExceeded.into());
    }

    let tickets_added = delta
        .checked_div(config.ticket_unit)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    if tickets_added == 0 {
        return Err(JackpotCompatError::DepositTooSmall.into());
    }

    let mut participant = read_or_init_participant(
        participant_account_data,
        user_pubkey,
        participant_bump,
    )?;

    if participant.round != round_pubkey {
        let next = round
            .participants_count
            .checked_add(1)
            .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
        if next as usize > crate::legacy_layouts::MAX_PARTICIPANTS {
            return Err(JackpotCompatError::MaxParticipantsReached.into());
        }

        participant.round = round_pubkey;
        participant.user = user_pubkey;
        participant.index = next;
        participant.bump = participant_bump;
        participant.tickets_total = 0;
        participant.usdc_total = 0;
        participant.deposits_count = 0;

        round.participants_count = next;
        RoundLifecycleView::write_participant_pubkey_to_account_data(
            round_account_data,
            (next - 1) as usize,
            &user_pubkey,
        )
        .map_err(map_layout_err)?;
    }

    if round.first_deposit_ts == 0 {
        round.first_deposit_ts = current_unix_timestamp;
    }
    if round.end_ts == 0 && round.participants_count >= config.min_participants {
        round.end_ts = current_unix_timestamp
            .checked_add(config.round_duration_sec as i64)
            .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    }

    let new_usdc_total = participant
        .usdc_total
        .checked_add(delta)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    if config.max_deposit_per_user > 0 && new_usdc_total > config.max_deposit_per_user {
        return Err(JackpotCompatError::MaxDepositExceeded.into());
    }

    participant.tickets_total = participant
        .tickets_total
        .checked_add(tickets_added)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    participant.usdc_total = new_usdc_total;
    participant.deposits_count = participant
        .deposits_count
        .checked_add(1)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    round.total_tickets = round
        .total_tickets
        .checked_add(tickets_added)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    round.total_usdc = round
        .total_usdc
        .checked_add(delta)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    round.write_to_account_data(round_account_data).map_err(map_layout_err)?;
    ParticipantView::write_to_account_data(&participant, participant_account_data).map_err(map_layout_err)?;
    RoundLifecycleView::bit_add_in_account_data(round_account_data, participant.index as usize, tickets_added)
        .map_err(map_layout_err)?;

    Ok(delta)
}

fn read_or_init_participant(
    participant_account_data: &mut [u8],
    user_pubkey: [u8; 32],
    participant_bump: u8,
) -> Result<ParticipantView, ProgramError> {
    if participant_account_data.len() != PARTICIPANT_ACCOUNT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    let is_zeroed = participant_account_data.iter().all(|byte| *byte == 0);
    if is_zeroed {
        participant_account_data[..8].copy_from_slice(&account_discriminator("Participant"));
        let participant = ParticipantView {
            round: [0u8; 32],
            user: user_pubkey,
            index: 0,
            bump: participant_bump,
            tickets_total: 0,
            usdc_total: 0,
            deposits_count: 0,
            reserved: [0u8; 16],
        };
        participant
            .write_to_account_data(participant_account_data)
            .map_err(map_layout_err)?;
        return Ok(participant);
    }

    if participant_account_data.get(..8) != Some(&account_discriminator("Participant")) {
        return Err(ProgramError::InvalidAccountData);
    }

    ParticipantView::read_from_account_data(participant_account_data).map_err(map_layout_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, RoundLifecycleView, TokenAccountWithAmountView, CONFIG_ACCOUNT_LEN,
            PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ROUND_STATUS_OPEN,
            TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
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

    fn sample_round(round_id: u64, vault_pubkey: [u8; 32]) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status: ROUND_STATUS_OPEN,
            bump: 201,
            start_ts: 10,
            end_ts: 0,
            first_deposit_ts: 0,
            total_usdc: 0,
            total_tickets: 0,
            participants_count: 1,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        RoundLifecycleView::write_vault_pubkey_to_account_data(&mut data, &vault_pubkey).unwrap();
        RoundLifecycleView::write_participant_pubkey_to_account_data(&mut data, 0, &[99u8; 32]).unwrap();
        data
    }

    fn token_account(amount: u64, owner: [u8; 32]) -> [u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&[2u8; 32]);
        data[32..64].copy_from_slice(&owner);
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn initializes_new_participant_and_starts_countdown() {
        let user = [4u8; 32];
        let round = [8u8; 32];
        let vault = [9u8; 32];
        let config = sample_config();
        let mut round_data = sample_round(81, vault);
        let mut participant_data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        let user_ata = token_account(40_000, user);
        let vault_ata = token_account(0, round);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("deposit_any"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());

        let delta = process_anchor_bytes(
            user,
            round,
            vault,
            55,
            1_000,
            &config,
            &mut round_data,
            &mut participant_data,
            &user_ata,
            &vault_ata,
            &ix,
        )
        .unwrap();

        assert_eq!(delta, 20_000);
        let participant = ParticipantView::read_from_account_data(&participant_data).unwrap();
        assert_eq!(participant.round, round);
        assert_eq!(participant.user, user);
        assert_eq!(participant.index, 2);
        assert_eq!(participant.tickets_total, 2);
        assert_eq!(participant.usdc_total, 20_000);

        let round_view = RoundLifecycleView::read_from_account_data(&round_data).unwrap();
        assert_eq!(round_view.participants_count, 2);
        assert_eq!(round_view.first_deposit_ts, 1_000);
        assert_eq!(round_view.end_ts, 1_120);
        assert_eq!(round_view.total_tickets, 2);
        assert_eq!(round_view.total_usdc, 20_000);
        assert_eq!(
            RoundLifecycleView::read_participant_pubkey_from_account_data(&round_data, 1).unwrap(),
            user
        );
    }

    #[test]
    fn rejects_expired_round() {
        let user = [4u8; 32];
        let round = [8u8; 32];
        let vault = [9u8; 32];
        let config = sample_config();
        let mut round_data = sample_round(81, vault);
        let round_view = RoundLifecycleView {
            end_ts: 1_100,
            ..RoundLifecycleView::read_from_account_data(&round_data).unwrap()
        };
        round_view.write_to_account_data(&mut round_data).unwrap();
        let mut participant_data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        let user_ata = token_account(40_000, user);
        let vault_ata = token_account(0, round);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("deposit_any"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());

        let err = process_anchor_bytes(
            user,
            round,
            vault,
            55,
            1_100,
            &config,
            &mut round_data,
            &mut participant_data,
            &user_ata,
            &vault_ata,
            &ix,
        )
        .unwrap_err();

        assert_eq!(err, JackpotCompatError::RoundExpired.into());
    }
}
