use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};
#[cfg(not(test))]
use pinocchio::cpi::{Seed, Signer};
#[cfg(not(test))]
use pinocchio_associated_token_account::instructions::CreateIdempotent as CreateAssociatedTokenAccountIdempotent;
#[cfg(not(test))]
use pinocchio_system::create_account_with_minimum_balance_signed;

#[cfg(test)]
use core::sync::atomic::{AtomicI64, Ordering};
#[cfg(not(test))]
use pinocchio::sysvars::{Sysvar, clock::Clock};

use crate::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    legacy_layouts::{
        CONFIG_ACCOUNT_LEN, ConfigView, ROUND_ACCOUNT_LEN, TOKEN_ACCOUNT_CORE_LEN,
        TokenAccountCoreView,
    },
    processors::round_lifecycle::RoundLifecycleProcessor,
};

const SEED_CFG: &[u8] = b"cfg";
const SEED_ROUND: &[u8] = b"round";
const SYSTEM_PROGRAM_ID: Address = solana_address::address!("11111111111111111111111111111111");

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

    if discriminator == instruction_discriminator("lock_round") {
        return process_lock_round(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("start_round") {
        return process_start_round(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("admin_force_cancel") {
        return process_admin_force_cancel(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_lock_round(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [caller, config, round, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(caller)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(round)?;
    require_round_pda(round, program_id, instruction_data, "lock_round")?;

    let current_unix_timestamp = current_unix_timestamp()?;
    let caller_pubkey = caller.address().to_bytes();
    let config_data = config.try_borrow()?;
    let mut round_data = round.try_borrow_mut()?;

    RoundLifecycleProcessor {
        caller_pubkey,
        round_pubkey: None,
        round_bump: None,
        vault_pubkey: None,
        usdc_mint_pubkey: None,
        config_account_data: &config_data,
        round_account_data: &mut round_data[..],
        vault_account_data: None,
        current_unix_timestamp,
    }
    .process(instruction_data)
}

fn process_start_round(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (
        payer,
        config,
        round,
        vault_usdc_ata,
        usdc_mint,
        associated_token_program,
        token_program,
        system_program,
    ) = match accounts {
        [payer, config, round, vault_usdc_ata, usdc_mint, associated_token_program, token_program, system_program, ..] => {
            (payer, config, round, vault_usdc_ata, usdc_mint, associated_token_program, token_program, system_program)
        }
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    require_signer(payer)?;
    let config_view = require_config_pda(config, program_id)?;
    require_writable(round)?;
    let round_id = crate::instruction_layouts::parse_round_id_ix(instruction_data, "start_round")
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let round_bump = prepare_round_pda_for_start(round, payer, system_program, program_id, round_id)?;
    require_writable(vault_usdc_ata)?;
    require_associated_token_program(associated_token_program)?;
    require_mint_owned_by_program(usdc_mint, token_program)?;
    if usdc_mint.address().to_bytes() != config_view.usdc_mint {
        return Err(ProgramError::InvalidAccountData);
    }
    prepare_vault_ata_for_start(
        payer,
        vault_usdc_ata,
        round,
        usdc_mint,
        associated_token_program,
        token_program,
        system_program,
    )?;
    require_token_account_owned_by_program(vault_usdc_ata, token_program)?;

    let caller_pubkey = payer.address().to_bytes();
    let config_data = config.try_borrow()?;
    let vault_data = vault_usdc_ata.try_borrow()?;
    let mut round_data = round.try_borrow_mut()?;

    RoundLifecycleProcessor {
        caller_pubkey,
        round_pubkey: Some(round.address().to_bytes()),
        round_bump: Some(round_bump),
        vault_pubkey: Some(vault_usdc_ata.address().to_bytes()),
        usdc_mint_pubkey: Some(usdc_mint.address().to_bytes()),
        config_account_data: &config_data,
        round_account_data: &mut round_data[..],
        vault_account_data: Some(&vault_data),
        current_unix_timestamp: current_unix_timestamp()?,
    }
    .process(instruction_data)
}

fn process_admin_force_cancel(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [admin, config, round, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(admin)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(round)?;
    require_round_pda(round, program_id, instruction_data, "admin_force_cancel")?;

    let caller_pubkey = admin.address().to_bytes();
    let config_data = config.try_borrow()?;
    let mut round_data = round.try_borrow_mut()?;

    RoundLifecycleProcessor {
        caller_pubkey,
        round_pubkey: None,
        round_bump: None,
        vault_pubkey: None,
        usdc_mint_pubkey: None,
        config_account_data: &config_data,
        round_account_data: &mut round_data[..],
        vault_account_data: None,
        current_unix_timestamp: 0,
    }
    .process(instruction_data)
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

fn require_address(account: &AccountView, address: &Address) -> ProgramResult {
    if account.address() == address {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
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

fn prepare_round_pda_for_start(
    account: &AccountView,
    payer: &AccountView,
    system_program: &AccountView,
    program_id: &Address,
    round_id: u64,
) -> Result<u8, ProgramError> {
    require_address(system_program, &SYSTEM_PROGRAM_ID)?;

    let (expected_address, bump) =
        Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    if !account.owned_by(program_id) {
        require_owned_by(account, &SYSTEM_PROGRAM_ID)?;
        create_round_pda_account(account, payer, program_id, round_id, bump)?;
    }

    let data = account.try_borrow()?;
    if data.len() != ROUND_ACCOUNT_LEN || data.iter().any(|byte| *byte != 0) {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    Ok(bump)
}

fn prepare_vault_ata_for_start(
    payer: &AccountView,
    vault_usdc_ata: &AccountView,
    round: &AccountView,
    usdc_mint: &AccountView,
    associated_token_program: &AccountView,
    token_program: &AccountView,
    system_program: &AccountView,
) -> ProgramResult {
    require_associated_token_program(associated_token_program)?;
    require_token_program(token_program)?;
    require_address(system_program, &SYSTEM_PROGRAM_ID)?;
    require_associated_token_address(vault_usdc_ata, round, usdc_mint, token_program)?;

    if !vault_usdc_ata.owned_by(token_program.address()) {
        require_owned_by(vault_usdc_ata, &SYSTEM_PROGRAM_ID)?;
        create_vault_ata_account(
            payer,
            vault_usdc_ata,
            round,
            usdc_mint,
            associated_token_program,
            token_program,
            system_program,
        )?;
    }

    let vault = {
        let data = vault_usdc_ata.try_borrow()?;
        TokenAccountCoreView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
    };
    if vault.mint != usdc_mint.address().to_bytes() || vault.owner != round.address().to_bytes() {
        return Err(ProgramError::InvalidAccountData);
    }

    Ok(())
}

#[cfg(not(test))]
fn create_round_pda_account(
    account: &AccountView,
    payer: &AccountView,
    program_id: &Address,
    round_id: u64,
    bump: u8,
) -> ProgramResult {
    let round_id_bytes = round_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = [
        Seed::from(SEED_ROUND),
        Seed::from(&round_id_bytes),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds);
    create_account_with_minimum_balance_signed(
        account,
        ROUND_ACCOUNT_LEN,
        program_id,
        payer,
        None,
        &[signer],
    )
}

#[cfg(test)]
fn create_round_pda_account(
    account: &AccountView,
    _payer: &AccountView,
    program_id: &Address,
    _round_id: u64,
    _bump: u8,
) -> ProgramResult {
    unsafe {
        account.assign(program_id);
        account.resize_unchecked(ROUND_ACCOUNT_LEN)?;
    }
    Ok(())
}

#[cfg(not(test))]
fn create_vault_ata_account(
    payer: &AccountView,
    vault_usdc_ata: &AccountView,
    round: &AccountView,
    usdc_mint: &AccountView,
    _associated_token_program: &AccountView,
    token_program: &AccountView,
    system_program: &AccountView,
) -> ProgramResult {
    CreateAssociatedTokenAccountIdempotent {
        funding_account: payer,
        account: vault_usdc_ata,
        wallet: round,
        mint: usdc_mint,
        system_program,
        token_program,
    }
    .invoke()
}

#[cfg(test)]
fn create_vault_ata_account(
    _payer: &AccountView,
    vault_usdc_ata: &AccountView,
    round: &AccountView,
    usdc_mint: &AccountView,
    _associated_token_program: &AccountView,
    token_program: &AccountView,
    _system_program: &AccountView,
) -> ProgramResult {
    unsafe {
        vault_usdc_ata.assign(token_program.address());
        vault_usdc_ata.resize_unchecked(TOKEN_ACCOUNT_CORE_LEN)?;
    }
    let mut data = vault_usdc_ata.try_borrow_mut()?;
    data[..32].copy_from_slice(usdc_mint.address().as_ref());
    data[32..64].copy_from_slice(round.address().as_ref());
    Ok(())
}

fn require_token_program(account: &AccountView) -> ProgramResult {
    if account.address() == &pinocchio_token::ID {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

fn require_associated_token_program(account: &AccountView) -> ProgramResult {
    if account.address() == &pinocchio_associated_token_account::ID {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

fn require_associated_token_address(
    account: &AccountView,
    wallet: &AccountView,
    mint: &AccountView,
    token_program: &AccountView,
) -> ProgramResult {
    let (expected_address, _) = Address::find_program_address(
        &[wallet.address().as_ref(), token_program.address().as_ref(), mint.address().as_ref()],
        &pinocchio_associated_token_account::ID,
    );
    if account.address() == &expected_address {
        Ok(())
    } else {
        Err(ProgramError::InvalidSeeds)
    }
}

fn require_token_account_owned_by_program(account: &AccountView, token_program: &AccountView) -> ProgramResult {
    require_owned_by(account, token_program.address())?;
    let data = account.try_borrow()?;
    if data.len() < TOKEN_ACCOUNT_CORE_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    TokenAccountCoreView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

fn require_mint_owned_by_program(account: &AccountView, token_program: &AccountView) -> ProgramResult {
    require_owned_by(account, token_program.address())
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;
    use std::sync::Mutex;

    use pinocchio::account::{NOT_BORROWED, RuntimeAccount};

    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            TOKEN_ACCOUNT_CORE_LEN, ROUND_STATUS_CANCELLED, ROUND_STATUS_LOCKED,
            ROUND_STATUS_OPEN,
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

    fn sample_config(admin: Address) -> Vec<u8> {
        let (_config_pda, config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut data = vec![0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin: admin.to_bytes(),
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
        data
    }

    fn sample_round(round_id: u64, status: u8) -> (Address, Vec<u8>) {
        let (round_pda, _) =
            Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let mut data = vec![0u8; ROUND_ACCOUNT_LEN];
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
        (round_pda, data)
    }

    #[test]
    fn entrypoint_routes_lock_round() {
        let _guard = TEST_GUARD.lock().unwrap();
        TEST_UNIX_TIMESTAMP.store(130, Ordering::Relaxed);

        let caller = Address::new_from_array([9u8; 32]);
        let admin = Address::new_from_array([7u8; 32]);
        let (config_pda, _) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_OPEN);

        let mut caller_account = TestAccount::new(caller.to_bytes(), Address::new_from_array([0u8; 32]), true, false, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &sample_config(admin));
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, &round_data);

        let views = [caller_account.view(), config_account.view(), round_account.view()];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("lock_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_LOCKED);
    }

    #[test]
    fn entrypoint_routes_start_round() {
        let _guard = TEST_GUARD.lock().unwrap();
        TEST_UNIX_TIMESTAMP.store(777, Ordering::Relaxed);

        let payer = Address::new_from_array([9u8; 32]);
        let usdc_mint = Address::new_from_array([2u8; 32]);
        let (config_pda, _) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let round_id = 81u64;
        let (round_pda, round_bump) =
            Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let token_program = pinocchio_token::ID;
        let associated_token_program = pinocchio_associated_token_account::ID;
        let (vault_ata, _) = Address::find_program_address(
            &[round_pda.as_ref(), token_program.as_ref(), usdc_mint.as_ref()],
            &associated_token_program,
        );
        let system_program = SYSTEM_PROGRAM_ID;

        let mut payer_account =
            TestAccount::new(payer.to_bytes(), Address::new_from_array([0u8; 32]), true, true, &[]);
        let mut config_account =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &sample_config(payer));
        let mut round_account = TestAccount::new_with_capacity(
            round_pda.to_bytes(),
            system_program,
            false,
            true,
            &[],
            ROUND_ACCOUNT_LEN,
        );
        let mut vault_account = TestAccount::new_with_capacity(
            vault_ata.to_bytes(),
            system_program,
            false,
            true,
            &[],
            TOKEN_ACCOUNT_CORE_LEN,
        );
        let mut mint_account =
            TestAccount::new(usdc_mint.to_bytes(), token_program, false, false, &[]);
        let mut associated_token_program_account = TestAccount::new(
            associated_token_program.to_bytes(),
            Address::new_from_array([0u8; 32]),
            false,
            false,
            &[],
        );
        let mut token_program_account =
            TestAccount::new(token_program.to_bytes(), Address::new_from_array([0u8; 32]), false, false, &[]);
        let mut system_program_account =
            TestAccount::new(system_program.to_bytes(), Address::new_from_array([0u8; 32]), false, false, &[]);

        let views = [
            payer_account.view(),
            config_account.view(),
            round_account.view(),
            vault_account.view(),
            mint_account.view(),
            associated_token_program_account.view(),
            token_program_account.view(),
            system_program_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("start_round"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        let round = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(round.round_id, round_id);
        assert_eq!(round.status, ROUND_STATUS_OPEN);
        assert_eq!(round.bump, round_bump);
        assert_eq!(round.start_ts, 777);
        assert_eq!(
            RoundLifecycleView::read_vault_pubkey_from_account_data(round_account.data()).unwrap(),
            vault_ata.to_bytes(),
        );
    }

    #[test]
    fn entrypoint_routes_admin_force_cancel() {
        let admin = Address::new_from_array([7u8; 32]);
        let (config_pda, _) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let (round_pda, round_data) = sample_round(81, ROUND_STATUS_OPEN);

        let mut admin_account = TestAccount::new(admin.to_bytes(), Address::new_from_array([0u8; 32]), true, false, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &sample_config(admin));
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, &round_data);

        let views = [admin_account.view(), config_account.view(), round_account.view()];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("admin_force_cancel"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_CANCELLED);
    }

    #[test]
    fn entrypoint_rejects_wrong_round_pda() {
        let caller = Address::new_from_array([9u8; 32]);
        let admin = Address::new_from_array([7u8; 32]);
        let (config_pda, _) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let (_, round_data) = sample_round(81, ROUND_STATUS_OPEN);
        let wrong_round = Address::new_from_array([6u8; 32]);

        let mut caller_account = TestAccount::new(caller.to_bytes(), Address::new_from_array([0u8; 32]), true, false, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &sample_config(admin));
        let mut round_account = TestAccount::new(wrong_round.to_bytes(), PROGRAM_ID, false, true, &round_data);

        let views = [caller_account.view(), config_account.view(), round_account.view()];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("lock_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let err = process_instruction(&PROGRAM_ID, &views, &ix).unwrap_err();
        assert_eq!(err, ProgramError::InvalidSeeds);
    }
}
