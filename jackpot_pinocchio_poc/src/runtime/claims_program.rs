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
    handlers::degen_common::ClaimAmountsCompat,
    legacy_layouts::{CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN, ConfigView},
    processors::claims::ClaimProcessor,
};

#[cfg(test)]
use crate::{errors::JackpotCompatError, legacy_layouts::TokenAccountWithAmountView};
#[cfg(not(test))]
use crate::legacy_layouts::RoundLifecycleView;

const SEED_CFG: &[u8] = b"cfg";
const SEED_ROUND: &[u8] = b"round";

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .get(..8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if discriminator == instruction_discriminator("claim") {
        return process_claim(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("auto_claim") {
        return process_auto_claim(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_claim(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (winner, config, round, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_usdc_ata, token_program) =
        match accounts {
            [winner, config, round, vault, winner_usdc_ata, treasury_usdc_ata, token_program] => {
                (winner, config, round, vault, winner_usdc_ata, treasury_usdc_ata, None, token_program)
            }
            [winner, config, round, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_usdc_ata, token_program] => {
                (winner, config, round, vault, winner_usdc_ata, treasury_usdc_ata, Some(vrf_payer_usdc_ata), token_program)
            }
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    require_signer(winner)?;
    require_writable(winner)?;
    require_writable(round)?;
    require_writable(vault)?;
    require_writable(winner_usdc_ata)?;
    require_writable(treasury_usdc_ata)?;
    let config_view = require_config_pda(config, program_id)?;
    let round_id = crate::instruction_layouts::parse_round_id_ix(instruction_data, "claim")
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    require_round_pda_for_round_id(round, program_id, round_id)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(vault, token_program)?;
    require_token_account_owned_by_program(winner_usdc_ata, token_program)?;
    require_token_account_owned_by_program(treasury_usdc_ata, token_program)?;
    if let Some(vrf_payer_usdc_ata) = vrf_payer_usdc_ata {
        require_writable(vrf_payer_usdc_ata)?;
        require_token_account_owned_by_program(vrf_payer_usdc_ata, token_program)?;
    }

    let (amounts, round_shadow) = {
        let config_data = config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let vault_data = vault.try_borrow()?;
        let winner_ata_data = winner_usdc_ata.try_borrow()?;
        let treasury_ata_data = treasury_usdc_ata.try_borrow()?;
        let vrf_payer_ata_data = match vrf_payer_usdc_ata {
            Some(account) => Some(account.try_borrow()?),
            None => None,
        };

        let mut processor = ClaimProcessor {
            winner_pubkey: winner.address().to_bytes(),
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: vault.address().to_bytes(),
            treasury_usdc_ata_pubkey: treasury_usdc_ata.address().to_bytes(),
            config_account_data: &config_data,
            round_account_data: &mut round_shadow,
            vault_account_data: &vault_data,
            winner_usdc_ata_data: &winner_ata_data,
            treasury_usdc_ata_data: &treasury_ata_data,
            vrf_payer_usdc_ata_data: vrf_payer_ata_data.as_deref(),
        };
        let amounts = processor.process(instruction_data)?;
        (amounts, round_shadow)
    };

    transfer_claim_amounts(
        vault,
        winner_usdc_ata,
        treasury_usdc_ata,
        vrf_payer_usdc_ata,
        round,
        config_view.usdc_mint,
        amounts,
    )?;

    {
        let mut round_data = round.try_borrow_mut()?;
        round_data.copy_from_slice(&round_shadow);
    }

    Ok(())
}

fn process_auto_claim(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (payer, config, round, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_usdc_ata, token_program) =
        match accounts {
            [payer, config, round, vault, winner_usdc_ata, treasury_usdc_ata, token_program] => {
                (payer, config, round, vault, winner_usdc_ata, treasury_usdc_ata, None, token_program)
            }
            [payer, config, round, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_usdc_ata, token_program] => {
                (payer, config, round, vault, winner_usdc_ata, treasury_usdc_ata, Some(vrf_payer_usdc_ata), token_program)
            }
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(round)?;
    require_writable(vault)?;
    require_writable(winner_usdc_ata)?;
    require_writable(treasury_usdc_ata)?;
    let config_view = require_config_pda(config, program_id)?;
    let round_id = crate::instruction_layouts::parse_round_id_ix(instruction_data, "auto_claim")
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    require_round_pda_for_round_id(round, program_id, round_id)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(vault, token_program)?;
    require_token_account_owned_by_program(winner_usdc_ata, token_program)?;
    require_token_account_owned_by_program(treasury_usdc_ata, token_program)?;
    if let Some(vrf_payer_usdc_ata) = vrf_payer_usdc_ata {
        require_writable(vrf_payer_usdc_ata)?;
        require_token_account_owned_by_program(vrf_payer_usdc_ata, token_program)?;
    }

    let (amounts, round_shadow) = {
        let config_data = config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let vault_data = vault.try_borrow()?;
        let winner_ata_data = winner_usdc_ata.try_borrow()?;
        let treasury_ata_data = treasury_usdc_ata.try_borrow()?;
        let vrf_payer_ata_data = match vrf_payer_usdc_ata {
            Some(account) => Some(account.try_borrow()?),
            None => None,
        };

        let mut processor = ClaimProcessor {
            winner_pubkey: [0u8; 32],
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: vault.address().to_bytes(),
            treasury_usdc_ata_pubkey: treasury_usdc_ata.address().to_bytes(),
            config_account_data: &config_data,
            round_account_data: &mut round_shadow,
            vault_account_data: &vault_data,
            winner_usdc_ata_data: &winner_ata_data,
            treasury_usdc_ata_data: &treasury_ata_data,
            vrf_payer_usdc_ata_data: vrf_payer_ata_data.as_deref(),
        };
        let amounts = processor.process(instruction_data)?;
        (amounts, round_shadow)
    };

    transfer_claim_amounts(
        vault,
        winner_usdc_ata,
        treasury_usdc_ata,
        vrf_payer_usdc_ata,
        round,
        config_view.usdc_mint,
        amounts,
    )?;

    {
        let mut round_data = round.try_borrow_mut()?;
        round_data.copy_from_slice(&round_shadow);
    }

    Ok(())
}

#[cfg(not(test))]
fn transfer_claim_amounts(
    vault: &AccountView,
    winner_usdc_ata: &AccountView,
    treasury_usdc_ata: &AccountView,
    vrf_payer_usdc_ata: Option<&AccountView>,
    round: &AccountView,
    _usdc_mint: [u8; 32],
    amounts: ClaimAmountsCompat,
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

    if amounts.vrf_reimburse > 0 {
        if let Some(vrf_payer_usdc_ata) = vrf_payer_usdc_ata {
            TokenTransfer {
                from: vault,
                to: vrf_payer_usdc_ata,
                authority: round,
                amount: amounts.vrf_reimburse,
            }
            .invoke_signed(&[signer.clone()])?;
        }
    }

    TokenTransfer {
        from: vault,
        to: winner_usdc_ata,
        authority: round,
        amount: amounts.payout,
    }
    .invoke_signed(&[signer.clone()])?;

    if amounts.fee > 0 {
        TokenTransfer {
            from: vault,
            to: treasury_usdc_ata,
            authority: round,
            amount: amounts.fee,
        }
        .invoke_signed(&[signer])?;
    }

    Ok(())
}

#[cfg(test)]
fn transfer_claim_amounts(
    vault: &AccountView,
    winner_usdc_ata: &AccountView,
    treasury_usdc_ata: &AccountView,
    vrf_payer_usdc_ata: Option<&AccountView>,
    _round: &AccountView,
    _usdc_mint: [u8; 32],
    amounts: ClaimAmountsCompat,
) -> ProgramResult {
    if amounts.vrf_reimburse > 0 {
        if let Some(vrf_payer_usdc_ata) = vrf_payer_usdc_ata {
            transfer_amount(vault, vrf_payer_usdc_ata, amounts.vrf_reimburse)?;
        }
    }
    transfer_amount(vault, winner_usdc_ata, amounts.payout)?;
    if amounts.fee > 0 {
        transfer_amount(vault, treasury_usdc_ata, amounts.fee)?;
    }
    Ok(())
}

#[cfg(test)]
fn transfer_amount(from: &AccountView, to: &AccountView, amount: u64) -> ProgramResult {
    let from_amount = {
        let data = from.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };
    let to_amount = {
        let data = to.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };

    let next_from_amount = from_amount
        .checked_sub(amount)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_to_amount = to_amount
        .checked_add(amount)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    {
        let mut data = from.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_from_amount)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }
    {
        let mut data = to.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_to_amount)
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

fn require_round_pda_for_round_id(account: &AccountView, program_id: &Address, round_id: u64) -> ProgramResult {
    require_owned_by(account, program_id)?;
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

fn require_token_program(account: &AccountView) -> ProgramResult {
    if account.address() == &pinocchio_token::ID {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

fn require_token_account_owned_by_program(account: &AccountView, token_program: &AccountView) -> ProgramResult {
    require_owned_by(account, token_program.address())
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;

    use pinocchio::{
        account::{NOT_BORROWED, RuntimeAccount},
        Address,
    };

    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, RoundLifecycleView, TokenAccountWithAmountView, CONFIG_ACCOUNT_LEN,
            ROUND_ACCOUNT_LEN, ROUND_STATUS_CLAIMED, ROUND_STATUS_SETTLED,
            TOKEN_ACCOUNT_WITH_AMOUNT_LEN, DEGEN_MODE_NONE,
        },
    };

    use super::process_instruction;

    const PROGRAM_ID: Address = Address::new_from_array([7u8; 32]);
    const SEED_CFG: &[u8] = b"cfg";
    const SEED_ROUND: &[u8] = b"round";

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

    fn sample_config(usdc_mint: Address, treasury: Address) -> (Address, Vec<u8>) {
        let (config_pda, config_bump) = Address::find_program_address(&[SEED_CFG], &PROGRAM_ID);
        let mut data = vec![0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin: [7u8; 32],
            usdc_mint: usdc_mint.to_bytes(),
            treasury_usdc_ata: treasury.to_bytes(),
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

    fn sample_round(round_id: u64, vault: Address, winner: Address) -> (Address, Vec<u8>) {
        let (round_pda, round_bump) =
            Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let mut data = vec![0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status: ROUND_STATUS_SETTLED,
            bump: round_bump,
            start_ts: 100,
            end_ts: 120,
            first_deposit_ts: 101,
            total_usdc: 1_000_000,
            total_tickets: 100,
            participants_count: 2,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        RoundLifecycleView::write_vault_pubkey_to_account_data(&mut data, &vault.to_bytes()).unwrap();
        RoundLifecycleView::write_winner_to_account_data(&mut data, &winner.to_bytes()).unwrap();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut data, DEGEN_MODE_NONE).unwrap();
        RoundLifecycleView::write_vrf_payer_to_account_data(&mut data, &[11u8; 32]).unwrap();
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
    fn entrypoint_routes_claim_and_transfers_balances() {
        let winner = Address::new_from_array([9u8; 32]);
        let token_program = pinocchio_token::ID;
        let usdc_mint = Address::new_from_array([2u8; 32]);
        let vault_ata = Address::new_from_array([8u8; 32]);
        let winner_ata = Address::new_from_array([12u8; 32]);
        let treasury_ata = Address::new_from_array([3u8; 32]);
        let vrf_payer_ata = Address::new_from_array([13u8; 32]);

        let (config_pda, config_data) = sample_config(usdc_mint, treasury_ata);
        let (round_pda, round_data) = sample_round(81, vault_ata, winner);

        let mut winner_account =
            TestAccount::new(winner.to_bytes(), Address::new_from_array([0u8; 32]), true, true, 1_000_000, &[]);
        let mut config_account =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account =
            TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut vault_account = TestAccount::new(
            vault_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, round_pda, 1_000_000),
        );
        let mut winner_ata_account = TestAccount::new(
            winner_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, winner, 100),
        );
        let mut treasury_ata_account = TestAccount::new(
            treasury_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, Address::new_from_array([1u8; 32]), 200),
        );
        let mut vrf_payer_ata_account = TestAccount::new(
            vrf_payer_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, Address::new_from_array([11u8; 32]), 300),
        );
        let mut token_program_account =
            TestAccount::new(token_program.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 1_000_000, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let accounts = [
            winner_account.view(),
            config_account.view(),
            round_account.view(),
            vault_account.view(),
            winner_ata_account.view(),
            treasury_ata_account.view(),
            vrf_payer_ata_account.view(),
            token_program_account.view(),
        ];

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let round = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(round.status, ROUND_STATUS_CLAIMED);
        assert_eq!(
            RoundLifecycleView::read_vrf_reimbursed_from_account_data(round_account.data()).unwrap(),
            1
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(vault_account.data()).unwrap().amount,
            0
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(winner_ata_account.data()).unwrap().amount,
            798_100
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(treasury_ata_account.data()).unwrap().amount,
            2_200
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(vrf_payer_ata_account.data()).unwrap().amount,
            200_300
        );
    }

    #[test]
    fn entrypoint_routes_auto_claim_and_transfers_balances() {
        let payer = Address::new_from_array([5u8; 32]);
        let winner = Address::new_from_array([9u8; 32]);
        let token_program = pinocchio_token::ID;
        let usdc_mint = Address::new_from_array([2u8; 32]);
        let vault_ata = Address::new_from_array([8u8; 32]);
        let winner_ata = Address::new_from_array([12u8; 32]);
        let treasury_ata = Address::new_from_array([3u8; 32]);
        let vrf_payer_ata = Address::new_from_array([13u8; 32]);

        let (config_pda, config_data) = sample_config(usdc_mint, treasury_ata);
        let (round_pda, round_data) = sample_round(82, vault_ata, winner);

        let mut payer_account =
            TestAccount::new(payer.to_bytes(), Address::new_from_array([0u8; 32]), true, true, 1_000_000, &[]);
        let mut config_account =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account =
            TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut vault_account = TestAccount::new(
            vault_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, round_pda, 1_000_000),
        );
        let mut winner_ata_account = TestAccount::new(
            winner_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, winner, 100),
        );
        let mut treasury_ata_account = TestAccount::new(
            treasury_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, Address::new_from_array([1u8; 32]), 200),
        );
        let mut vrf_payer_ata_account = TestAccount::new(
            vrf_payer_ata.to_bytes(),
            token_program,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, Address::new_from_array([11u8; 32]), 300),
        );
        let mut token_program_account =
            TestAccount::new(token_program.to_bytes(), Address::new_from_array([0u8; 32]), false, false, 1_000_000, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("auto_claim"));
        ix.extend_from_slice(&82u64.to_le_bytes());

        let accounts = [
            payer_account.view(),
            config_account.view(),
            round_account.view(),
            vault_account.view(),
            winner_ata_account.view(),
            treasury_ata_account.view(),
            vrf_payer_ata_account.view(),
            token_program_account.view(),
        ];

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let round = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(round.status, ROUND_STATUS_CLAIMED);
        assert_eq!(
            RoundLifecycleView::read_vrf_reimbursed_from_account_data(round_account.data()).unwrap(),
            1
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(vault_account.data()).unwrap().amount,
            0
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(winner_ata_account.data()).unwrap().amount,
            798_100
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(treasury_ata_account.data()).unwrap().amount,
            2_200
        );
        assert_eq!(
            TokenAccountWithAmountView::read_from_account_data(vrf_payer_ata_account.data()).unwrap().amount,
            200_300
        );
    }
}
