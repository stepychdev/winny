use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};
#[cfg(not(test))]
use pinocchio::cpi::{Seed, Signer};
#[cfg(not(test))]
use pinocchio_system::create_account_with_minimum_balance_signed;

#[cfg(test)]
use core::sync::atomic::{AtomicI64, Ordering};
#[cfg(not(test))]
use pinocchio::sysvars::{Sysvar, clock::Clock};
#[cfg(not(test))]
use pinocchio_token::instructions::Transfer as TokenTransfer;
#[cfg(test)]
use crate::{
    errors::JackpotCompatError,
    legacy_layouts::TokenAccountWithAmountView,
};

use solana_address::address;

use crate::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    legacy_layouts::{
        CONFIG_ACCOUNT_LEN, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, TOKEN_ACCOUNT_CORE_LEN,
        ConfigView, ParticipantView,
    },
    processors::deposits::DepositProcessor,
};

const SEED_CFG: &[u8] = b"cfg";
const SEED_ROUND: &[u8] = b"round";
const SEED_PARTICIPANT: &[u8] = b"p";
const SYSTEM_PROGRAM_ID: Address = address!("11111111111111111111111111111111");

#[cfg(test)]
static TEST_UNIX_TIMESTAMP: AtomicI64 = AtomicI64::new(0);

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .get(..8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if discriminator == instruction_discriminator("deposit_any") {
        return process_deposit_any(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_deposit_any(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [user, config, round, participant, user_usdc_ata, vault_usdc_ata, token_program, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(user)?;
    require_writable(user)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(round)?;
    let round_id = crate::instruction_layouts::DepositAnyArgsCompat::parse(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?
        .round_id;
    require_round_pda(round, program_id, round_id)?;
    require_writable(participant)?;
    require_writable(user_usdc_ata)?;
    require_writable(vault_usdc_ata)?;
    require_token_program(token_program)?;
    require_address(system_program, &SYSTEM_PROGRAM_ID)?;
    let participant_bump =
        prepare_participant_pda_init_if_needed(participant, user, round, system_program, program_id)?;
    require_token_account_owned_by_program(user_usdc_ata, token_program)?;
    require_token_account_owned_by_program(vault_usdc_ata, token_program)?;

    let (delta, round_shadow, participant_shadow) = {
        let config_data = config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let participant_data = participant.try_borrow()?;
        let mut participant_shadow = participant_data.to_vec();
        let user_ata_data = user_usdc_ata.try_borrow()?;
        let vault_ata_data = vault_usdc_ata.try_borrow()?;

        let mut processor = DepositProcessor {
            user_pubkey: user.address().to_bytes(),
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: vault_usdc_ata.address().to_bytes(),
            participant_bump,
            current_unix_timestamp: current_unix_timestamp()?,
            config_account_data: &config_data,
            round_account_data: &mut round_shadow,
            participant_account_data: &mut participant_shadow,
            user_usdc_ata_data: &user_ata_data,
            vault_account_data: &vault_ata_data,
        };
        let delta = processor.process(instruction_data)?;
        (delta, round_shadow, participant_shadow)
    };

    transfer_deposit(user_usdc_ata, vault_usdc_ata, user, delta)?;

    {
        let mut round_data = round.try_borrow_mut()?;
        round_data.copy_from_slice(&round_shadow);
    }
    {
        let mut participant_data = participant.try_borrow_mut()?;
        participant_data.copy_from_slice(&participant_shadow);
    }

    Ok(())
}

#[cfg(not(test))]
fn transfer_deposit(
    user_usdc_ata: &AccountView,
    vault_usdc_ata: &AccountView,
    user: &AccountView,
    delta: u64,
) -> ProgramResult {
    TokenTransfer {
        from: user_usdc_ata,
        to: vault_usdc_ata,
        authority: user,
        amount: delta,
    }
    .invoke()
}

#[cfg(test)]
fn transfer_deposit(
    user_usdc_ata: &AccountView,
    vault_usdc_ata: &AccountView,
    _user: &AccountView,
    delta: u64,
) -> ProgramResult {
    let user_amount = {
        let data = user_usdc_ata.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };
    let vault_amount = {
        let data = vault_usdc_ata.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };

    let next_user = user_amount
        .checked_sub(delta)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_vault = vault_amount
        .checked_add(delta)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    {
        let mut data = user_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_user)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }
    {
        let mut data = vault_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_vault)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }

    Ok(())
}

fn current_unix_timestamp() -> Result<i64, ProgramError> {
    #[cfg(test)]
    {
        return Ok(TEST_UNIX_TIMESTAMP.load(Ordering::Relaxed));
    }

    #[cfg(not(test))]
    {
        Ok(Clock::get()?.unix_timestamp)
    }
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

fn require_address(account: &AccountView, address: &Address) -> ProgramResult {
    if account.address() == address { Ok(()) } else { Err(ProgramError::IncorrectProgramId) }
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

fn require_round_pda(account: &AccountView, program_id: &Address, round_id: u64) -> ProgramResult {
    require_owned_by(account, program_id)?;
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

fn prepare_participant_pda_init_if_needed(
    account: &AccountView,
    user: &AccountView,
    round: &AccountView,
    system_program: &AccountView,
    program_id: &Address,
) -> Result<u8, ProgramError> {
    let (expected_address, bump) =
        Address::find_program_address(&[SEED_PARTICIPANT, round.address().as_ref(), user.address().as_ref()], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    if !account.owned_by(program_id) {
        require_address(system_program, &SYSTEM_PROGRAM_ID)?;
        require_owned_by(account, &SYSTEM_PROGRAM_ID)?;
        create_participant_pda_account(account, user, round, program_id, bump)?;
    }

    let data = account.try_borrow()?;
    if data.len() != PARTICIPANT_ACCOUNT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let is_zeroed = data.iter().all(|byte| *byte == 0);
    if !is_zeroed && data.get(..8) != Some(&account_discriminator("Participant")) {
        return Err(ProgramError::InvalidAccountData);
    }
    if !is_zeroed {
        let participant = ParticipantView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
        if participant.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }
    }
    Ok(bump)
}

#[cfg(not(test))]
fn create_participant_pda_account(
    account: &AccountView,
    payer: &AccountView,
    round: &AccountView,
    program_id: &Address,
    bump: u8,
) -> ProgramResult {
    let bump_seed = [bump];
    let seeds = [
        Seed::from(SEED_PARTICIPANT),
        Seed::from(round.address().as_ref()),
        Seed::from(payer.address().as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds);
    create_account_with_minimum_balance_signed(
        account,
        PARTICIPANT_ACCOUNT_LEN,
        program_id,
        payer,
        None,
        &[signer],
    )
}

#[cfg(test)]
fn create_participant_pda_account(
    account: &AccountView,
    _payer: &AccountView,
    _round: &AccountView,
    program_id: &Address,
    _bump: u8,
) -> ProgramResult {
    unsafe {
        account.assign(program_id);
        account.resize_unchecked(PARTICIPANT_ACCOUNT_LEN)?;
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

fn require_token_account_owned_by_program(account: &AccountView, token_program: &AccountView) -> ProgramResult {
    require_owned_by(account, token_program.address())?;
    let data = account.try_borrow()?;
    if data.len() < TOKEN_ACCOUNT_CORE_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    crate::legacy_layouts::TokenAccountCoreView::read_from_account_data(&data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;
    use std::sync::Mutex;

    use pinocchio::account::{NOT_BORROWED, RuntimeAccount};

    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, ParticipantView, RoundLifecycleView, TokenAccountWithAmountView,
            CONFIG_ACCOUNT_LEN, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ROUND_STATUS_OPEN,
            TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
        },
    };

    use super::*;

    const PROGRAM_ID: Address = Address::new_from_array([
        43, 187, 24, 179, 245, 85, 238, 77, 204, 252, 3, 113, 231, 169, 27, 207, 165, 14, 251,
        108, 242, 117, 20, 87, 30, 9, 66, 30, 58, 230, 228, 54,
    ]);
    static TEST_GUARD: Mutex<()> = Mutex::new(());

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
            Self::new_with_capacity(address, owner, is_signer, is_writable, data, data.len())
        }

        fn new_with_capacity(
            address: [u8; 32],
            owner: Address,
            is_signer: bool,
            is_writable: bool,
            data: &[u8],
            data_capacity: usize,
        ) -> Self {
            let bytes = size_of::<RuntimeAccount>() + data_capacity.max(data.len());
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

    fn sample_config() -> (Address, Vec<u8>) {
        let (config_pda, config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut data = vec![0u8; CONFIG_ACCOUNT_LEN];
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
            bump: config_bump,
            max_deposit_per_user: 1_000_000,
            reserved: [0u8; 24],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (config_pda, data)
    }

    fn sample_round(round_id: u64, vault: Address) -> (Address, Vec<u8>) {
        let (round_pda, round_bump) =
            Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let mut data = vec![0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status: ROUND_STATUS_OPEN,
            bump: round_bump,
            start_ts: 10,
            end_ts: 0,
            first_deposit_ts: 0,
            total_usdc: 0,
            total_tickets: 0,
            participants_count: 0,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        RoundLifecycleView::write_vault_pubkey_to_account_data(&mut data, &vault.to_bytes()).unwrap();
        (round_pda, data)
    }

    fn token_account(mint: Address, owner: Address, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(owner.as_ref());
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn entrypoint_routes_deposit_and_transfers_balances() {
        let _guard = TEST_GUARD.lock().unwrap();
        TEST_UNIX_TIMESTAMP.store(1_000, Ordering::Relaxed);

        let user = Address::new_from_array([5u8; 32]);
        let usdc_mint = Address::new_from_array([2u8; 32]);
        let (config_pda, config_data) = sample_config();
        let vault = Address::new_from_array([9u8; 32]);
        let (round_pda, round_data) = sample_round(81, vault);
        let (participant_pda, _) = Address::find_program_address(
            &[SEED_PARTICIPANT, round_pda.as_ref(), user.as_ref()],
            &PROGRAM_ID,
        );
        let user_ata = token_account(usdc_mint, user, 40_000);
        let vault_ata = token_account(usdc_mint, round_pda, 0);

        let mut user_acc = TestAccount::new(user.to_bytes(), SYSTEM_PROGRAM_ID, true, true, &[]);
        let mut config_acc = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_data);
        let mut round_acc = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, &round_data);
        let mut participant_acc = TestAccount::new_with_capacity(
            participant_pda.to_bytes(),
            SYSTEM_PROGRAM_ID,
            false,
            true,
            &[],
            PARTICIPANT_ACCOUNT_LEN,
        );
        let mut user_ata_acc = TestAccount::new([31u8; 32], pinocchio_token::ID, false, true, &user_ata);
        let mut vault_ata_acc = TestAccount::new(vault.to_bytes(), pinocchio_token::ID, false, true, &vault_ata);
        let mut token_program_acc = TestAccount::new(pinocchio_token::ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, &[]);
        let mut system_program_acc = TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("deposit_any"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());
        ix.extend_from_slice(&20_000u64.to_le_bytes());

        let accounts = &mut [
            user_acc.view(),
            config_acc.view(),
            round_acc.view(),
            participant_acc.view(),
            user_ata_acc.view(),
            vault_ata_acc.view(),
            token_program_acc.view(),
            system_program_acc.view(),
        ];

        process_instruction(&PROGRAM_ID, accounts, &ix).unwrap();

        let round_view = RoundLifecycleView::read_from_account_data(round_acc.data()).unwrap();
        assert_eq!(round_view.participants_count, 1);
        assert_eq!(round_view.total_usdc, 20_000);
        assert_eq!(round_view.total_tickets, 2);
        let participant_view = ParticipantView::read_from_account_data(participant_acc.data()).unwrap();
        assert_eq!(participant_view.index, 1);
        assert_eq!(participant_view.tickets_total, 2);
        let user_amount = TokenAccountWithAmountView::read_from_account_data(user_ata_acc.data()).unwrap().amount;
        let vault_amount = TokenAccountWithAmountView::read_from_account_data(vault_ata_acc.data()).unwrap().amount;
        assert_eq!(user_amount, 20_000);
        assert_eq!(vault_amount, 20_000);
    }
}
