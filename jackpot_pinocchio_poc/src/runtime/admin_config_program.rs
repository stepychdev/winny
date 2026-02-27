use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};
#[cfg(not(test))]
use pinocchio::cpi::{Seed, Signer};
#[cfg(not(test))]
use pinocchio_system::create_account_with_minimum_balance_signed;

use crate::{
    anchor_compat::account_discriminator,
    anchor_compat::instruction_discriminator,
    legacy_layouts::{CONFIG_ACCOUNT_LEN, ConfigView, DEGEN_CONFIG_ACCOUNT_LEN, DegenConfigView},
    processors::admin_config::AdminConfigProcessor,
};

const SYSTEM_PROGRAM_ID: Address = Address::new_from_array([0u8; 32]);
const SPL_TOKEN_PROGRAM_ID: Address = Address::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
    237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);
const SEED_CFG: &[u8] = b"cfg";
const SEED_DEGEN_CFG: &[u8] = b"degen_cfg";

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .get(..8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if discriminator == instruction_discriminator("upsert_degen_config") {
        return process_upsert_degen_config(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("init_config") {
        return process_init_config(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("update_config") {
        return process_update_config(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("transfer_admin") {
        return process_transfer_admin(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("set_treasury_usdc_ata") {
        return process_set_treasury_usdc_ata(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_upsert_degen_config(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [admin, config, degen_config, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(admin)?;
    require_writable(admin)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(degen_config)?;
    let degen_config_bump =
        prepare_degen_config_pda_init_if_needed(degen_config, admin, system_program, program_id)?;

    let admin_pubkey = admin.address().to_bytes();
    let mut config_data = config.try_borrow_mut()?;
    let mut degen_config_data = degen_config.try_borrow_mut()?;

    AdminConfigProcessor {
        admin_pubkey,
        config_account_data: &mut config_data[..],
        config_bump: None,
        degen_config_account_data: Some(&mut degen_config_data[..]),
        degen_config_bump: Some(degen_config_bump),
        new_treasury_ata_pubkey: None,
        new_treasury_token_account_data: None,
        expected_owner_pubkey: None,
    }
    .process(instruction_data)
}

fn process_init_config(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [payer, admin, config, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(admin)?;
    require_writable(config)?;
    let config_bump = prepare_config_pda_init_if_needed(config, payer, system_program, program_id)?;

    let admin_pubkey = admin.address().to_bytes();
    let mut config_data = config.try_borrow_mut()?;

    AdminConfigProcessor {
        admin_pubkey,
        config_account_data: &mut config_data[..],
        config_bump: Some(config_bump),
        degen_config_account_data: None,
        degen_config_bump: None,
        new_treasury_ata_pubkey: None,
        new_treasury_token_account_data: None,
        expected_owner_pubkey: None,
    }
    .process(instruction_data)
}

fn process_update_config(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(admin)?;
    require_writable(config)?;
    let _config = require_config_pda(config, program_id)?;

    let admin_pubkey = admin.address().to_bytes();
    let mut config_data = config.try_borrow_mut()?;

    AdminConfigProcessor {
        admin_pubkey,
        config_account_data: &mut config_data[..],
        config_bump: None,
        degen_config_account_data: None,
        degen_config_bump: None,
        new_treasury_ata_pubkey: None,
        new_treasury_token_account_data: None,
        expected_owner_pubkey: None,
    }
    .process(instruction_data)
}

fn process_transfer_admin(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(admin)?;
    require_writable(config)?;
    let _config = require_config_pda(config, program_id)?;

    let admin_pubkey = admin.address().to_bytes();
    let mut config_data = config.try_borrow_mut()?;

    AdminConfigProcessor {
        admin_pubkey,
        config_account_data: &mut config_data[..],
        config_bump: None,
        degen_config_account_data: None,
        degen_config_bump: None,
        new_treasury_ata_pubkey: None,
        new_treasury_token_account_data: None,
        expected_owner_pubkey: None,
    }
    .process(instruction_data)
}

fn process_set_treasury_usdc_ata(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [admin, config, new_treasury_usdc_ata, expected_owner, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(admin)?;
    require_writable(config)?;
    let _config = require_config_pda(config, program_id)?;
    require_owned_by(new_treasury_usdc_ata, &SPL_TOKEN_PROGRAM_ID)?;

    let admin_pubkey = admin.address().to_bytes();
    let new_treasury_ata_pubkey = new_treasury_usdc_ata.address().to_bytes();
    let expected_owner_pubkey = expected_owner.address().to_bytes();
    let mut config_data = config.try_borrow_mut()?;
    let new_treasury_token_account_data = new_treasury_usdc_ata.try_borrow()?;

    AdminConfigProcessor {
        admin_pubkey,
        config_account_data: &mut config_data[..],
        config_bump: None,
        degen_config_account_data: None,
        degen_config_bump: None,
        new_treasury_ata_pubkey: Some(new_treasury_ata_pubkey),
        new_treasury_token_account_data: Some(&new_treasury_token_account_data[..]),
        expected_owner_pubkey: Some(expected_owner_pubkey),
    }
    .process(instruction_data)
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

fn prepare_degen_config_pda_init_if_needed(
    account: &AccountView,
    payer: &AccountView,
    system_program: &AccountView,
    program_id: &Address,
) -> Result<u8, ProgramError> {
    require_address(system_program, &SYSTEM_PROGRAM_ID)?;

    let (expected_address, bump) = Address::find_program_address(&[SEED_DEGEN_CFG], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    if !account.owned_by(program_id) {
        require_owned_by(account, &SYSTEM_PROGRAM_ID)?;
        create_degen_config_pda_account(account, payer, program_id, bump)?;
    }

    let data = account.try_borrow()?;
    if data.len() != DEGEN_CONFIG_ACCOUNT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    let has_discriminator = data.get(..8) == Some(&account_discriminator("DegenConfig"));
    let is_zeroed = data.iter().all(|byte| *byte == 0);

    if has_discriminator {
        let degen =
            DegenConfigView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
        if degen.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }
        return Ok(bump);
    }

    if is_zeroed {
        return Ok(bump);
    }

    Err(ProgramError::AccountAlreadyInitialized)
}

fn prepare_config_pda_init_if_needed(
    account: &AccountView,
    payer: &AccountView,
    system_program: &AccountView,
    program_id: &Address,
) -> Result<u8, ProgramError> {
    require_address(system_program, &SYSTEM_PROGRAM_ID)?;

    let (expected_address, bump) = Address::find_program_address(&[SEED_CFG], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    if !account.owned_by(program_id) {
        require_owned_by(account, &SYSTEM_PROGRAM_ID)?;
        create_config_pda_account(account, payer, program_id, bump)?;
    }

    let data = account.try_borrow()?;
    if data.len() != CONFIG_ACCOUNT_LEN || data.iter().any(|byte| *byte != 0) {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    Ok(bump)
}

#[cfg(not(test))]
fn create_degen_config_pda_account(
    account: &AccountView,
    payer: &AccountView,
    program_id: &Address,
    bump: u8,
) -> ProgramResult {
    let bump_seed = [bump];
    let seeds = [Seed::from(SEED_DEGEN_CFG), Seed::from(&bump_seed)];
    let signer = Signer::from(&seeds);
    create_account_with_minimum_balance_signed(
        account,
        DEGEN_CONFIG_ACCOUNT_LEN,
        program_id,
        payer,
        None,
        &[signer],
    )
}

#[cfg(test)]
fn create_degen_config_pda_account(
    account: &AccountView,
    _payer: &AccountView,
    program_id: &Address,
    _bump: u8,
) -> ProgramResult {
    unsafe {
        account.assign(program_id);
        account.resize_unchecked(DEGEN_CONFIG_ACCOUNT_LEN)?;
    }
    Ok(())
}

#[cfg(not(test))]
fn create_config_pda_account(
    account: &AccountView,
    payer: &AccountView,
    program_id: &Address,
    bump: u8,
) -> ProgramResult {
    let bump_seed = [bump];
    let seeds = [Seed::from(SEED_CFG), Seed::from(&bump_seed)];
    let signer = Signer::from(&seeds);
    create_account_with_minimum_balance_signed(
        account,
        CONFIG_ACCOUNT_LEN,
        program_id,
        payer,
        None,
        &[signer],
    )
}

#[cfg(test)]
fn create_config_pda_account(
    account: &AccountView,
    _payer: &AccountView,
    program_id: &Address,
    _bump: u8,
) -> ProgramResult {
    unsafe {
        account.assign(program_id);
        account.resize_unchecked(CONFIG_ACCOUNT_LEN)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;

    use pinocchio::account::{NOT_BORROWED, RuntimeAccount};

    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            CONFIG_ACCOUNT_LEN, ConfigView, DEGEN_CONFIG_ACCOUNT_LEN, DegenConfigView,
            TOKEN_ACCOUNT_CORE_LEN,
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
            Self::new_with_capacity(address, owner, is_signer, is_writable, data, data.len())
        }

        fn new_with_capacity(
            address: [u8; 32],
            owner: Address,
            is_signer: bool,
            is_writable: bool,
            data: &[u8],
            capacity: usize,
        ) -> Self {
            let bytes = size_of::<RuntimeAccount>() + capacity;
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

                if !data.is_empty() {
                    let data_ptr = (raw as *mut u8).add(size_of::<RuntimeAccount>());
                    core::ptr::copy_nonoverlapping(data.as_ptr(), data_ptr, data.len());
                }
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

    fn sample_config(admin: [u8; 32]) -> [u8; CONFIG_ACCOUNT_LEN] {
        let (_config_pda, config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let view = ConfigView {
            admin,
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
        };

        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        view.write_to_account_data(&mut data).unwrap();
        data
    }

    #[test]
    fn entrypoint_routes_update_config() {
        let admin = [7u8; 32];
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, true, &[]);
        let (config_pda, _config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut config_acc =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, true, &sample_config(admin));

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("update_config"));
        ix.push(1);
        ix.extend_from_slice(&50u16.to_le_bytes());
        ix.push(0);
        ix.push(0);
        ix.push(0);
        ix.push(0);
        ix.push(0);
        ix.push(0);

        let accounts = [admin_acc.view(), config_acc.view()];
        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = ConfigView::read_from_account_data(config_acc.data()).unwrap();
        assert_eq!(parsed.fee_bps, 50);
    }

    #[test]
    fn entrypoint_routes_init_config() {
        let payer = [6u8; 32];
        let admin = [7u8; 32];
        let mut payer_acc = TestAccount::new(payer, SYSTEM_PROGRAM_ID, true, true, &[]);
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, false, &[]);
        let (config_pda, config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut config_acc = TestAccount::new_with_capacity(
            config_pda.to_bytes(),
            SYSTEM_PROGRAM_ID,
            false,
            true,
            &[],
            CONFIG_ACCOUNT_LEN,
        );
        let mut system_program_acc =
            TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("init_config"));
        ix.extend_from_slice(&[2u8; 32]);
        ix.extend_from_slice(&[3u8; 32]);
        ix.extend_from_slice(&25u16.to_le_bytes());
        ix.extend_from_slice(&10_000u64.to_le_bytes());
        ix.extend_from_slice(&120u32.to_le_bytes());
        ix.extend_from_slice(&0u16.to_le_bytes());
        ix.extend_from_slice(&0u64.to_le_bytes());
        ix.extend_from_slice(&1_000_000u64.to_le_bytes());

        let accounts = [
            payer_acc.view(),
            admin_acc.view(),
            config_acc.view(),
            system_program_acc.view(),
        ];
        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = ConfigView::read_from_account_data(config_acc.data()).unwrap();
        assert_eq!(parsed.admin, admin);
        assert_eq!(parsed.usdc_mint, [2u8; 32]);
        assert_eq!(parsed.treasury_usdc_ata, [3u8; 32]);
        assert_eq!(parsed.bump, config_bump);
        assert_eq!(parsed.min_participants, 1);
        assert_eq!(parsed.min_total_tickets, 1);
        assert!(!parsed.paused);
    }

    #[test]
    fn entrypoint_routes_transfer_admin() {
        let admin = [7u8; 32];
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, true, &[]);
        let (config_pda, _config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut config_acc =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, true, &sample_config(admin));

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("transfer_admin"));
        ix.extend_from_slice(&[9u8; 32]);

        let accounts = [admin_acc.view(), config_acc.view()];
        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = ConfigView::read_from_account_data(config_acc.data()).unwrap();
        assert_eq!(parsed.admin, [9u8; 32]);
    }

    #[test]
    fn entrypoint_routes_set_treasury() {
        let admin = [7u8; 32];
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, true, &[]);
        let (config_pda, _config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut config_acc =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, true, &sample_config(admin));

        let mut token_account_data = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        token_account_data[..32].copy_from_slice(&[2u8; 32]);
        token_account_data[32..64].copy_from_slice(&[5u8; 32]);

        let mut new_treasury_acc = TestAccount::new(
            [4u8; 32],
            SPL_TOKEN_PROGRAM_ID,
            false,
            false,
            &token_account_data,
        );
        let mut expected_owner_acc = TestAccount::new([5u8; 32], SYSTEM_PROGRAM_ID, false, false, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("set_treasury_usdc_ata"));

        let accounts = [
            admin_acc.view(),
            config_acc.view(),
            new_treasury_acc.view(),
            expected_owner_acc.view(),
        ];
        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = ConfigView::read_from_account_data(config_acc.data()).unwrap();
        assert_eq!(parsed.treasury_usdc_ata, [4u8; 32]);
    }

    #[test]
    fn entrypoint_routes_upsert_degen_config() {
        let admin = [7u8; 32];
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, true, &[]);
        let (config_pda, _config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let (degen_pda, _degen_bump) =
            Address::find_program_address(&[SEED_DEGEN_CFG], &PROGRAM_ID);
        let config_bytes = sample_config(admin);
        let mut config_acc =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_bytes);
        let mut degen_acc = TestAccount::new(
            degen_pda.to_bytes(),
            PROGRAM_ID,
            false,
            true,
            &[0u8; DEGEN_CONFIG_ACCOUNT_LEN],
        );
        let mut system_program_acc =
            TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
        ix.extend_from_slice(&[10u8; 32]);
        ix.extend_from_slice(&0u32.to_le_bytes());

        let accounts = [
            admin_acc.view(),
            config_acc.view(),
            degen_acc.view(),
            system_program_acc.view(),
        ];
        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = DegenConfigView::read_from_account_data(degen_acc.data()).unwrap();
        assert_eq!(parsed.executor, [10u8; 32]);
        assert_eq!(parsed.fallback_timeout_sec, 300);
        assert_eq!(parsed.bump, _degen_bump);
    }

    #[test]
    fn entrypoint_routes_upsert_degen_config_init_if_needed() {
        let admin = [7u8; 32];
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, true, &[]);
        let (config_pda, _config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let (degen_pda, degen_bump) =
            Address::find_program_address(&[SEED_DEGEN_CFG], &PROGRAM_ID);
        let config_bytes = sample_config(admin);
        let mut config_acc =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_bytes);
        let mut degen_acc = TestAccount::new_with_capacity(
            degen_pda.to_bytes(),
            SYSTEM_PROGRAM_ID,
            false,
            true,
            &[],
            DEGEN_CONFIG_ACCOUNT_LEN,
        );
        let mut system_program_acc =
            TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
        ix.extend_from_slice(&[10u8; 32]);
        ix.extend_from_slice(&45u32.to_le_bytes());

        let accounts = [
            admin_acc.view(),
            config_acc.view(),
            degen_acc.view(),
            system_program_acc.view(),
        ];
        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = DegenConfigView::read_from_account_data(degen_acc.data()).unwrap();
        assert_eq!(parsed.executor, [10u8; 32]);
        assert_eq!(parsed.fallback_timeout_sec, 45);
        assert_eq!(parsed.bump, degen_bump);
    }

    #[test]
    fn entrypoint_rejects_wrong_config_pda() {
        let admin = [7u8; 32];
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, true, &[]);
        let mut config_acc =
            TestAccount::new([8u8; 32], PROGRAM_ID, false, true, &sample_config(admin));

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("transfer_admin"));
        ix.extend_from_slice(&[9u8; 32]);

        let accounts = [admin_acc.view(), config_acc.view()];
        let err = process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap_err();
        assert_eq!(err, ProgramError::InvalidSeeds);
    }

    #[test]
    fn entrypoint_rejects_wrong_degen_pda() {
        let admin = [7u8; 32];
        let mut admin_acc = TestAccount::new(admin, SYSTEM_PROGRAM_ID, true, true, &[]);
        let (config_pda, config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut config_bytes = sample_config(admin);
        let mut parsed = ConfigView::read_from_account_data(&config_bytes).unwrap();
        parsed.bump = config_bump;
        parsed.write_to_account_data(&mut config_bytes).unwrap();
        let mut config_acc =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_bytes);
        let mut degen_acc = TestAccount::new(
            [9u8; 32],
            PROGRAM_ID,
            false,
            true,
            &[0u8; DEGEN_CONFIG_ACCOUNT_LEN],
        );
        let mut system_program_acc =
            TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
        ix.extend_from_slice(&[10u8; 32]);
        ix.extend_from_slice(&0u32.to_le_bytes());

        let accounts = [
            admin_acc.view(),
            config_acc.view(),
            degen_acc.view(),
            system_program_acc.view(),
        ];
        let err = process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap_err();
        assert_eq!(err, ProgramError::InvalidSeeds);
    }
}
