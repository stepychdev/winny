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
    legacy_layouts::{
        ConfigView, DegenClaimView, DegenConfigView, CONFIG_ACCOUNT_LEN, DEGEN_CLAIM_ACCOUNT_LEN,
        DEGEN_CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
    },
    processors::degen_execution::{DegenExecutionEffect, DegenExecutionProcessor},
};

#[cfg(test)]
use crate::{errors::JackpotCompatError, legacy_layouts::TokenAccountWithAmountView};
#[cfg(test)]
use solana_address::address;
#[cfg(not(test))]
use crate::legacy_layouts::RoundLifecycleView;

const SEED_CFG: &[u8] = b"cfg";
const SEED_ROUND: &[u8] = b"round";
const SEED_DEGEN_CLAIM: &[u8] = b"degen_claim";
const SEED_DEGEN_CFG: &[u8] = b"degen_cfg";
#[cfg(test)]
const SYSTEM_PROGRAM_ID: Address = address!("11111111111111111111111111111111");

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .get(..8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if discriminator == instruction_discriminator("begin_degen_execution") {
        return process_begin_degen_execution(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("claim_degen_fallback") {
        return process_claim_degen_fallback(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("claim_degen") {
        return process_claim_degen(program_id, accounts, instruction_data);
    }
    if discriminator == instruction_discriminator("finalize_degen_success") {
        return process_finalize_degen_success(program_id, accounts, instruction_data);
    }

    Err(ProgramError::InvalidInstructionData)
}

fn process_begin_degen_execution(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (
        executor,
        config,
        degen_config,
        round,
        degen_claim,
        vault,
        executor_usdc_ata,
        treasury_usdc_ata,
        vrf_payer_authority,
        vrf_payer_usdc_ata,
        selected_token_mint,
        receiver_token_ata,
        token_program,
    ) = match accounts {
        [executor, config, degen_config, round, degen_claim, vault, executor_usdc_ata, treasury_usdc_ata, selected_token_mint, receiver_token_ata, token_program] => {
            (
                executor,
                config,
                degen_config,
                round,
                degen_claim,
                vault,
                executor_usdc_ata,
                treasury_usdc_ata,
                None,
                None,
                selected_token_mint,
                receiver_token_ata,
                token_program,
            )
        }
        [executor, config, degen_config, round, degen_claim, vault, executor_usdc_ata, treasury_usdc_ata, vrf_payer_authority, vrf_payer_usdc_ata, selected_token_mint, receiver_token_ata, token_program] => {
            (
                executor,
                config,
                degen_config,
                round,
                degen_claim,
                vault,
                executor_usdc_ata,
                treasury_usdc_ata,
                Some(vrf_payer_authority),
                Some(vrf_payer_usdc_ata),
                selected_token_mint,
                receiver_token_ata,
                token_program,
            )
        }
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    require_signer(executor)?;
    require_writable(executor)?;
    let _config = require_config_pda(config, program_id)?;
    require_existing_degen_config_pda(degen_config, program_id)?;
    require_writable(round)?;
    let round_id = parse_round_id_from_begin_ix(instruction_data)?;
    require_round_pda_for_round_id(round, program_id, round_id)?;
    require_writable(degen_claim)?;
    require_existing_degen_claim_pda_for_round_id(degen_claim, program_id, round_id)?;
    require_writable(vault)?;
    require_writable(executor_usdc_ata)?;
    require_writable(treasury_usdc_ata)?;
    require_writable(receiver_token_ata)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(vault, token_program)?;
    require_token_account_owned_by_program(executor_usdc_ata, token_program)?;
    require_token_account_owned_by_program(treasury_usdc_ata, token_program)?;
    require_token_account_owned_by_program(receiver_token_ata, token_program)?;
    require_mint_owned_by_program(selected_token_mint, token_program)?;
    if let Some(vrf_payer_authority) = vrf_payer_authority {
        require_writable(vrf_payer_authority)?;
    }
    if let Some(vrf_payer_usdc_ata) = vrf_payer_usdc_ata {
        require_writable(vrf_payer_usdc_ata)?;
        require_token_account_owned_by_program(vrf_payer_usdc_ata, token_program)?;
    }

    let (begin_amounts, round_shadow, degen_claim_shadow) = {
        let config_data = config.try_borrow()?;
        let degen_config_data = degen_config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let degen_claim_data = degen_claim.try_borrow()?;
        let mut degen_claim_shadow = degen_claim_data.to_vec();
        let vault_data = vault.try_borrow()?;
        let executor_usdc_ata_data = executor_usdc_ata.try_borrow()?;
        let treasury_usdc_ata_data = treasury_usdc_ata.try_borrow()?;
        let receiver_token_ata_data = receiver_token_ata.try_borrow()?;
        let vrf_payer_usdc_ata_data = match vrf_payer_usdc_ata {
            Some(account) => Some(account.try_borrow()?),
            None => None,
        };

        let mut processor = DegenExecutionProcessor {
            executor_pubkey: Some(executor.address().to_bytes()),
            winner_pubkey: None,
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: Some(vault.address().to_bytes()),
            treasury_usdc_ata_pubkey: Some(treasury_usdc_ata.address().to_bytes()),
            selected_token_mint_pubkey: Some(selected_token_mint.address().to_bytes()),
            receiver_token_ata_pubkey: Some(receiver_token_ata.address().to_bytes()),
            vrf_payer_authority_pubkey: vrf_payer_authority.map(|a| a.address().to_bytes()),
            now_ts: clock_unix_timestamp(),
            config_account_data: Some(&config_data),
            degen_config_account_data: Some(&degen_config_data),
            round_account_data: &mut round_shadow,
            degen_claim_account_data: &mut degen_claim_shadow,
            vault_account_data: Some(&vault_data),
            executor_usdc_ata_data: Some(&executor_usdc_ata_data),
            winner_usdc_ata_data: None,
            treasury_usdc_ata_data: Some(&treasury_usdc_ata_data),
            receiver_token_ata_data: Some(&receiver_token_ata_data),
            vrf_payer_usdc_ata_data: vrf_payer_usdc_ata_data.as_deref(),
        };
        let amounts = match processor.process(instruction_data)? {
            DegenExecutionEffect::Begin(amounts) => amounts,
            _ => return Err(ProgramError::InvalidInstructionData),
        };
        (amounts, round_shadow, degen_claim_shadow)
    };

    transfer_begin_amounts(
        vault,
        executor_usdc_ata,
        treasury_usdc_ata,
        vrf_payer_usdc_ata,
        round,
        begin_amounts.vrf_reimburse,
        begin_amounts.payout,
        begin_amounts.fee,
    )?;

    {
        let mut round_data = round.try_borrow_mut()?;
        round_data.copy_from_slice(&round_shadow);
    }
    {
        let mut degen_claim_data = degen_claim.try_borrow_mut()?;
        degen_claim_data.copy_from_slice(&degen_claim_shadow);
    }
    Ok(())
}

fn process_claim_degen_fallback(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_authority, vrf_payer_usdc_ata, token_program) =
        match accounts {
            [winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, token_program] => {
                (winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, None, None, token_program)
            }
            [winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_authority, vrf_payer_usdc_ata, token_program] => {
                (winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, Some(vrf_payer_authority), Some(vrf_payer_usdc_ata), token_program)
            }
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    require_signer(winner)?;
    require_writable(round)?;
    require_writable(degen_claim)?;
    require_writable(vault)?;
    require_writable(winner_usdc_ata)?;
    require_writable(treasury_usdc_ata)?;
    let _config = require_config_pda(config, program_id)?;
    let round_id = crate::instruction_layouts::parse_round_id_u8_ix(instruction_data, "claim_degen_fallback")
        .map_err(|_| ProgramError::InvalidInstructionData)?
        .0;
    require_round_pda_for_round_id(round, program_id, round_id)?;
    require_existing_degen_claim_pda_for_round_id(degen_claim, program_id, round_id)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(vault, token_program)?;
    require_token_account_owned_by_program(winner_usdc_ata, token_program)?;
    require_token_account_owned_by_program(treasury_usdc_ata, token_program)?;
    if let Some(vrf_payer_usdc_ata) = vrf_payer_usdc_ata {
        require_writable(vrf_payer_usdc_ata)?;
        require_token_account_owned_by_program(vrf_payer_usdc_ata, token_program)?;
    }

    let (amounts, round_shadow, degen_claim_shadow) = {
        let config_data = config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let degen_claim_data = degen_claim.try_borrow()?;
        let mut degen_claim_shadow = degen_claim_data.to_vec();
        let vault_data = vault.try_borrow()?;
        let winner_usdc_ata_data = winner_usdc_ata.try_borrow()?;
        let treasury_usdc_ata_data = treasury_usdc_ata.try_borrow()?;
        let vrf_payer_usdc_ata_data = match vrf_payer_usdc_ata {
            Some(account) => Some(account.try_borrow()?),
            None => None,
        };
        let mut processor = DegenExecutionProcessor {
            executor_pubkey: None,
            winner_pubkey: Some(winner.address().to_bytes()),
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: Some(vault.address().to_bytes()),
            treasury_usdc_ata_pubkey: Some(treasury_usdc_ata.address().to_bytes()),
            selected_token_mint_pubkey: None,
            receiver_token_ata_pubkey: None,
            vrf_payer_authority_pubkey: vrf_payer_authority.map(|a| a.address().to_bytes()),
            now_ts: clock_unix_timestamp(),
            config_account_data: Some(&config_data),
            degen_config_account_data: None,
            round_account_data: &mut round_shadow,
            degen_claim_account_data: &mut degen_claim_shadow,
            vault_account_data: Some(&vault_data),
            executor_usdc_ata_data: None,
            winner_usdc_ata_data: Some(&winner_usdc_ata_data),
            treasury_usdc_ata_data: Some(&treasury_usdc_ata_data),
            receiver_token_ata_data: None,
            vrf_payer_usdc_ata_data: vrf_payer_usdc_ata_data.as_deref(),
        };
        let amounts = match processor.process(instruction_data)? {
            DegenExecutionEffect::Fallback(amounts) => amounts,
            _ => return Err(ProgramError::InvalidInstructionData),
        };
        (amounts, round_shadow, degen_claim_shadow)
    };

    transfer_fallback_amounts(
        vault,
        winner_usdc_ata,
        treasury_usdc_ata,
        vrf_payer_usdc_ata,
        round,
        amounts.vrf_reimburse,
        amounts.payout,
        amounts.fee,
    )?;

    {
        let mut round_data = round.try_borrow_mut()?;
        round_data.copy_from_slice(&round_shadow);
    }
    {
        let mut degen_claim_data = degen_claim.try_borrow_mut()?;
        degen_claim_data.copy_from_slice(&degen_claim_shadow);
    }
    Ok(())
}

/// claim_degen — winner claims with candidate validation (same transfer layout
/// as claim_degen_fallback, but validates candidate_rank + token_index against randomness).
fn process_claim_degen(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_authority, vrf_payer_usdc_ata, token_program) =
        match accounts {
            [winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, token_program] => {
                (winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, None, None, token_program)
            }
            [winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, vrf_payer_authority, vrf_payer_usdc_ata, token_program] => {
                (winner, config, round, degen_claim, vault, winner_usdc_ata, treasury_usdc_ata, Some(vrf_payer_authority), Some(vrf_payer_usdc_ata), token_program)
            }
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    require_signer(winner)?;
    require_writable(round)?;
    require_writable(degen_claim)?;
    require_writable(vault)?;
    require_writable(winner_usdc_ata)?;
    require_writable(treasury_usdc_ata)?;
    let _config = require_config_pda(config, program_id)?;
    let round_id = crate::instruction_layouts::ClaimDegenArgsCompat::parse(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?
        .round_id;
    require_round_pda_for_round_id(round, program_id, round_id)?;
    require_existing_degen_claim_pda_for_round_id(degen_claim, program_id, round_id)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(vault, token_program)?;
    require_token_account_owned_by_program(winner_usdc_ata, token_program)?;
    require_token_account_owned_by_program(treasury_usdc_ata, token_program)?;
    if let Some(vrf_payer_usdc_ata) = vrf_payer_usdc_ata {
        require_writable(vrf_payer_usdc_ata)?;
        require_token_account_owned_by_program(vrf_payer_usdc_ata, token_program)?;
    }

    let (amounts, round_shadow, degen_claim_shadow) = {
        let config_data = config.try_borrow()?;
        let round_data = round.try_borrow()?;
        let mut round_shadow = round_data.to_vec();
        let degen_claim_data = degen_claim.try_borrow()?;
        let mut degen_claim_shadow = degen_claim_data.to_vec();
        let vault_data = vault.try_borrow()?;
        let winner_usdc_ata_data = winner_usdc_ata.try_borrow()?;
        let treasury_usdc_ata_data = treasury_usdc_ata.try_borrow()?;
        let vrf_payer_usdc_ata_data = match vrf_payer_usdc_ata {
            Some(account) => Some(account.try_borrow()?),
            None => None,
        };
        let mut processor = DegenExecutionProcessor {
            executor_pubkey: None,
            winner_pubkey: Some(winner.address().to_bytes()),
            round_pubkey: round.address().to_bytes(),
            vault_pubkey: Some(vault.address().to_bytes()),
            treasury_usdc_ata_pubkey: Some(treasury_usdc_ata.address().to_bytes()),
            selected_token_mint_pubkey: None,
            receiver_token_ata_pubkey: None,
            vrf_payer_authority_pubkey: vrf_payer_authority.map(|a| a.address().to_bytes()),
            now_ts: clock_unix_timestamp(),
            config_account_data: Some(&config_data),
            degen_config_account_data: None,
            round_account_data: &mut round_shadow,
            degen_claim_account_data: &mut degen_claim_shadow,
            vault_account_data: Some(&vault_data),
            executor_usdc_ata_data: None,
            winner_usdc_ata_data: Some(&winner_usdc_ata_data),
            treasury_usdc_ata_data: Some(&treasury_usdc_ata_data),
            receiver_token_ata_data: None,
            vrf_payer_usdc_ata_data: vrf_payer_usdc_ata_data.as_deref(),
        };
        let amounts = match processor.process(instruction_data)? {
            DegenExecutionEffect::ClaimDegen(amounts) => amounts,
            _ => return Err(ProgramError::InvalidInstructionData),
        };
        (amounts, round_shadow, degen_claim_shadow)
    };

    // Same transfer pattern as fallback (vault → winner + treasury + optional vrf_payer)
    transfer_fallback_amounts(
        vault,
        winner_usdc_ata,
        treasury_usdc_ata,
        vrf_payer_usdc_ata,
        round,
        amounts.vrf_reimburse,
        amounts.payout,
        amounts.fee,
    )?;

    {
        let mut round_data = round.try_borrow_mut()?;
        round_data.copy_from_slice(&round_shadow);
    }
    {
        let mut degen_claim_data = degen_claim.try_borrow_mut()?;
        degen_claim_data.copy_from_slice(&degen_claim_shadow);
    }
    Ok(())
}

fn process_finalize_degen_success(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [executor, degen_config, round, degen_claim, executor_usdc_ata, receiver_token_ata, token_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(executor)?;
    require_writable(executor)?;
    require_existing_degen_config_pda(degen_config, program_id)?;
    require_writable(round)?;
    let round_id = crate::instruction_layouts::parse_round_id_ix(instruction_data, "finalize_degen_success")
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    require_round_pda_for_round_id(round, program_id, round_id)?;
    require_writable(degen_claim)?;
    require_existing_degen_claim_pda_for_round_id(degen_claim, program_id, round_id)?;
    require_writable(executor_usdc_ata)?;
    require_writable(receiver_token_ata)?;
    require_token_program(token_program)?;
    require_token_account_owned_by_program(executor_usdc_ata, token_program)?;
    require_token_account_owned_by_program(receiver_token_ata, token_program)?;

    let degen_config_data = degen_config.try_borrow()?;
    let mut round_data = round.try_borrow_mut()?;
    let mut degen_claim_data = degen_claim.try_borrow_mut()?;
    let executor_usdc_ata_data = executor_usdc_ata.try_borrow()?;
    let receiver_token_ata_data = receiver_token_ata.try_borrow()?;
    let mut processor = DegenExecutionProcessor {
        executor_pubkey: Some(executor.address().to_bytes()),
        winner_pubkey: None,
        round_pubkey: round.address().to_bytes(),
        vault_pubkey: None,
        treasury_usdc_ata_pubkey: None,
        selected_token_mint_pubkey: None,
        receiver_token_ata_pubkey: Some(receiver_token_ata.address().to_bytes()),
        vrf_payer_authority_pubkey: None,
        now_ts: clock_unix_timestamp(),
        config_account_data: None,
        degen_config_account_data: Some(&degen_config_data),
        round_account_data: &mut round_data[..],
        degen_claim_account_data: &mut degen_claim_data[..],
        vault_account_data: None,
        executor_usdc_ata_data: Some(&executor_usdc_ata_data),
        winner_usdc_ata_data: None,
        treasury_usdc_ata_data: None,
        receiver_token_ata_data: Some(&receiver_token_ata_data),
        vrf_payer_usdc_ata_data: None,
    };
    match processor.process(instruction_data)? {
        DegenExecutionEffect::Finalize => Ok(()),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(not(test))]
fn transfer_begin_amounts(
    vault: &AccountView,
    executor_usdc_ata: &AccountView,
    treasury_usdc_ata: &AccountView,
    vrf_payer_usdc_ata: Option<&AccountView>,
    round: &AccountView,
    vrf_reimburse: u64,
    payout: u64,
    fee: u64,
) -> ProgramResult {
    let round_data = round.try_borrow()?;
    let round_view = RoundLifecycleView::read_from_account_data(&round_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
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

    if vrf_reimburse > 0 {
        let vrf_payer_usdc_ata = vrf_payer_usdc_ata.ok_or(ProgramError::InvalidAccountData)?;
        TokenTransfer { from: vault, to: vrf_payer_usdc_ata, authority: round, amount: vrf_reimburse }
            .invoke_signed(&[Signer::from(&signer_seeds)])?;
    }
    TokenTransfer { from: vault, to: executor_usdc_ata, authority: round, amount: payout }
        .invoke_signed(&[Signer::from(&signer_seeds)])?;
    if fee > 0 {
        TokenTransfer { from: vault, to: treasury_usdc_ata, authority: round, amount: fee }
            .invoke_signed(&[Signer::from(&signer_seeds)])?;
    }
    Ok(())
}

#[cfg(test)]
fn transfer_begin_amounts(
    vault: &AccountView,
    executor_usdc_ata: &AccountView,
    treasury_usdc_ata: &AccountView,
    vrf_payer_usdc_ata: Option<&AccountView>,
    _round: &AccountView,
    vrf_reimburse: u64,
    payout: u64,
    fee: u64,
) -> ProgramResult {
    let vault_amount = TokenAccountWithAmountView::read_from_account_data(&vault.try_borrow()?)
        .map_err(|_| ProgramError::InvalidAccountData)?
        .amount;
    let executor_amount = TokenAccountWithAmountView::read_from_account_data(&executor_usdc_ata.try_borrow()?)
        .map_err(|_| ProgramError::InvalidAccountData)?
        .amount;
    let treasury_amount = TokenAccountWithAmountView::read_from_account_data(&treasury_usdc_ata.try_borrow()?)
        .map_err(|_| ProgramError::InvalidAccountData)?
        .amount;
    let vrf_payer_amount = match vrf_payer_usdc_ata {
        Some(account) => TokenAccountWithAmountView::read_from_account_data(&account.try_borrow()?)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount,
        None => 0,
    };

    let total = vrf_reimburse
        .checked_add(payout)
        .and_then(|v| v.checked_add(fee))
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_vault = vault_amount
        .checked_sub(total)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_executor = executor_amount
        .checked_add(payout)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_treasury = treasury_amount
        .checked_add(fee)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    {
        let mut data = vault.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_vault)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }
    {
        let mut data = executor_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_executor)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }
    {
        let mut data = treasury_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_treasury)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }
    if vrf_reimburse > 0 {
        let vrf_payer_usdc_ata = vrf_payer_usdc_ata.ok_or::<ProgramError>(JackpotCompatError::InvalidVrfPayerAta.into())?;
        let next_vrf_payer = vrf_payer_amount
            .checked_add(vrf_reimburse)
            .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
        let mut data = vrf_payer_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_vrf_payer)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }

    Ok(())
}

#[cfg(not(test))]
fn transfer_fallback_amounts(
    vault: &AccountView,
    winner_usdc_ata: &AccountView,
    treasury_usdc_ata: &AccountView,
    vrf_payer_usdc_ata: Option<&AccountView>,
    round: &AccountView,
    vrf_reimburse: u64,
    payout: u64,
    fee: u64,
) -> ProgramResult {
    let round_data = round.try_borrow()?;
    let round_view = RoundLifecycleView::read_from_account_data(&round_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
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
    if vrf_reimburse > 0 {
        let vrf_payer_usdc_ata = vrf_payer_usdc_ata.ok_or(ProgramError::InvalidAccountData)?;
        TokenTransfer { from: vault, to: vrf_payer_usdc_ata, authority: round, amount: vrf_reimburse }
            .invoke_signed(&[Signer::from(&signer_seeds)])?;
    }
    TokenTransfer { from: vault, to: winner_usdc_ata, authority: round, amount: payout }
        .invoke_signed(&[Signer::from(&signer_seeds)])?;
    if fee > 0 {
        TokenTransfer { from: vault, to: treasury_usdc_ata, authority: round, amount: fee }
            .invoke_signed(&[Signer::from(&signer_seeds)])?;
    }

    Ok(())
}

#[cfg(test)]
fn transfer_fallback_amounts(
    vault: &AccountView,
    winner_usdc_ata: &AccountView,
    treasury_usdc_ata: &AccountView,
    vrf_payer_usdc_ata: Option<&AccountView>,
    _round: &AccountView,
    vrf_reimburse: u64,
    payout: u64,
    fee: u64,
) -> ProgramResult {
    let vault_amount = {
        let data = vault.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };
    let winner_amount = {
        let data = winner_usdc_ata.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };
    let treasury_amount = {
        let data = treasury_usdc_ata.try_borrow()?;
        TokenAccountWithAmountView::read_from_account_data(&data)
            .map_err(|_| ProgramError::InvalidAccountData)?
            .amount
    };

    let total = vrf_reimburse
        .checked_add(payout)
        .and_then(|v| v.checked_add(fee))
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_vault = vault_amount
        .checked_sub(total)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
    let next_treasury = treasury_amount
        .checked_add(fee)
        .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;

    // Detect if winner_usdc_ata and vrf_payer_usdc_ata are the same account.
    // In the real CPI path, sequential invoke_signed calls are naturally cumulative
    // (SPL token reads current balance each time). In this test simulation we
    // read all balances upfront, so writing to the same account twice with stale
    // values would lose the first write.  We merge the amounts when overlapping.
    let winner_is_vrf_payer = vrf_reimburse > 0
        && vrf_payer_usdc_ata
            .map(|a| a.address() == winner_usdc_ata.address())
            .unwrap_or(false);

    {
        let mut data = vault.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_vault)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }

    if winner_is_vrf_payer {
        // Combined write: payout + vrf_reimburse to the same account
        let combined = winner_amount
            .checked_add(payout)
            .and_then(|v| v.checked_add(vrf_reimburse))
            .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
        let mut data = winner_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, combined)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    } else {
        // Separate writes for winner and vrf_payer
        let next_winner = winner_amount
            .checked_add(payout)
            .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
        {
            let mut data = winner_usdc_ata.try_borrow_mut()?;
            TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_winner)
                .map_err(|_| ProgramError::InvalidAccountData)?;
        }
        if vrf_reimburse > 0 {
            let vrf_payer_usdc_ata =
                vrf_payer_usdc_ata.ok_or::<ProgramError>(JackpotCompatError::InvalidVrfPayerAta.into())?;
            let vrf_payer_amount = {
                let data = vrf_payer_usdc_ata.try_borrow()?;
                TokenAccountWithAmountView::read_from_account_data(&data)
                    .map_err(|_| ProgramError::InvalidAccountData)?
                    .amount
            };
            let next_vrf_payer = vrf_payer_amount
                .checked_add(vrf_reimburse)
                .ok_or::<ProgramError>(JackpotCompatError::MathOverflow.into())?;
            let mut data = vrf_payer_usdc_ata.try_borrow_mut()?;
            TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_vrf_payer)
                .map_err(|_| ProgramError::InvalidAccountData)?;
        }
    }

    {
        let mut data = treasury_usdc_ata.try_borrow_mut()?;
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, next_treasury)
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

fn require_existing_degen_config_pda(account: &AccountView, program_id: &Address) -> ProgramResult {
    require_owned_by(account, program_id)?;
    let (expected_address, expected_bump) = Address::find_program_address(&[SEED_DEGEN_CFG], program_id);
    if account.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }
    let data = account.try_borrow()?;
    if data.len() != DEGEN_CONFIG_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("DegenConfig")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let cfg = DegenConfigView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    if cfg.bump != expected_bump {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(())
}

fn parse_round_id_from_begin_ix(instruction_data: &[u8]) -> Result<u64, ProgramError> {
    crate::instruction_layouts::BeginDegenExecutionArgsCompat::parse(instruction_data)
        .map(|args| args.round_id)
        .map_err(|_| ProgramError::InvalidInstructionData)
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

fn require_existing_degen_claim_pda_for_round_id(account: &AccountView, program_id: &Address, round_id: u64) -> ProgramResult {
    require_owned_by(account, program_id)?;
    let data = account.try_borrow()?;
    if data.len() != DEGEN_CLAIM_ACCOUNT_LEN || data.get(..8) != Some(&account_discriminator("DegenClaim")) {
        return Err(ProgramError::InvalidAccountData);
    }
    let claim = DegenClaimView::read_from_account_data(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    let expected = Address::create_program_address(
        &[SEED_DEGEN_CLAIM, &round_id.to_le_bytes(), &claim.winner, &[claim.bump]],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if account.address() != &expected {
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

fn require_mint_owned_by_program(account: &AccountView, token_program: &AccountView) -> ProgramResult {
    require_owned_by(account, token_program.address())
}

#[cfg(not(test))]
fn clock_unix_timestamp() -> i64 {
    use pinocchio::sysvars::{Sysvar, clock::Clock};
    Clock::get()
        .map(|clock| clock.unix_timestamp)
        .expect("Clock sysvar unavailable")
}

#[cfg(test)]
fn clock_unix_timestamp() -> i64 {
    1_001
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;

    use pinocchio::account::{NOT_BORROWED, RuntimeAccount};

    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        degen_pool_compat::{degen_token_mint_by_index, derive_degen_candidate_index_at_rank},
        legacy_layouts::{
            ConfigView, DegenClaimView, DegenConfigView, RoundLifecycleView, TokenAccountWithAmountView,
            CONFIG_ACCOUNT_LEN, DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK, DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED,
            DEGEN_CLAIM_STATUS_EXECUTING, DEGEN_CLAIM_STATUS_VRF_READY, DEGEN_MODE_EXECUTING,
            DEGEN_MODE_VRF_READY, ROUND_STATUS_CLAIMED, ROUND_STATUS_SETTLED,
            TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
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

    fn sample_degen_config() -> (Address, Vec<u8>) {
        let (degen_config_pda, degen_config_bump) = Address::find_program_address(&[SEED_DEGEN_CFG], &PROGRAM_ID);
        let mut data = vec![0u8; DEGEN_CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenConfig"));
        DegenConfigView {
            executor: [5u8; 32],
            fallback_timeout_sec: 300,
            bump: degen_config_bump,
            reserved: [0u8; 27],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (degen_config_pda, data)
    }

    fn sample_round(degen_mode: u8) -> (Address, Vec<u8>) {
        let (round_pda, round_bump) = Address::find_program_address(&[SEED_ROUND, &81u64.to_le_bytes()], &PROGRAM_ID);
        let mut data = vec![0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id: 81,
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
        data[48..80].copy_from_slice(&round_pda.to_bytes());
        RoundLifecycleView::write_winner_to_account_data(&mut data, &[9u8; 32]).unwrap();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut data, degen_mode).unwrap();
        (round_pda, data)
    }

    fn sample_degen_claim(round: Address, status: u8, token_mint: [u8; 32], receiver_token_ata: [u8; 32]) -> (Address, Vec<u8>) {
        let (degen_claim_pda, bump) = Address::find_program_address(
            &[SEED_DEGEN_CLAIM, &81u64.to_le_bytes(), &[9u8; 32]],
            &PROGRAM_ID,
        );
        let mut data = vec![0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
        DegenClaimView {
            round: round.to_bytes(),
            winner: [9u8; 32],
            round_id: 81,
            status,
            bump,
            selected_candidate_rank: if status == DEGEN_CLAIM_STATUS_EXECUTING { 0 } else if status == DEGEN_CLAIM_STATUS_VRF_READY { u8::MAX } else { 0 },
            fallback_reason: 0,
            token_index: 0,
            pool_version: 1,
            candidate_window: 10,
            padding0: [0u8; 7],
            requested_at: 777,
            fulfilled_at: 900,
            claimed_at: 0,
            fallback_after_ts: 1_000,
            payout_raw: if status == DEGEN_CLAIM_STATUS_EXECUTING { 997_500 } else { 0 },
            min_out_raw: if status == DEGEN_CLAIM_STATUS_EXECUTING { 777 } else { 0 },
            receiver_pre_balance: if status == DEGEN_CLAIM_STATUS_EXECUTING { 500 } else { 0 },
            token_mint,
            executor: if status == DEGEN_CLAIM_STATUS_EXECUTING { [5u8; 32] } else { [0u8; 32] },
            receiver_token_ata,
            randomness: [7u8; 32],
            route_hash: [33u8; 32],
            reserved: [0u8; 32],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (degen_claim_pda, data)
    }

    fn token_account(mint: [u8; 32], owner: [u8; 32], amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&mint);
        data[32..64].copy_from_slice(&owner);
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn claim_degen_fallback_runtime_transfers_and_marks_claimed() {
        let winner = Address::new_from_array([9u8; 32]);
        let (config_pda, config_data) = sample_config();
        let (round_pda, round_data) = sample_round(DEGEN_MODE_VRF_READY);
        let (degen_claim_pda, degen_claim_data) = sample_degen_claim(round_pda, DEGEN_CLAIM_STATUS_VRF_READY, [0u8; 32], [0u8; 32]);
        let vault_data = token_account([2u8; 32], round_pda.to_bytes(), 1_000_000);
        let winner_usdc_ata_data = token_account([2u8; 32], winner.to_bytes(), 0);
        let treasury_data = token_account([2u8; 32], [7u8; 32], 0);

        let mut winner_account = TestAccount::new(winner.to_bytes(), SYSTEM_PROGRAM_ID, true, false, 1_000_000, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new(degen_claim_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &degen_claim_data);
        let mut vault_account = TestAccount::new(round_pda.to_bytes(), pinocchio_token::ID, false, true, 1_000_000, &vault_data);
        let mut winner_usdc_ata_account = TestAccount::new([13u8; 32], pinocchio_token::ID, false, true, 1_000_000, &winner_usdc_ata_data);
        let mut treasury_account = TestAccount::new([3u8; 32], pinocchio_token::ID, false, true, 1_000_000, &treasury_data);
        let mut token_program = TestAccount::new(pinocchio_token::ID.to_bytes(), pinocchio_token::ID, false, false, 1_000_000, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(3);

        let accounts = [
            winner_account.view(),
            config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            vault_account.view(),
            winner_usdc_ata_account.view(),
            treasury_account.view(),
            token_program.view(),
        ];

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let updated_vault = TokenAccountWithAmountView::read_from_account_data(vault_account.data()).unwrap();
        let updated_winner = TokenAccountWithAmountView::read_from_account_data(winner_usdc_ata_account.data()).unwrap();
        let updated_treasury = TokenAccountWithAmountView::read_from_account_data(treasury_account.data()).unwrap();
        assert_eq!(updated_vault.amount, 0);
        assert_eq!(updated_winner.amount, 997_500);
        assert_eq!(updated_treasury.amount, 2_500);
        let updated_round = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(updated_round.status, ROUND_STATUS_CLAIMED);
        let updated_claim = DegenClaimView::read_from_account_data(degen_claim_account.data()).unwrap();
        assert_eq!(updated_claim.status, DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK);
    }

    /// Regression test: when the winner is also the VRF payer, both payout and
    /// vrf_reimburse must land in the same ATA without the second write
    /// clobbering the first.
    #[test]
    fn claim_degen_fallback_winner_is_vrf_payer_gets_combined_payout() {
        let winner = Address::new_from_array([9u8; 32]);
        let (config_pda, config_data) = sample_config();
        let (round_pda, mut round_data) = sample_round(DEGEN_MODE_VRF_READY);
        // Enable VRF reimbursement: set vrf_payer = winner
        RoundLifecycleView::write_vrf_payer_to_account_data(&mut round_data, &winner.to_bytes()).unwrap();
        let (degen_claim_pda, degen_claim_data) = sample_degen_claim(
            round_pda, DEGEN_CLAIM_STATUS_VRF_READY, [0u8; 32], [0u8; 32],
        );
        let vault_data = token_account([2u8; 32], round_pda.to_bytes(), 1_000_000);
        // Winner's USDC ATA — will also serve as vrf_payer_usdc_ata
        let winner_usdc_ata_data = token_account([2u8; 32], winner.to_bytes(), 0);
        let treasury_data = token_account([2u8; 32], [7u8; 32], 0);

        let winner_ata_address = [13u8; 32];
        let mut winner_account = TestAccount::new(winner.to_bytes(), SYSTEM_PROGRAM_ID, true, false, 1_000_000, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new(degen_claim_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &degen_claim_data);
        let mut vault_account = TestAccount::new(round_pda.to_bytes(), pinocchio_token::ID, false, true, 1_000_000, &vault_data);
        // Same address for both winner_usdc_ata and vrf_payer_usdc_ata
        let mut winner_usdc_ata_account = TestAccount::new(winner_ata_address, pinocchio_token::ID, false, true, 1_000_000, &winner_usdc_ata_data);
        let mut vrf_payer_usdc_ata_account = TestAccount::new(winner_ata_address, pinocchio_token::ID, false, true, 1_000_000, &winner_usdc_ata_data);
        let mut treasury_account = TestAccount::new([3u8; 32], pinocchio_token::ID, false, true, 1_000_000, &treasury_data);
        let mut token_program = TestAccount::new(pinocchio_token::ID.to_bytes(), pinocchio_token::ID, false, false, 1_000_000, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(3); // fallback_reason

        // 10-account variant: includes vrf_payer_authority + vrf_payer_usdc_ata
        let accounts = [
            winner_account.view(),
            config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            vault_account.view(),
            winner_usdc_ata_account.view(),
            treasury_account.view(),
            winner_account.view(), // vrf_payer_authority = winner
            vrf_payer_usdc_ata_account.view(), // same ATA as winner
            token_program.view(),
        ];

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        // total_usdc = 1_000_000, fee_bps = 25
        // vrf_reimburse = 200_000 (VRF_REIMBURSEMENT_USDC)
        // pot_after = 1_000_000 - 200_000 = 800_000
        // fee = 800_000 * 25 / 10_000 = 2_000
        // payout = 800_000 - 2_000 = 798_000
        // winner ATA should get payout + vrf_reimburse = 798_000 + 200_000 = 998_000
        let updated_vault = TokenAccountWithAmountView::read_from_account_data(vault_account.data()).unwrap();
        let updated_winner = TokenAccountWithAmountView::read_from_account_data(winner_usdc_ata_account.data()).unwrap();
        let updated_treasury = TokenAccountWithAmountView::read_from_account_data(treasury_account.data()).unwrap();
        assert_eq!(updated_vault.amount, 0);
        assert_eq!(updated_winner.amount, 998_000, "winner should receive payout(798k) + vrf_reimburse(200k)");
        assert_eq!(updated_treasury.amount, 2_000);
    }

    #[test]
    fn begin_degen_execution_runtime_transfers_to_executor_and_marks_executing() {
        let executor = Address::new_from_array([5u8; 32]);
        let (config_pda, config_data) = sample_config();
        let (degen_config_pda, degen_config_data) = sample_degen_config();
        let (round_pda, round_data) = sample_round(DEGEN_MODE_VRF_READY);
        let (degen_claim_pda, degen_claim_data) = sample_degen_claim(round_pda, DEGEN_CLAIM_STATUS_VRF_READY, [0u8; 32], [0u8; 32]);
        let token_index = derive_degen_candidate_index_at_rank(&[7u8; 32], 1, 0);
        let token_mint = degen_token_mint_by_index(token_index).unwrap();
        let vault_data = token_account([2u8; 32], round_pda.to_bytes(), 1_000_000);
        let executor_usdc_ata_data = token_account([2u8; 32], executor.to_bytes(), 0);
        let treasury_data = token_account([2u8; 32], [7u8; 32], 0);
        let receiver_data = token_account(token_mint, [9u8; 32], 500);

        let mut executor_account = TestAccount::new(executor.to_bytes(), SYSTEM_PROGRAM_ID, true, true, 1_000_000, &[]);
        let mut config_account = TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut degen_config_account = TestAccount::new(degen_config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &degen_config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new(degen_claim_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &degen_claim_data);
        let mut vault_account = TestAccount::new(round_pda.to_bytes(), pinocchio_token::ID, false, true, 1_000_000, &vault_data);
        let mut executor_usdc_ata_account = TestAccount::new([14u8; 32], pinocchio_token::ID, false, true, 1_000_000, &executor_usdc_ata_data);
        let mut treasury_account = TestAccount::new([3u8; 32], pinocchio_token::ID, false, true, 1_000_000, &treasury_data);
        let mut selected_mint_account = TestAccount::new(token_mint, pinocchio_token::ID, false, false, 1_000_000, &[]);
        let mut receiver_account = TestAccount::new([12u8; 32], pinocchio_token::ID, false, true, 1_000_000, &receiver_data);
        let mut token_program = TestAccount::new(pinocchio_token::ID.to_bytes(), pinocchio_token::ID, false, false, 1_000_000, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("begin_degen_execution"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(0);
        ix.extend_from_slice(&token_index.to_le_bytes());
        ix.extend_from_slice(&777u64.to_le_bytes());
        ix.extend_from_slice(&[33u8; 32]);

        let accounts = [
            executor_account.view(),
            config_account.view(),
            degen_config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            vault_account.view(),
            executor_usdc_ata_account.view(),
            treasury_account.view(),
            selected_mint_account.view(),
            receiver_account.view(),
            token_program.view(),
        ];

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let updated_vault = TokenAccountWithAmountView::read_from_account_data(vault_account.data()).unwrap();
        let updated_executor = TokenAccountWithAmountView::read_from_account_data(executor_usdc_ata_account.data()).unwrap();
        let updated_treasury = TokenAccountWithAmountView::read_from_account_data(treasury_account.data()).unwrap();
        assert_eq!(updated_vault.amount, 0);
        assert_eq!(updated_executor.amount, 997_500);
        assert_eq!(updated_treasury.amount, 2_500);
        assert_eq!(RoundLifecycleView::read_degen_mode_status_from_account_data(round_account.data()).unwrap(), DEGEN_MODE_EXECUTING);
        let claim = DegenClaimView::read_from_account_data(degen_claim_account.data()).unwrap();
        assert_eq!(claim.status, DEGEN_CLAIM_STATUS_EXECUTING);
        assert_eq!(claim.token_index, token_index);
        assert_eq!(claim.token_mint, token_mint);
        assert_eq!(claim.executor, executor.to_bytes());
        assert_eq!(claim.receiver_token_ata, [12u8; 32]);
        assert_eq!(claim.receiver_pre_balance, 500);
        assert_eq!(claim.min_out_raw, 777);
    }

    #[test]
    fn finalize_degen_success_runtime_marks_claimed_swapped() {
        let executor = Address::new_from_array([5u8; 32]);
        let (_config_pda, _config_data) = sample_config();
        let (degen_config_pda, degen_config_data) = sample_degen_config();
        let (round_pda, round_data) = sample_round(DEGEN_MODE_EXECUTING);
        let token_mint = [11u8; 32];
        let (degen_claim_pda, degen_claim_data) = sample_degen_claim(round_pda, DEGEN_CLAIM_STATUS_EXECUTING, token_mint, [12u8; 32]);
        let executor_usdc_ata_data = token_account([2u8; 32], executor.to_bytes(), 0);
        let receiver_data = token_account(token_mint, [9u8; 32], 1_500);

        let mut executor_account = TestAccount::new(executor.to_bytes(), SYSTEM_PROGRAM_ID, true, true, 1_000_000, &[]);
        let mut degen_config_account = TestAccount::new(degen_config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &degen_config_data);
        let mut round_account = TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &round_data);
        let mut degen_claim_account = TestAccount::new(degen_claim_pda.to_bytes(), PROGRAM_ID, false, true, 1_000_000, &degen_claim_data);
        let mut executor_usdc_ata_account = TestAccount::new([14u8; 32], pinocchio_token::ID, false, true, 1_000_000, &executor_usdc_ata_data);
        let mut receiver_account = TestAccount::new([12u8; 32], pinocchio_token::ID, false, true, 1_000_000, &receiver_data);
        let mut token_program = TestAccount::new(pinocchio_token::ID.to_bytes(), pinocchio_token::ID, false, false, 1_000_000, &[]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("finalize_degen_success"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let accounts = [
            executor_account.view(),
            degen_config_account.view(),
            round_account.view(),
            degen_claim_account.view(),
            executor_usdc_ata_account.view(),
            receiver_account.view(),
            token_program.view(),
        ];

        process_instruction(&PROGRAM_ID, &accounts, &ix).unwrap();

        let updated_round = RoundLifecycleView::read_from_account_data(round_account.data()).unwrap();
        assert_eq!(updated_round.status, ROUND_STATUS_CLAIMED);
        assert_eq!(RoundLifecycleView::read_degen_mode_status_from_account_data(round_account.data()).unwrap(), 4);
        let claim = DegenClaimView::read_from_account_data(degen_claim_account.data()).unwrap();
        assert_eq!(claim.status, DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED);
        assert_eq!(claim.claimed_at, 1_001);
    }
}
