#![no_std]

use pinocchio::{entrypoint, AccountView, Address, ProgramResult};

entrypoint!(process_instruction, 8);

pub fn process_instruction(
    _program_id: &Address,
    _accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    Ok(())
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
