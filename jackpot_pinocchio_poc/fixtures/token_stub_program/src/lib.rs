//! Minimal SPL Token stub for Mollusk smoke tests.
//!
//! Handles only the Transfer instruction (discriminator = 3).
//! Works with our synthetic 72-byte token account layout:
//!   [0..32]  mint pubkey
//!   [32..64] owner pubkey
//!   [64..72] amount (u64 LE)
//!
//! All other instruction discriminators are silently accepted (no-op).
#![no_std]

use pinocchio::{entrypoint, AccountView, Address, ProgramResult};
use pinocchio::error::ProgramError;

entrypoint!(process_instruction, 8);

/// Amount field offset within the 72-byte synthetic layout.
const AMOUNT_OFFSET: usize = 64;

pub fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Minimum instruction data: 1 byte discriminator + 8 byte amount
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let discriminator = instruction_data[0];

    match discriminator {
        // Transfer instruction
        3 => process_transfer(accounts, instruction_data),
        // Everything else: no-op success
        _ => Ok(()),
    }
}

fn process_transfer(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // Transfer data: [0] = 3 (disc), [1..9] = amount u64 LE
    if data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let amount = u64::from_le_bytes([
        data[1], data[2], data[3], data[4],
        data[5], data[6], data[7], data[8],
    ]);

    if amount == 0 {
        return Ok(());
    }

    let from = &accounts[0];
    let to = &accounts[1];
    // accounts[2] = authority (we don't verify signatures in the stub)

    // Read current balances from our 72-byte layout
    {
        let from_data = from.try_borrow()?;
        if from_data.len() < AMOUNT_OFFSET + 8 {
            return Err(ProgramError::InvalidAccountData);
        }
        let from_amount = u64::from_le_bytes([
            from_data[AMOUNT_OFFSET],
            from_data[AMOUNT_OFFSET + 1],
            from_data[AMOUNT_OFFSET + 2],
            from_data[AMOUNT_OFFSET + 3],
            from_data[AMOUNT_OFFSET + 4],
            from_data[AMOUNT_OFFSET + 5],
            from_data[AMOUNT_OFFSET + 6],
            from_data[AMOUNT_OFFSET + 7],
        ]);
        if from_amount < amount {
            // InsufficientFunds  — use a generic custom error
            return Err(ProgramError::Custom(1));
        }
    }

    // Mutate `from`: subtract amount (checked)
    {
        let mut from_data = from.try_borrow_mut()?;
        let current = u64::from_le_bytes([
            from_data[AMOUNT_OFFSET],
            from_data[AMOUNT_OFFSET + 1],
            from_data[AMOUNT_OFFSET + 2],
            from_data[AMOUNT_OFFSET + 3],
            from_data[AMOUNT_OFFSET + 4],
            from_data[AMOUNT_OFFSET + 5],
            from_data[AMOUNT_OFFSET + 6],
            from_data[AMOUNT_OFFSET + 7],
        ]);
        let next = current.checked_sub(amount).ok_or(ProgramError::Custom(1))?;
        from_data[AMOUNT_OFFSET..AMOUNT_OFFSET + 8]
            .copy_from_slice(&next.to_le_bytes());
    }

    // Mutate `to`: add amount (checked)
    {
        let mut to_data = to.try_borrow_mut()?;
        if to_data.len() < AMOUNT_OFFSET + 8 {
            return Err(ProgramError::InvalidAccountData);
        }
        let current = u64::from_le_bytes([
            to_data[AMOUNT_OFFSET],
            to_data[AMOUNT_OFFSET + 1],
            to_data[AMOUNT_OFFSET + 2],
            to_data[AMOUNT_OFFSET + 3],
            to_data[AMOUNT_OFFSET + 4],
            to_data[AMOUNT_OFFSET + 5],
            to_data[AMOUNT_OFFSET + 6],
            to_data[AMOUNT_OFFSET + 7],
        ]);
        let next = current.checked_add(amount).ok_or(ProgramError::Custom(2))?;
        to_data[AMOUNT_OFFSET..AMOUNT_OFFSET + 8]
            .copy_from_slice(&next.to_le_bytes());
    }

    Ok(())
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
