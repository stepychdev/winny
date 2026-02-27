use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};

#[cfg(not(test))]
use pinocchio::cpi::{Seed, Signer};
#[cfg(not(test))]
use pinocchio_token::instructions::Transfer as TokenTransfer;

use crate::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    legacy_layouts::{CONFIG_ACCOUNT_LEN, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ConfigView, ParticipantView},
    processors::refunds::RefundProcessor,
};

#[cfg(not(test))]
use crate::legacy_layouts::RoundLifecycleView;
#[cfg(test)]
use crate::{
    errors::JackpotCompatError,
    legacy_layouts::TokenAccountWithAmountView,
};

const SEED_CFG: &[u8] = b"cfg";
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

    if discriminator == instruction_discriminator("cancel_round") {
        return process_cancel_round(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("claim_refund") {
        return process_claim_refund(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_cancel_round(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [user, config, round, participant, vault, user_usdc_ata, token_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(user)?;
    require_writable(round)?;
    require_writable(participant)?;
    require_writable(vault)?;
    require_writable(user_usdc_ata)?;
    let config_view = require_config_pda(config, program_id)?;
    require_round_pda(round, program_id, instruction_data, "cancel_round")?;
    require_participant_pda(participant, user, round, program_id)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(vault, token_program)?;
    require_token_account_owned_by_program(user_usdc_ata, token_program)?;

    let refund_amount = {
        let config_data = config.try_borrow()?;
        let mut round_data = round.try_borrow_mut()?;
        let mut participant_data = participant.try_borrow_mut()?;
        let vault_data = vault.try_borrow()?;
        let user_ata_data = user_usdc_ata.try_borrow()?;

        RefundProcessor {
            user_pubkey: user.address().to_bytes(),
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: vault.address().to_bytes(),
            config_account_data: &config_data,
            round_account_data: &mut round_data[..],
            participant_account_data: &mut participant_data[..],
            vault_account_data: &vault_data,
            user_usdc_ata_data: &user_ata_data,
        }
        .process(instruction_data)?
    };

    transfer_refund(vault, user_usdc_ata, round, config_view.usdc_mint, refund_amount)
}

fn process_claim_refund(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [user, config, round, participant, vault, user_usdc_ata, token_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(user)?;
    require_writable(participant)?;
    require_writable(vault)?;
    require_writable(user_usdc_ata)?;
    let config_view = require_config_pda(config, program_id)?;
    require_round_pda(round, program_id, instruction_data, "claim_refund")?;
    require_participant_pda(participant, user, round, program_id)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(vault, token_program)?;
    require_token_account_owned_by_program(user_usdc_ata, token_program)?;

    let refund_amount = {
        let config_data = config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let mut participant_data = participant.try_borrow_mut()?;
        let vault_data = vault.try_borrow()?;
        let user_ata_data = user_usdc_ata.try_borrow()?;

        RefundProcessor {
            user_pubkey: user.address().to_bytes(),
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: vault.address().to_bytes(),
            config_account_data: &config_data,
            round_account_data: &mut round_shadow,
            participant_account_data: &mut participant_data[..],
            vault_account_data: &vault_data,
            user_usdc_ata_data: &user_ata_data,
        }
        .process(instruction_data)?
    };

    transfer_refund(vault, user_usdc_ata, round, config_view.usdc_mint, refund_amount)
}

#[cfg(not(test))]
fn transfer_refund(
    vault: &AccountView,
    user_usdc_ata: &AccountView,
    round: &AccountView,
    _usdc_mint: [u8; 32],
    refund_amount: u64,
) -> ProgramResult {
    let round_data = round.try_borrow()?;
    let round_view =
        RoundLifecycleView::read_from_account_data(&round_data).map_err(|_| ProgramError::InvalidAccountData)?;
    let round_bump = round_view.bump;
    let round_id = round_view.round_id;
    drop(round_data);

    let round_id_le = round_id.to_le_bytes();
    let round_bump_slice = [round_bump];
    let signer_seeds: [Seed<'_>; 3] = [
        Seed::from(SEED_ROUND),
        Seed::from(&round_id_le),
        Seed::from(&round_bump_slice),
    ];
    let signer = Signer::from(&signer_seeds);

    TokenTransfer {
        from: vault,
        to: user_usdc_ata,
        authority: round,
        amount: refund_amount,
    }
    .invoke_signed(&[signer])
}

#[cfg(test)]
fn transfer_refund(
    vault: &AccountView,
    user_usdc_ata: &AccountView,
    _round: &AccountView,
    _usdc_mint: [u8; 32],
    refund_amount: u64,
) -> ProgramResult {
    let vault_amount = {
        let data = vault.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };
    let user_amount = {
        let data = user_usdc_ata.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };

    let next_vault_amount = vault_amount
        .checked_sub(refund_amount)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_user_amount = user_amount
        .checked_add(refund_amount)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    {
        let mut data = vault.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_vault_amount)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }
    {
        let mut data = user_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_user_amount)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }

    Ok(())
}

fn require_signer(account: &AccountView) -> ProgramResult {
    if account.is_signer() { Ok(()) } else { Err(ProgramError::MissingRequiredSignature) }
}

fn require_writable(account: &AccountView) -> ProgramResult {
    if account.is_writable() { Ok(()) } else { Err(ProgramError::Immutable) }
}

fn require_owned_by(account: &AccountView, owner: &Address) -> ProgramResult {
    if account.owned_by(owner) { Ok(()) } else { Err(ProgramError::IncorrectProgramId) }
}

fn require_config_pda(account: &AccountView, program_id: &Address) -> Result<ConfigView, ProgramError> {
    require_owned_by(account, program_id)?;
    let (expected_address, expected_bump) = Address::find_program_address(&[SEED_CFG], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }
    let data = account.try_borrow()?;
    if data.len() != CONFIG_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("Config")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let config = ConfigView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    if config.bump != expected_bump {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(config)
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
    if data.len() != PARTICIPANT_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("Participant")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let participant = ParticipantView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    if participant.bump != expected_bump {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(())
}

fn require_token_program(account: &AccountView) -> ProgramResult {
    if account.address() == &pinocchio_token::ID { Ok(()) } else { Err(ProgramError::IncorrectProgramId) }
}

fn require_token_account_owned_by_program(account: &AccountView, token_program: &AccountView) -> ProgramResult {
    require_owned_by(account, token_program.address())
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;

    use pinocchio::account::{NOT_BORROWED, RuntimeAccount};

    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, ParticipantView, RoundLifecycleView, TokenAccountWithAmountView,
            CONFIG_ACCOUNT_LEN, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_CANCELLED, ROUND_STATUS_OPEN, TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
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
                (*raw).lamports = 1_000_000_000;
                (*raw).data_len = data.len() as u64;

                let data_ptr = (raw as *mut u8).add(size_of::<RuntimeAccount>());
                core::ptr::copy_nonoverlapping(data.as_ptr(), data_ptr, data.len());
            }

            Self { backing }
        }

        fn view(&mut self) -> AccountView {
            unsafe { AccountView::new_unchecked(self.backing.as_mut_ptr() as *mut RuntimeAccount) }
        }

        fn data(&self) -> &[u8] {
            let raw = self.backing.as_ptr() as *const RuntimeAccount;
            unsafe {
                core::slice::from_raw_parts(
                    (raw as *const u8).add(size_of::<RuntimeAccount>()),
                    (*raw).data_len as usize,
                )
            }
        }
    }

    fn sample_config(usdc_mint: Address) -> (Address, Vec<u8>) {
        let (config_pda, config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut data = vec![0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin: [7u8; 32],
            usdc_mint: usdc_mint.to_bytes(),
            treasury_usdc_ata: [3u8; 32],
            fee_bps: 25,
            ticket_unit: 10_000,
            round_duration_sec: 120,
            min_participants: 2,
            min_total_tickets: 200,
            paused: false,
            bump: config_bump,
            max_deposit_per_user: 1_000_000,
            reserved: [0u8; 24],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (config_pda, data)
    }

    fn sample_round(round_id: u64, status: u8, vault: Address, total_usdc: u64) -> (Address, Vec<u8>) {
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
            total_usdc,
            total_tickets: 100,
            participants_count: 1,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data[48..80].copy_from_slice(vault.as_ref());
        let mut idx = 1usize;
        while idx <= 128 {
            RoundLifecycleView::write_bit_node_to_account_data(&mut data, idx, 100).unwrap();
            idx <<= 1;
        }
        (round_pda, data)
    }

    fn sample_participant(round: Address, user: Address, usdc_total: u64) -> (Address, Vec<u8>) {
        let (participant_pda, participant_bump) =
            Address::find_program_address(&[SEED_PARTICIPANT, round.as_ref(), user.as_ref()], &PROGRAM_ID);
        let mut data = vec![0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Participant"));
        ParticipantView {
            round: round.to_bytes(),
            user: user.to_bytes(),
            index: 1,
            bump: participant_bump,
            tickets_total: 100,
            usdc_total,
            deposits_count: 1,
            reserved: [0u8; 16],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (participant_pda, data)
    }

    fn token_account(mint: Address, owner: Address, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(owner.as_ref());
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn entrypoint_routes_cancel_round_and_transfers_refund() {
        let user = Address::new_from_array([5u8; 32]);
        let usdc_mint = Address::new_from_array([9u8; 32]);
        let vault = Address::new_from_array([8u8; 32]);
        let (config_pda, config_data) = sample_config(usdc_mint);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_OPEN, vault, 1_000_000);
        let (participant_pda, participant_data) = sample_participant(round_pda, user, 1_000_000);

        let mut user_account = TestAccount::new(user.to_bytes(), Address::default(), true, false, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, &round_data);
        let mut participant_account = TestAccount::new(participant_pda.to_bytes(), PROGRAM_ID, false, true, &participant_data);
        let mut vault_account = TestAccount::new(vault.to_bytes(), pinocchio_token::ID, false, true, &token_account(usdc_mint, round_pda, 1_000_000));
        let mut user_ata_account = TestAccount::new(Address::new_from_array([6u8; 32]).to_bytes(), pinocchio_token::ID, false, true, &token_account(usdc_mint, user, 0));
        let mut token_program_account = TestAccount::new(pinocchio_token::ID.to_bytes(), Address::default(), false, false, &[]);

        let views = [
            user_account.view(),
            config_account.view(),
            round_account.view(),
            participant_account.view(),
            vault_account.view(),
            user_ata_account.view(),
            token_program_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("cancel_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        let round_view = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(round_view.status, ROUND_STATUS_CANCELLED);
        let participant_view = ParticipantView::read_from_account_data(participant_account.data()).unwrap();
        assert_eq!(participant_view.usdc_total, 0);
        let vault_view = TokenAccountWithAmountView::read_from_account_data(vault_account.data()).unwrap();
        assert_eq!(vault_view.amount, 0);
        let user_ata_view = TokenAccountWithAmountView::read_from_account_data(user_ata_account.data()).unwrap();
        assert_eq!(user_ata_view.amount, 1_000_000);
    }

    #[test]
    fn entrypoint_routes_claim_refund_and_transfers_refund() {
        let user = Address::new_from_array([5u8; 32]);
        let usdc_mint = Address::new_from_array([9u8; 32]);
        let vault = Address::new_from_array([8u8; 32]);
        let (config_pda, config_data) = sample_config(usdc_mint);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_CANCELLED, vault, 1_000_000);
        let (participant_pda, participant_data) = sample_participant(round_pda, user, 1_000_000);

        let mut user_account = TestAccount::new(user.to_bytes(), Address::default(), true, false, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, false, &round_data);
        let mut participant_account = TestAccount::new(participant_pda.to_bytes(), PROGRAM_ID, false, true, &participant_data);
        let mut vault_account = TestAccount::new(vault.to_bytes(), pinocchio_token::ID, false, true, &token_account(usdc_mint, round_pda, 1_000_000));
        let mut user_ata_account = TestAccount::new(Address::new_from_array([6u8; 32]).to_bytes(), pinocchio_token::ID, false, true, &token_account(usdc_mint, user, 0));
        let mut token_program_account = TestAccount::new(pinocchio_token::ID.to_bytes(), Address::default(), false, false, &[]);

        let views = [
            user_account.view(),
            config_account.view(),
            round_account.view(),
            participant_account.view(),
            vault_account.view(),
            user_ata_account.view(),
            token_program_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_refund"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        let participant_view = ParticipantView::read_from_account_data(participant_account.data()).unwrap();
        assert_eq!(participant_view.usdc_total, 0);
        let vault_view = TokenAccountWithAmountView::read_from_account_data(vault_account.data()).unwrap();
        assert_eq!(vault_view.amount, 0);
        let user_ata_view = TokenAccountWithAmountView::read_from_account_data(user_ata_account.data()).unwrap();
        assert_eq!(user_ata_view.amount, 1_000_000);
    }
}
