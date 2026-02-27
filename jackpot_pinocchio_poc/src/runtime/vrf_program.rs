extern crate alloc;

use alloc::vec::Vec;

use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};
#[cfg(not(test))]
use pinocchio::{
    cpi::{Seed, Signer, invoke_signed},
    instruction::{InstructionAccount, InstructionView},
};
use solana_address::address;

use crate::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    errors::JackpotCompatError,
    legacy_layouts::{CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ConfigView, RoundLifecycleView},
    processors::vrf::VrfProcessor,
};

mod vrf_constants {
    include!(concat!(env!("OUT_DIR"), "/vrf_constants.rs"));
}
use vrf_constants::{DEFAULT_QUEUE, VRF_PROGRAM_ID, VRF_PROGRAM_IDENTITY};

const SEED_CFG: &[u8] = b"cfg";
const SEED_ROUND: &[u8] = b"round";
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

    if discriminator == instruction_discriminator("request_vrf") {
        return process_request_vrf(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("vrf_callback") {
        return process_vrf_callback(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_request_vrf(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [payer, config, round, program_identity, oracle_queue, vrf_program, slot_hashes, system_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(payer)?;
    require_writable(payer)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(round)?;
    require_round_pda(round, program_id, instruction_data, "request_vrf")?;
    require_program_identity_pda(program_identity, program_id)?;
    require_writable(oracle_queue)?;
    require_address(oracle_queue, &DEFAULT_QUEUE)?;
    require_address(vrf_program, &VRF_PROGRAM_ID)?;
    require_address(slot_hashes, &SLOT_HASHES_SYSVAR_ID)?;
    require_address(system_program, &SYSTEM_PROGRAM_ID)?;

    {
        let config_data = config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let mut processor = VrfProcessor {
            payer_pubkey: payer.address().to_bytes(),
            config_account_data: &config_data,
            round_account_data: &mut round_shadow,
        };
        processor.process(instruction_data)?;
    }

    invoke_vrf_request(program_id, payer, config, round, program_identity, oracle_queue, vrf_program, slot_hashes, system_program)?;

    let config_data = config.try_borrow()?;
    let mut round_data = round.try_borrow_mut()?;
    let mut processor = VrfProcessor {
        payer_pubkey: payer.address().to_bytes(),
        config_account_data: &config_data,
        round_account_data: &mut round_data[..],
    };
    processor.process(instruction_data)
}

fn process_vrf_callback(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [vrf_program_identity, config, round, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(vrf_program_identity)?;
    require_address(vrf_program_identity, &VRF_PROGRAM_IDENTITY)?;
    let _config = require_config_pda(config, program_id)?;
    require_writable(round)?;
    require_round_self_pda(round, program_id)?;

    let config_data = config.try_borrow()?;
    let mut round_data = round.try_borrow_mut()?;
    let mut processor = VrfProcessor {
        payer_pubkey: [0u8; 32],
        config_account_data: &config_data,
        round_account_data: &mut round_data[..],
    };
    processor.process(instruction_data)
}

#[cfg(not(test))]
fn invoke_vrf_request(
    program_id: &Address,
    payer: &AccountView,
    config: &AccountView,
    round: &AccountView,
    program_identity: &AccountView,
    oracle_queue: &AccountView,
    vrf_program: &AccountView,
    slot_hashes: &AccountView,
    system_program: &AccountView,
) -> ProgramResult {
    let round_data = round.try_borrow()?;
    let round_view =
        RoundLifecycleView::read_from_account_data(&round_data).map_err(|_| ProgramError::InvalidAccountData)?;
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
    ];
    let callback_discriminator = instruction_discriminator("vrf_callback");
    let ix_data = build_request_randomness_ix_data(
        program_id.clone(),
        round_id_le,
        &callback_discriminator,
        &callback_accounts,
    );

    let instruction_accounts: [InstructionAccount; 5] = [
        InstructionAccount::writable_signer(payer.address()),
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
        &[payer, program_identity, oracle_queue, system_program, slot_hashes],
        &[signer],
    )
}

#[cfg(test)]
fn invoke_vrf_request(
    _program_id: &Address,
    _payer: &AccountView,
    _config: &AccountView,
    _round: &AccountView,
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
    round_id_le: [u8; 8],
    callback_discriminator: &[u8; 8],
    callback_accounts: &[SerializableAccountMetaCompat],
) -> Vec<u8> {
    let mut caller_seed = [0u8; 32];
    caller_seed[..8].copy_from_slice(&round_id_le);

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

fn require_round_self_pda(account: &AccountView, program_id: &Address) -> ProgramResult {
    require_owned_by(account, program_id)?;
    let data = account.try_borrow()?;
    if data.len() != ROUND_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("Round")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let round =
        RoundLifecycleView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    let expected = Address::create_program_address(
        &[SEED_ROUND, &round.round_id.to_le_bytes(), &[round.bump]],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if account.address() != &expected {
        return Err(JackpotCompatError::Unauthorized.into());
    }
    Ok(())
}

fn require_program_identity_pda(account: &AccountView, program_id: &Address) -> ProgramResult {
    let (expected_address, _) = Address::find_program_address(&[SEED_IDENTITY], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
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
            ConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_LOCKED, ROUND_STATUS_SETTLED, ROUND_STATUS_VRF_REQUESTED,
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

    fn sample_round(status: u8) -> (Address, Vec<u8>) {
        let round_id = 81u64;
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
        data[176..208].copy_from_slice(&[11u8; 32]);
        data[208..240].copy_from_slice(&[22u8; 32]);
        RoundLifecycleView::write_bit_node_to_account_data(&mut data, 1, 100).unwrap();
        let mut idx = 2usize;
        while idx <= 128 {
            RoundLifecycleView::write_bit_node_to_account_data(&mut data, idx, 200).unwrap();
            idx <<= 1;
        }
        (round_pda, data)
    }

    #[test]
    fn request_vrf_runtime_marks_state() {
        let payer = Address::new_from_array([9u8; 32]);
        let (config_pda, config_data) = sample_config();
        let (round_pda, round_data) = sample_round(ROUND_STATUS_LOCKED);
        let (identity_pda, _) = Address::find_program_address(&[SEED_IDENTITY], &PROGRAM_ID);

        let mut payer_account = TestAccount::new(payer.to_bytes(), Address::new_from_array([0u8; 32]), true, true, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, &round_data);
        let mut identity_account = TestAccount::new(identity_pda.to_bytes(), Address::new_from_array([0u8; 32]), false, false, &[]);
        let mut queue_account = TestAccount::new(DEFAULT_QUEUE.to_bytes(), Address::new_from_array([0u8; 32]), false, true, &[]);
        let mut vrf_program = TestAccount::new(VRF_PROGRAM_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, &[]);
        let mut slot_hashes = TestAccount::new(SLOT_HASHES_SYSVAR_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, &[]);
        let mut system_program = TestAccount::new(SYSTEM_PROGRAM_ID.to_bytes(), Address::new_from_array([0u8; 32]), false, false, &[]);

        let accounts = [
            payer_account.view(),
            config_account.view(),
            round_account.view(),
            identity_account.view(),
            queue_account.view(),
            vrf_program.view(),
            slot_hashes.view(),
            system_program.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("request_vrf"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        let vrf_payer = RoundLifecycleView::read_vrf_payer_from_account_data(round_account.data()).unwrap();
        assert_eq!(parsed.status, crate::legacy_layouts::ROUND_STATUS_VRF_REQUESTED);
        assert_eq!(vrf_payer, payer.to_bytes());
    }

    #[test]
    fn vrf_callback_runtime_settles_round() {
        let (config_pda, config_data) = sample_config();
        let (round_pda, round_data) = sample_round(ROUND_STATUS_VRF_REQUESTED);

        let mut identity_account = TestAccount::new(VRF_PROGRAM_IDENTITY.to_bytes(), Address::new_from_array([0u8; 32]), true, false, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, &round_data);

        let accounts = [identity_account.view(), config_account.view(), round_account.view()];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("vrf_callback"));
        ix.extend_from_slice(&[0u8; 32]);

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(parsed.status, ROUND_STATUS_SETTLED);
        assert_eq!(RoundLifecycleView::read_winner_from_account_data(round_account.data()).unwrap(), [11u8; 32]);
    }
}
