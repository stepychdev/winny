use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};

#[cfg(not(test))]
use pinocchio::cpi::{Seed, Signer};
#[cfg(not(test))]
use pinocchio_token::instructions::CloseAccount as TokenCloseAccount;

use crate::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    errors::JackpotCompatError,
    legacy_layouts::{
        PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ParticipantView, RoundLifecycleView,
        TokenAccountWithAmountView,
    },
    processors::terminal_cleanup::TerminalCleanupProcessor,
};

const SEED_ROUND: &[u8] = b"round";
const SEED_PARTICIPANT: &[u8] = b"p";

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .get(..8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if discriminator == instruction_discriminator("close_participant") {
        return process_close_participant(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("close_round") {
        return process_close_round(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_close_participant(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [payer, user, round, participant, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(user)?;
    require_round_pda(round, program_id, instruction_data, "close_participant")?;
    require_participant_pda(participant, user, round, program_id)?;
    require_writable(participant)?;

    {
        let round_data = round.try_borrow()?;
        let participant_data = participant.try_borrow()?;
        let mut processor = TerminalCleanupProcessor {
            user_pubkey: Some(user.address().to_bytes()),
            round_pubkey: round.address().to_bytes(),
            round_account_data: &round_data,
            participant_account_data: Some(&participant_data),
            vault_account_data: None,
        };
        processor.process(instruction_data)?;
    }

    close_account_to(participant, user, true)?;

    Ok(())
}

fn process_close_round(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [payer, recipient, round, vault, token_program, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(recipient)?;
    require_writable(round)?;
    require_writable(vault)?;
    require_round_pda(round, program_id, instruction_data, "close_round")?;
    require_token_program(token_program)?;
    require_system_program(system_program)?;
    require_vault_token_account(vault, round, token_program)?;

    let round_view = {
        let round_data = round.try_borrow()?;
        let vault_data = vault.try_borrow()?;
        let mut processor = TerminalCleanupProcessor {
            user_pubkey: None,
            round_pubkey: round.address().to_bytes(),
            round_account_data: &round_data,
            participant_account_data: None,
            vault_account_data: Some(&vault_data),
        };
        processor.process(instruction_data)?;
        RoundLifecycleView::read_from_account_data(&round_data)
            .map_err(|_| ProgramError::InvalidAccountData)?
    };

    let round_id_le = round_view.round_id.to_le_bytes();
    close_empty_vault_token_account(vault, recipient, round, &round_id_le, round_view.bump)?;
    close_zeroed_round_account(round, recipient)?;

    Ok(())
}

fn close_account_to(
    account_to_close: &AccountView,
    recipient: &AccountView,
    resize_to_zero: bool,
) -> ProgramResult {
    let recipient_lamports = recipient.lamports();
    let closing_lamports = account_to_close.lamports();
    let new_recipient_lamports = recipient_lamports
        .checked_add(closing_lamports)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    recipient.set_lamports(new_recipient_lamports);
    account_to_close.set_lamports(0);

    if account_to_close.data_len() > 0 {
        let mut account_data = account_to_close.try_borrow_mut()?;
        account_data.fill(0);
    }
    if resize_to_zero {
        account_to_close.resize(0)?;
    }

    Ok(())
}

#[cfg(not(test))]
fn close_empty_vault_token_account(
    vault: &AccountView,
    recipient: &AccountView,
    round: &AccountView,
    round_id_le: &[u8; 8],
    round_bump: u8,
) -> ProgramResult {
    let round_bump_slice = [round_bump];
    let signer_seeds: [Seed<'_>; 3] = [
        Seed::from(SEED_ROUND),
        Seed::from(round_id_le),
        Seed::from(&round_bump_slice),
    ];
    let signer = Signer::from(&signer_seeds);

    TokenCloseAccount {
        account: vault,
        destination: recipient,
        authority: round,
    }
    .invoke_signed(&[signer])
}

#[cfg(test)]
fn close_empty_vault_token_account(
    vault: &AccountView,
    recipient: &AccountView,
    _round: &AccountView,
    _round_id_le: &[u8; 8],
    _round_bump: u8,
) -> ProgramResult {
    close_account_to(vault, recipient, false)
}

fn close_zeroed_round_account(round: &AccountView, recipient: &AccountView) -> ProgramResult {
    let recipient_lamports = recipient.lamports();
    let round_lamports = round.lamports();
    let new_recipient_lamports = recipient_lamports
        .checked_add(round_lamports)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    if round.data_len() > 0 {
        let mut round_data = round.try_borrow_mut()?;
        round_data.fill(0);
    }

    round.set_lamports(0);
    recipient.set_lamports(new_recipient_lamports);

    Ok(())
}

fn require_signer(account: &AccountView) -> ProgramResult {
    if account.is_signer() {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

fn require_writable(account: &AccountView) -> ProgramResult {
    if account.is_writable() {
        Ok(())
    } else {
        Err(ProgramError::Immutable)
    }
}

fn require_owned_by(account: &AccountView, owner: &Address) -> ProgramResult {
    if account.owned_by(owner) {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

fn require_round_pda(
    account: &AccountView,
    program_id: &Address,
    instruction_data: &[u8],
    ix_name: &str,
) -> ProgramResult {
    require_owned_by(account, program_id)?;

    let round_id = crate::instruction_layouts::parse_round_id_ix(instruction_data, ix_name)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let (expected_address, _) =
        Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    let data = account.try_borrow()?;
    if data.len() != ROUND_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("Round")) {
        return Err(ProgramError::InvalidAccountData);
    }

    Ok(())
}

fn require_participant_pda(
    account: &AccountView,
    user: &AccountView,
    round: &AccountView,
    program_id: &Address,
) -> ProgramResult {
    require_owned_by(account, program_id)?;

    let (expected_address, expected_bump) = Address::find_program_address(
        &[SEED_PARTICIPANT, round.address().as_ref(), user.address().as_ref()],
        program_id,
    );
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    let data = account.try_borrow()?;
    if data.len() != PARTICIPANT_ACCOUNT_LEN
        || data.get(..8) != Some(&account_discriminator("Participant"))
    {
        return Err(ProgramError::InvalidAccountData);
    }

    let participant =
        ParticipantView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    if participant.bump != expected_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    Ok(())
}

fn require_vault_token_account(
    vault: &AccountView,
    round: &AccountView,
    token_program: &AccountView,
) -> ProgramResult {
    require_owned_by(vault, token_program.address())?;

    let data = vault.try_borrow()?;
    let vault_view = TokenAccountWithAmountView::read_from_account_data(&data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if vault_view.owner != round.address().to_bytes() {
        return Err(JackpotCompatError::InvalidVault.into());
    }

    Ok(())
}

fn require_token_program(account: &AccountView) -> ProgramResult {
    if account.address() == &pinocchio_token::ID {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

fn require_system_program(account: &AccountView) -> ProgramResult {
    if account.address() == &Address::default() {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;

    use pinocchio::account::{NOT_BORROWED, RuntimeAccount};

    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ParticipantView, RoundLifecycleView, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_CANCELLED, ROUND_STATUS_CLAIMED, TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
        },
    };

    use super::*;

    const PROGRAM_ID: Address = Address::new_from_array([
        43, 187, 24, 179, 245, 85, 238, 77, 204, 252, 3, 113, 231, 169, 27, 207, 165, 14, 251,
        108, 242, 117, 20, 87, 30, 9, 66, 30, 58, 230, 228, 54,
    ]);

    struct TestAccount {
        backing: Vec<u64>,
    }

    impl TestAccount {
        fn new(
            address: [u8; 32],
            owner: Address,
            is_signer: bool,
            is_writable: bool,
            lamports: u64,
            data: &[u8],
        ) -> Self {
            let bytes = size_of::<RuntimeAccount>() + data.len();
            let words = bytes.div_ceil(size_of::<u64>());
            let mut backing = vec![0u64; words.max(1)];
            let raw = backing.as_mut_ptr() as *mut RuntimeAccount;

            unsafe {
                (*raw).borrow_state = NOT_BORROWED;
                (*raw).is_signer = u8::from(is_signer);
                (*raw).is_writable = u8::from(is_writable);
                (*raw).executable = 0;
                (*raw).resize_delta = 0;
                (*raw).address = Address::from(address);
                (*raw).owner = owner;
                (*raw).lamports = lamports;
                (*raw).data_len = data.len() as u64;

                let data_ptr = (raw as *mut u8).add(size_of::<RuntimeAccount>());
                core::ptr::copy_nonoverlapping(data.as_ptr(), data_ptr, data.len());
            }

            Self { backing }
        }

        fn view(&mut self) -> AccountView {
            unsafe { AccountView::new_unchecked(self.backing.as_mut_ptr() as *mut RuntimeAccount) }
        }

        fn lamports(&self) -> u64 {
            let raw = self.backing.as_ptr() as *const RuntimeAccount;
            unsafe { (*raw).lamports }
        }

        fn data_len(&self) -> usize {
            let raw = self.backing.as_ptr() as *const RuntimeAccount;
            unsafe { (*raw).data_len as usize }
        }

        fn data(&self) -> &[u8] {
            let raw = self.backing.as_ptr() as *const RuntimeAccount;
            unsafe {
                core::slice::from_raw_parts(
                    (raw as *const u8).add(size_of::<RuntimeAccount>()),
                    self.data_len(),
                )
            }
        }
    }

    fn sample_round(round_id: u64, status: u8) -> (Address, Vec<u8>) {
        let (round_pda, round_bump) =
            Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let mut data = vec![0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status,
            bump: round_bump,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_250_000,
            total_tickets: 200,
            participants_count: 2,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (round_pda, data)
    }

    fn sample_participant(
        round: Address,
        user: Address,
        tickets_total: u64,
        usdc_total: u64,
    ) -> (Address, Vec<u8>) {
        let (participant_pda, bump) = Address::find_program_address(
            &[SEED_PARTICIPANT, round.as_ref(), user.as_ref()],
            &PROGRAM_ID,
        );
        let mut data = vec![0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Participant"));
        ParticipantView {
            round: round.to_bytes(),
            user: user.to_bytes(),
            index: 1,
            bump,
            tickets_total,
            usdc_total,
            deposits_count: 1,
            reserved: [0u8; 16],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (participant_pda, data)
    }

    fn sample_vault(owner: Address, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&[7u8; 32]);
        data[32..64].copy_from_slice(owner.as_ref());
        data[64..72].copy_from_slice(&amount.to_le_bytes());
        data
    }

    #[test]
    fn entrypoint_routes_close_participant_and_reclaims_lamports() {
        let payer = Address::new_from_array([9u8; 32]);
        let user = Address::new_from_array([5u8; 32]);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_CLAIMED);
        let (participant_pda, participant_data) =
            sample_participant(round_pda, user, 100, 1_000_000);

        let mut payer_account = TestAccount::new(
            payer.to_bytes(),
            Address::new_from_array([0u8; 32]),
            true,
            true,
            1_000_000_000,
            &[],
        );
        let mut user_account = TestAccount::new(
            user.to_bytes(),
            Address::new_from_array([0u8; 32]),
            false,
            true,
            500_000,
            &[],
        );
        let mut round_account = TestAccount::new(
            round_pda.to_bytes(),
            PROGRAM_ID,
            false,
            false,
            1_000_000,
            &round_data,
        );
        let mut participant_account = TestAccount::new(
            participant_pda.to_bytes(),
            PROGRAM_ID,
            false,
            true,
            222_000,
            &participant_data,
        );

        let views = [
            payer_account.view(),
            user_account.view(),
            round_account.view(),
            participant_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        assert_eq!(user_account.lamports(), 722_000);
        assert_eq!(participant_account.lamports(), 0);
        assert_eq!(participant_account.data_len(), 0);
    }

    #[test]
    fn entrypoint_rejects_nonempty_cancelled_participant() {
        let payer = Address::new_from_array([9u8; 32]);
        let user = Address::new_from_array([5u8; 32]);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_CANCELLED);
        let (participant_pda, participant_data) =
            sample_participant(round_pda, user, 100, 1_000_000);

        let mut payer_account = TestAccount::new(
            payer.to_bytes(),
            Address::new_from_array([0u8; 32]),
            true,
            true,
            1_000_000_000,
            &[],
        );
        let mut user_account = TestAccount::new(
            user.to_bytes(),
            Address::new_from_array([0u8; 32]),
            false,
            true,
            500_000,
            &[],
        );
        let mut round_account = TestAccount::new(
            round_pda.to_bytes(),
            PROGRAM_ID,
            false,
            false,
            1_000_000,
            &round_data,
        );
        let mut participant_account = TestAccount::new(
            participant_pda.to_bytes(),
            PROGRAM_ID,
            false,
            true,
            222_000,
            &participant_data,
        );

        let views = [
            payer_account.view(),
            user_account.view(),
            round_account.view(),
            participant_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let err = process_instruction(&PROGRAM_ID, &views, &ix).unwrap_err();
        assert_eq!(err, JackpotCompatError::ParticipantNotEmpty.into());
    }

    #[test]
    fn entrypoint_rejects_wrong_participant_pda() {
        let payer = Address::new_from_array([9u8; 32]);
        let user = Address::new_from_array([5u8; 32]);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_CLAIMED);
        let (_, participant_data) = sample_participant(round_pda, user, 100, 1_000_000);
        let wrong_participant = Address::new_from_array([8u8; 32]);

        let mut payer_account = TestAccount::new(
            payer.to_bytes(),
            Address::new_from_array([0u8; 32]),
            true,
            true,
            1_000_000_000,
            &[],
        );
        let mut user_account = TestAccount::new(
            user.to_bytes(),
            Address::new_from_array([0u8; 32]),
            false,
            true,
            500_000,
            &[],
        );
        let mut round_account = TestAccount::new(
            round_pda.to_bytes(),
            PROGRAM_ID,
            false,
            false,
            1_000_000,
            &round_data,
        );
        let mut participant_account = TestAccount::new(
            wrong_participant.to_bytes(),
            PROGRAM_ID,
            false,
            true,
            222_000,
            &participant_data,
        );

        let views = [
            payer_account.view(),
            user_account.view(),
            round_account.view(),
            participant_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let err = process_instruction(&PROGRAM_ID, &views, &ix).unwrap_err();
        assert_eq!(err, ProgramError::InvalidSeeds);
    }

    #[test]
    fn entrypoint_routes_close_round_and_reclaims_vault_and_round_rent() {
        let payer = Address::new_from_array([9u8; 32]);
        let recipient = Address::new_from_array([6u8; 32]);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_CLAIMED);
        let vault = Address::new_from_array([11u8; 32]);

        let mut payer_account = TestAccount::new(
            payer.to_bytes(),
            Address::default(),
            true,
            true,
            1_000_000_000,
            &[],
        );
        let mut recipient_account = TestAccount::new(
            recipient.to_bytes(),
            Address::default(),
            false,
            true,
            500_000,
            &[],
        );
        let mut round_account = TestAccount::new(
            round_pda.to_bytes(),
            PROGRAM_ID,
            false,
            true,
            1_000_000,
            &round_data,
        );
        let mut vault_account = TestAccount::new(
            vault.to_bytes(),
            pinocchio_token::ID,
            false,
            true,
            203_928,
            &sample_vault(round_pda, 0),
        );
        let mut token_program_account = TestAccount::new(
            pinocchio_token::ID.to_bytes(),
            Address::default(),
            false,
            false,
            0,
            &[],
        );
        let mut system_program_account = TestAccount::new(
            Address::default().to_bytes(),
            Address::default(),
            false,
            false,
            0,
            &[],
        );

        let views = [
            payer_account.view(),
            recipient_account.view(),
            round_account.view(),
            vault_account.view(),
            token_program_account.view(),
            system_program_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        assert_eq!(recipient_account.lamports(), 1_703_928);
        assert_eq!(vault_account.lamports(), 0);
        assert_eq!(round_account.lamports(), 0);
        assert!(vault_account.data().iter().all(|byte| *byte == 0));
        assert!(round_account.data().iter().all(|byte| *byte == 0));
    }
}
