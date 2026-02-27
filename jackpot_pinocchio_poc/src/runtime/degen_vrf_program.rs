extern crate alloc;

#[cfg(not(test))]
use alloc::vec::Vec;

use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};
#[cfg(not(test))]
use pinocchio::{
    cpi::{Seed, Signer, invoke_signed},
    instruction::{InstructionAccount, InstructionView},
    sysvars::Sysvar,
};
#[cfg(not(test))]
use pinocchio_system::create_account_with_minimum_balance_signed;
use solana_address::address;

use crate::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    legacy_layouts::{
        ConfigView, DegenClaimView, DegenConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN,
        DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
    },
    processors::degen_vrf::DegenVrfProcessor,
};

mod degen_vrf_constants {
    include!(concat!(env!("OUT_DIR"), "/vrf_constants.rs"));
}
use degen_vrf_constants::{DEFAULT_QUEUE, VRF_PROGRAM_ID, VRF_PROGRAM_IDENTITY};

const SEED_CFG: &[u8] = b"cfg";
const SEED_ROUND: &[u8] = b"round";
const SEED_DEGEN_CLAIM: &[u8] = b"degen_claim";
const SEED_DEGEN_CFG: &[u8] = b"degen_cfg";
const SEED_IDENTITY: &[u8] = b"identity";
const SYSTEM_PROGRAM_ID: Address = address!("11111111111111111111111111111111");
const SLOT_HASHES_SYSVAR_ID: Address = address!("SysvarS1otHashes111111111111111111111111111");

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .get(..8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if discriminator == instruction_discriminator("request_degen_vrf") {
        return process_request_degen_vrf(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("degen_vrf_callback") {
        return process_degen_vrf_callback(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_request_degen_vrf(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [winner, config, round, degen_claim, program_identity, oracle_queue, vrf_program, slot_hashes, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(winner)?;
    require_writable(winner)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(round)?;
    require_round_pda(round, program_id, instruction_data, "request_degen_vrf")?;
    require_writable(degen_claim)?;
    let degen_claim_bump = prepare_degen_claim_pda_init_if_needed(
        degen_claim,
        winner,
        system_program,
        program_id,
        instruction_data,
    )?;
    require_program_identity_pda(program_identity, program_id)?;
    require_writable(oracle_queue)?;
    require_address(oracle_queue, &DEFAULT_QUEUE)?;
    require_address(vrf_program, &VRF_PROGRAM_ID)?;
    require_address(slot_hashes, &SLOT_HASHES_SYSVAR_ID)?;
    require_address(system_program, &SYSTEM_PROGRAM_ID)?;

    {
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let mut degen_claim_shadow = degen_claim.try_borrow()?.to_vec();
        let mut processor = DegenVrfProcessor {
            winner_pubkey: winner.address().to_bytes(),
            round_pubkey: round.address().to_bytes(),
            degen_claim_bump,
            now_ts: clock_unix_timestamp(),
            config_account_data: &[],
            round_account_data: &mut round_shadow,
            degen_claim_account_data: &mut degen_claim_shadow,
            degen_config_account_data: None,
        };
        processor.process(instruction_data)?;
    }

    invoke_degen_vrf_request(program_id, winner, config, round, degen_claim, program_identity, oracle_queue, vrf_program, slot_hashes, system_program)?;

    let mut round_data = round.try_borrow_mut()?;
    let mut degen_claim_data = degen_claim.try_borrow_mut()?;
    let mut processor = DegenVrfProcessor {
        winner_pubkey: winner.address().to_bytes(),
        round_pubkey: round.address().to_bytes(),
        degen_claim_bump,
        now_ts: clock_unix_timestamp(),
        config_account_data: &[],
        round_account_data: &mut round_data[..],
        degen_claim_account_data: &mut degen_claim_data[..],
        degen_config_account_data: None,
    };
    processor.process(instruction_data)
}

fn process_degen_vrf_callback(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [vrf_program_identity, config, round, degen_claim, degen_config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(vrf_program_identity)?;
    require_address(vrf_program_identity, &VRF_PROGRAM_IDENTITY)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(round)?;
    require_writable(degen_claim)?;
    require_round_self_pda(round, program_id)?;
    require_existing_degen_claim_pda(degen_claim, program_id, round)?;
    require_degen_config_pda(degen_config, program_id)?;

    let config_data = config.try_borrow()?;
    let degen_config_data = degen_config.try_borrow()?;
    let mut round_data = round.try_borrow_mut()?;
    let mut degen_claim_data = degen_claim.try_borrow_mut()?;
    let mut processor = DegenVrfProcessor {
        winner_pubkey: [0u8; 32],
        round_pubkey: round.address().to_bytes(),
        degen_claim_bump: 0,
        now_ts: clock_unix_timestamp(),
        config_account_data: &config_data,
        round_account_data: &mut round_data[..],
        degen_claim_account_data: &mut degen_claim_data[..],
        degen_config_account_data: if degen_config_data.is_empty() {
            None
        } else {
            Some(&degen_config_data[..])
        },
    };
    processor.process(instruction_data)
}

#[cfg(not(test))]
fn invoke_degen_vrf_request(
    program_id: &Address,
    winner: &AccountView,
    config: &AccountView,
    round: &AccountView,
    degen_claim: &AccountView,
    program_identity: &AccountView,
    oracle_queue: &AccountView,
    vrf_program: &AccountView,
    slot_hashes: &AccountView,
    system_program: &AccountView,
) -> ProgramResult {
    let round_data = round.try_borrow()?;
    let round_view = RoundLifecycleView::read_from_account_data(&round_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    drop(round_data);

    let round_id_le = round_view.round_id.to_le_bytes();
    let (_, identity_bump) = Address::find_program_address(&[SEED_IDENTITY], program_id);
    let identity_bump_slice = [identity_bump];
    let signer_seeds: [Seed<'_>; 2] = [Seed::from(SEED_IDENTITY), Seed::from(&identity_bump_slice)];
    let signer = Signer::from(&signer_seeds);

    let callback_accounts = [
        SerializableAccountMetaCompat {
            pubkey: config.address().to_bytes(),
            is_signer: false,
            is_writable: false,
        },
        SerializableAccountMetaCompat {
            pubkey: round.address().to_bytes(),
            is_signer: false,
            is_writable: true,
        },
        SerializableAccountMetaCompat {
            pubkey: degen_claim.address().to_bytes(),
            is_signer: false,
            is_writable: true,
        },
        SerializableAccountMetaCompat {
            pubkey: Address::find_program_address(&[SEED_DEGEN_CFG], program_id).0.to_bytes(),
            is_signer: false,
            is_writable: false,
        },
    ];
    let callback_discriminator = instruction_discriminator("degen_vrf_callback");
    let ix_data = build_request_randomness_ix_data(
        program_id.clone(),
        winner.address().to_bytes(),
        round_id_le,
        &callback_discriminator,
        &callback_accounts,
    );

    let instruction_accounts: [InstructionAccount; 5] = [
        InstructionAccount::writable_signer(winner.address()),
        InstructionAccount::readonly_signer(program_identity.address()),
        InstructionAccount::writable(oracle_queue.address()),
        InstructionAccount::readonly(system_program.address()),
        InstructionAccount::readonly(slot_hashes.address()),
    ];

    let instruction = InstructionView {
        program_id: vrf_program.address(),
        accounts: &instruction_accounts,
        data: &ix_data,
    };

    invoke_signed(
        &instruction,
        &[winner, program_identity, oracle_queue, system_program, slot_hashes],
        &[signer],
    )
}

#[cfg(test)]
fn invoke_degen_vrf_request(
    _program_id: &Address,
    _winner: &AccountView,
    _config: &AccountView,
    _round: &AccountView,
    _degen_claim: &AccountView,
    _program_identity: &AccountView,
    _oracle_queue: &AccountView,
    _vrf_program: &AccountView,
    _slot_hashes: &AccountView,
    _system_program: &AccountView,
) -> ProgramResult {
    Ok(())
}

#[cfg(not(test))]
#[derive(Clone, Copy)]
struct SerializableAccountMetaCompat {
    pub pubkey: [u8; 32],
    pub is_signer: bool,
    pub is_writable: bool,
}

#[cfg(not(test))]
fn build_request_randomness_ix_data(
    callback_program_id: Address,
    winner_pubkey: [u8; 32],
    round_id_le: [u8; 8],
    callback_discriminator: &[u8; 8],
    callback_accounts: &[SerializableAccountMetaCompat],
) -> Vec<u8> {
    let mut caller_seed = [0u8; 32];
    caller_seed[..8].copy_from_slice(&round_id_le);
    caller_seed[8..].copy_from_slice(&winner_pubkey[..24]);

    let mut data = Vec::with_capacity(8 + 32 + 32 + 4 + 8 + 4 + (callback_accounts.len() * 34) + 4);
    data.extend_from_slice(&[3, 0, 0, 0, 0, 0, 0, 0]);
    data.extend_from_slice(&caller_seed);
    data.extend_from_slice(callback_program_id.as_array());
    data.extend_from_slice(&(callback_discriminator.len() as u32).to_le_bytes());
    data.extend_from_slice(callback_discriminator);
    data.extend_from_slice(&(callback_accounts.len() as u32).to_le_bytes());
    for meta in callback_accounts {
        data.extend_from_slice(&meta.pubkey);
        data.push(u8::from(meta.is_signer));
        data.push(u8::from(meta.is_writable));
    }
    data.extend_from_slice(&0u32.to_le_bytes());
    data
}

#[cfg(test)]
fn clock_unix_timestamp() -> i64 {
    1_700_000_000
}

#[cfg(not(test))]
fn clock_unix_timestamp() -> i64 {
    pinocchio::sysvars::clock::Clock::get()
        .map(|clock| clock.unix_timestamp)
        .expect("Clock sysvar unavailable")
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

fn require_address(account: &AccountView, expected: &Address) -> ProgramResult {
    if account.address() == expected {
        Ok(())
    } else {
        Err(ProgramError::InvalidArgument)
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
    let (expected_address, _) = Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }
    let data = account.try_borrow()?;
    if data.len() != ROUND_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("Round")) {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn require_round_self_pda(account: &AccountView, program_id: &Address) -> ProgramResult {
    require_owned_by(account, program_id)?;
    let data = account.try_borrow()?;
    if data.len() != ROUND_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("Round")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let round = RoundLifecycleView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    let expected = Address::create_program_address(
        &[SEED_ROUND, &round.round_id.to_le_bytes(), &[round.bump]],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if account.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(())
}

fn require_program_identity_pda(account: &AccountView, program_id: &Address) -> ProgramResult {
    // Identity PDA is not a signer at outer instruction level — it signs only
    // during invoke_signed CPI to the VRF program.  Validate address only.
    require_address(account, &Address::find_program_address(&[SEED_IDENTITY], program_id).0)
}

fn prepare_degen_claim_pda_init_if_needed(
    account: &AccountView,
    payer: &AccountView,
    system_program: &AccountView,
    program_id: &Address,
    instruction_data: &[u8],
) -> Result<u8, ProgramError> {
    let round_id = crate::instruction_layouts::parse_round_id_ix(instruction_data, "request_degen_vrf")
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let (expected, bump) = Address::find_program_address(
        &[SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), payer.address().as_ref()],
        program_id,
    );
    if account.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    if !account.owned_by(program_id) {
        require_address(system_program, &SYSTEM_PROGRAM_ID)?;
        require_owned_by(account, &SYSTEM_PROGRAM_ID)?;
        create_degen_claim_pda_account(account, payer, program_id, round_id, bump)?;
    }

    let data = account.try_borrow()?;
    if data.len() != DEGEN_CLAIM_ACCOUNT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let is_zeroed = data.iter().all(|byte| *byte == 0);
    if !is_zeroed && data.get(..8) != Some(&account_discriminator("DegenClaim")) {
        return Err(ProgramError::InvalidAccountData);
    }
    if !is_zeroed {
        let claim =
            DegenClaimView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
        if claim.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }
    }
    Ok(bump)
}

#[cfg(not(test))]
fn create_degen_claim_pda_account(
    account: &AccountView,
    payer: &AccountView,
    program_id: &Address,
    round_id: u64,
    bump: u8,
) -> ProgramResult {
    let round_id_le = round_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = [
        Seed::from(SEED_DEGEN_CLAIM),
        Seed::from(&round_id_le),
        Seed::from(payer.address().as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds);
    create_account_with_minimum_balance_signed(
        account,
        DEGEN_CLAIM_ACCOUNT_LEN,
        program_id,
        payer,
        None,
        &[signer],
    )
}

#[cfg(test)]
fn create_degen_claim_pda_account(
    account: &AccountView,
    _payer: &AccountView,
    program_id: &Address,
    _round_id: u64,
    _bump: u8,
) -> ProgramResult {
    unsafe {
        account.assign(program_id);
        account.resize_unchecked(DEGEN_CLAIM_ACCOUNT_LEN)?;
    }
    Ok(())
}

fn require_existing_degen_claim_pda(
    account: &AccountView,
    program_id: &Address,
    round: &AccountView,
) -> ProgramResult {
    require_owned_by(account, program_id)?;
    let round_data = round.try_borrow()?;
    let round_view = RoundLifecycleView::read_from_account_data(&round_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let winner = RoundLifecycleView::read_winner_from_account_data(&round_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    drop(round_data);

    let data = account.try_borrow()?;
    if data.len() != DEGEN_CLAIM_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("DegenClaim")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let claim = DegenClaimView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    let expected = Address::create_program_address(
        &[SEED_DEGEN_CLAIM, &round_view.round_id.to_le_bytes(), &winner, &[claim.bump]],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if account.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(())
}

fn require_degen_config_pda(account: &AccountView, program_id: &Address) -> ProgramResult {
    let expected = Address::find_program_address(&[SEED_DEGEN_CFG], program_id).0;
    if account.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let data = account.try_borrow()?;
    if data.is_empty() {
        return Ok(());
    }
    require_owned_by(account, program_id)?;
    if data.len() != DEGEN_CONFIG_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("DegenConfig")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let _cfg = DegenConfigView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;

    use pinocchio::{
        Address,
        account::{NOT_BORROWED, RuntimeAccount},
        error::ProgramError,
    };

    use crate::{
        anchor_compat::account_discriminator,
        legacy_layouts::{
            ConfigView, DegenClaimView, DegenConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN,
            DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CLAIM_STATUS_VRF_READY,
            DEGEN_CLAIM_STATUS_VRF_REQUESTED, DEGEN_CANDIDATE_WINDOW, DEGEN_CONFIG_ACCOUNT_LEN,
            ROUND_ACCOUNT_LEN, ROUND_STATUS_SETTLED,
        },
    };

    use super::{
        process_instruction, instruction_discriminator, DEFAULT_QUEUE, SEED_CFG, SEED_DEGEN_CLAIM,
        SEED_DEGEN_CFG, SEED_IDENTITY, SEED_ROUND, SLOT_HASHES_SYSVAR_ID, SYSTEM_PROGRAM_ID,
        VRF_PROGRAM_ID, VRF_PROGRAM_IDENTITY,
    };

    const PROGRAM_ID: Address = Address::new_from_array([7u8; 32]);

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
            Self::new_with_capacity(address, owner, is_signer, is_writable, lamports, data, data.len())
        }

        fn new_with_capacity(
            address: [u8; 32],
            owner: Address,
            is_signer: bool,
            is_writable: bool,
            lamports: u64,
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
                (*raw).lamports = lamports;
                (*raw).data_len = data.len() as u64;

                if !data.is_empty() {
                    let data_ptr = (raw as *mut u8).add(size_of::<RuntimeAccount>());
                    core::ptr::copy_nonoverlapping(data.as_ptr(), data_ptr, data.len());
                }
            }

            Self { backing }
        }

        fn view(&mut self) -> pinocchio::AccountView {
            unsafe { pinocchio::AccountView::new_unchecked(self.backing.as_mut_ptr() as *mut RuntimeAccount) }
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

    fn sample_round() -> (Address, Vec<u8>) {
        let round_id = 81u64;
        let (round_pda, round_bump) =
            Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let mut data = vec![0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status: ROUND_STATUS_SETTLED,
            bump: round_bump,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_000_000,
            total_tickets: 200,
            participants_count: 2,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        RoundLifecycleView::write_winner_to_account_data(&mut data, &[9u8; 32]).unwrap();
        (round_pda, data)
    }

    fn sample_degen_claim() -> (Address, Vec<u8>) {
        let round_id = 81u64;
        let winner = Address::new_from_array([9u8; 32]);
        let (degen_claim_pda, bump) = Address::find_program_address(
            &[SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), winner.as_ref()],
            &PROGRAM_ID,
        );
        let mut data = vec![0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: [0u8; 32],
            winner: [0u8; 32],
            round_id: 0,
            status: 0,
            bump,
            selected_candidate_rank: 0,
            fallback_reason: 0,
            token_index: 0,
            pool_version: 0,
            candidate_window: 0,
            padding0: [0u8; 7],
            requested_at: 0,
            fulfilled_at: 0,
            claimed_at: 0,
            fallback_after_ts: 0,
            payout_raw: 0,
            min_out_raw: 0,
            receiver_pre_balance: 0,
            token_mint: [0u8; 32],
            executor: [0u8; 32],
            receiver_token_ata: [0u8; 32],
            randomness: [0u8; 32],
            route_hash: [0u8; 32],
            reserved: [0u8; 32],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (degen_claim_pda, data)
    }

    fn ready_degen_claim() -> (Address, Vec<u8>) {
        let round_id = 81u64;
        let winner = Address::new_from_array([9u8; 32]);
        let (round_pda, _) = Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let (degen_claim_pda, bump) = Address::find_program_address(
            &[SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), winner.as_ref()],
            &PROGRAM_ID,
        );
        let mut data = vec![0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: round_pda.to_bytes(),
            winner: winner.to_bytes(),
            round_id,
            status: DEGEN_CLAIM_STATUS_VRF_REQUESTED,
            bump,
            selected_candidate_rank: u8::MAX,
            fallback_reason: 0,
            token_index: 0,
            pool_version: 1,
            candidate_window: DEGEN_CANDIDATE_WINDOW,
            padding0: [0u8; 7],
            requested_at: 777,
            fulfilled_at: 0,
            claimed_at: 0,
            fallback_after_ts: 0,
            payout_raw: 0,
            min_out_raw: 0,
            receiver_pre_balance: 0,
            token_mint: [0u8; 32],
            executor: [0u8; 32],
            receiver_token_ata: [0u8; 32],
            randomness: [0u8; 32],
            route_hash: [0u8; 32],
            reserved: [0u8; 32],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (degen_claim_pda, data)
    }

    fn sample_degen_config() -> (Address, Vec<u8>) {
        let (degen_cfg_pda, bump) = Address::find_program_address(&[SEED_DEGEN_CFG], &PROGRAM_ID);
        let mut data = vec![0u8; DEGEN_CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenConfig"));
        DegenConfigView {
            executor: [4u8; 32],
            fallback_timeout_sec: 450,
            bump,
            reserved: [0u8; 27],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (degen_cfg_pda, data)
    }

    #[test]
    fn request_degen_vrf_runtime_marks_state() {
        let winner = Address::new_from_array([9u8; 32]);
        let (config_pda, config_data) = sample_config();
        let (round_pda, round_data) = sample_round();
        let (degen_claim_pda, degen_claim_data) = sample_degen_claim();
        let (program_identity_pda, _) = Address::find_program_address(&[SEED_IDENTITY], &PROGRAM_ID);

        let mut winner_account = TestAccount::new(winner.to_bytes(), Address::new_from_array([0u8; 32]), true, true, 1_000_000_000, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new(degen_claim_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &degen_claim_data);
        let mut identity_account = TestAccount::new(program_identity_pda.to_bytes(), PROGRAM_ID, true, false, 0, &[]);
        let mut queue_account = TestAccount::new(DEFAULT_QUEUE.to_bytes(), Address::new_from_array([0u8; 32]), false, true, 0, &[]);
        let mut vrf_program_account = TestAccount::new(VRF_PROGRAM_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 0, &[]);
        let mut slot_hashes_account = TestAccount::new(SLOT_HASHES_SYSVAR_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 0, &[]);
        let mut system_program_account = TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 0, &[]);

        let views = [
            winner_account.view(),
            config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            identity_account.view(),
            queue_account.view(),
            vrf_program_account.view(),
            slot_hashes_account.view(),
            system_program_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_degen_vrf"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        let claim = DegenClaimView::read_from_account_data(degen_claim_account.data()).unwrap();
        assert_eq!(claim.status, DEGEN_CLAIM_STATUS_VRF_REQUESTED);
    }

    #[test]
    fn request_degen_vrf_runtime_init_if_needed_creates_claim() {
        let winner = Address::new_from_array([9u8; 32]);
        let (config_pda, config_data) = sample_config();
        let (round_pda, round_data) = sample_round();
        let round_id = 81u64;
        let (degen_claim_pda, _) = Address::find_program_address(
            &[SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), winner.as_ref()],
            &PROGRAM_ID,
        );
        let (program_identity_pda, _) = Address::find_program_address(&[SEED_IDENTITY], &PROGRAM_ID);

        let mut winner_account = TestAccount::new(winner.to_bytes(), SYSTEM_PROGRAM_ID, true, true, 1_000_000_000, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new_with_capacity(
            degen_claim_pda.to_bytes(),
            SYSTEM_PROGRAM_ID,
            false,
            true,
            0,
            &[],
            DEGEN_CLAIM_ACCOUNT_LEN,
        );
        let mut identity_account = TestAccount::new(program_identity_pda.to_bytes(), PROGRAM_ID, true, false, 0, &[]);
        let mut queue_account = TestAccount::new(DEFAULT_QUEUE.to_bytes(), SYSTEM_PROGRAM_ID, false, true, 0, &[]);
        let mut vrf_program_account = TestAccount::new(VRF_PROGRAM_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, 0, &[]);
        let mut slot_hashes_account = TestAccount::new(SLOT_HASHES_SYSVAR_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, 0, &[]);
        let mut system_program_account = TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), SYSTEM_PROGRAM_ID, false, false, 0, &[]);

        let views = [
            winner_account.view(),
            config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            identity_account.view(),
            queue_account.view(),
            vrf_program_account.view(),
            slot_hashes_account.view(),
            system_program_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_degen_vrf"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        assert_eq!(degen_claim_account.data().len(), DEGEN_CLAIM_ACCOUNT_LEN);
        let claim = DegenClaimView::read_from_account_data(degen_claim_account.data()).unwrap();
        assert_eq!(claim.status, DEGEN_CLAIM_STATUS_VRF_REQUESTED);
        assert_eq!(claim.round, round_pda.to_bytes());
        assert_eq!(claim.winner, winner.to_bytes());
        assert_eq!(claim.round_id, round_id);
    }

    #[test]
    fn degen_vrf_callback_runtime_sets_ready_state() {
        let (config_pda, config_data) = sample_config();
        let (round_pda, mut round_data) = sample_round();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut round_data, 1).unwrap();
        let (degen_claim_pda, degen_claim_data) = ready_degen_claim();
        let (degen_cfg_pda, degen_cfg_data) = sample_degen_config();

        let mut vrf_identity = TestAccount::new(VRF_PROGRAM_IDENTITY.to_bytes(), Address::new_from_array([0u8; 32]), true, false, 0, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new(degen_claim_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &degen_claim_data);
        let mut degen_cfg_account = TestAccount::new(degen_cfg_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &degen_cfg_data);

        let views = [
            vrf_identity.view(),
            config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            degen_cfg_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("degen_vrf_callback"));
        ix.extend_from_slice(&[7u8; 32]);

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        let claim = DegenClaimView::read_from_account_data(degen_claim_account.data()).unwrap();
        assert_eq!(claim.status, DEGEN_CLAIM_STATUS_VRF_READY);
        assert_eq!(claim.fallback_after_ts, 1_700_000_450);
    }

    #[test]
    fn rejects_wrong_degen_claim_pda() {
        let winner = Address::new_from_array([9u8; 32]);
        let (config_pda, config_data) = sample_config();
        let (round_pda, round_data) = sample_round();
        let (_, degen_claim_data) = sample_degen_claim();
        let (program_identity_pda, _) = Address::find_program_address(&[SEED_IDENTITY], &PROGRAM_ID);

        let mut winner_account = TestAccount::new(winner.to_bytes(), Address::new_from_array([0u8; 32]), true, true, 1_000_000_000, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new([55u8; 32], PROGRAM_ID, false, true, 1_000_000, &degen_claim_data);
        let mut identity_account = TestAccount::new(program_identity_pda.to_bytes(), PROGRAM_ID, true, false, 0, &[]);
        let mut queue_account = TestAccount::new(DEFAULT_QUEUE.to_bytes(), Address::new_from_array([0u8; 32]), false, true, 0, &[]);
        let mut vrf_program_account = TestAccount::new(VRF_PROGRAM_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 0, &[]);
        let mut slot_hashes_account = TestAccount::new(SLOT_HASHES_SYSVAR_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 0, &[]);
        let mut system_program_account = TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 0, &[]);

        let views = [
            winner_account.view(),
            config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            identity_account.view(),
            queue_account.view(),
            vrf_program_account.view(),
            slot_hashes_account.view(),
            system_program_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_degen_vrf"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let err = process_instruction(&PROGRAM_ID, &views, &ix).unwrap_err();
        assert_eq!(err, ProgramError::InvalidSeeds);
    }
}
