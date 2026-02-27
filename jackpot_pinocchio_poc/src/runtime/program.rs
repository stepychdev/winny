use pinocchio::{
    AccountView, Address, ProgramResult,
    error::ProgramError,
};

use super::{admin_config_program, claims_program, degen_execution_program, degen_vrf_program, deposits_program, refunds_program, round_lifecycle_program, terminal_cleanup_program, vrf_program};

#[allow(unexpected_cfgs)]
#[cfg(feature = "bpf-entrypoint")]
mod bpf_entrypoint {
    use pinocchio::entrypoint;

    entrypoint!(super::process_instruction, 16);
}

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match admin_config_program::process_instruction(program_id, accounts, instruction_data) {
        Ok(()) => Ok(()),
        Err(ProgramError::InvalidInstructionData) => {
            match round_lifecycle_program::process_instruction(program_id, accounts, instruction_data) {
                Ok(()) => Ok(()),
                Err(ProgramError::InvalidInstructionData) => {
                    match refunds_program::process_instruction(program_id, accounts, instruction_data) {
                        Ok(()) => Ok(()),
                        Err(ProgramError::InvalidInstructionData) => {
                            match deposits_program::process_instruction(program_id, accounts, instruction_data) {
                                Ok(()) => Ok(()),
                                Err(ProgramError::InvalidInstructionData) => {
                                    match claims_program::process_instruction(program_id, accounts, instruction_data) {
                                        Ok(()) => Ok(()),
                                        Err(ProgramError::InvalidInstructionData) => {
                                            match terminal_cleanup_program::process_instruction(program_id, accounts, instruction_data) {
                                                Ok(()) => Ok(()),
                                                Err(ProgramError::InvalidInstructionData) => {
                                                    match vrf_program::process_instruction(program_id, accounts, instruction_data) {
                                                        Ok(()) => Ok(()),
                                                        Err(ProgramError::InvalidInstructionData) => {
                                                            match degen_vrf_program::process_instruction(program_id, accounts, instruction_data) {
                                                                Ok(()) => Ok(()),
                                                                Err(ProgramError::InvalidInstructionData) => {
                                                                    degen_execution_program::process_instruction(program_id, accounts, instruction_data)
                                                                }
                                                                Err(err) => Err(err),
                                                            }
                                                        }
                                                        Err(err) => Err(err),
                                                    }
                                                }
                                                Err(err) => Err(err),
                                            }
                                        }
                                        Err(err) => Err(err),
                                    }
                                }
                                Err(err) => Err(err),
                            }
                        }
                        Err(err) => Err(err),
                    }
                }
                Err(err) => Err(err),
            }
        }
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use core::mem::size_of;

    use pinocchio::{
        account::{NOT_BORROWED, RuntimeAccount},
        Address,
        error::ProgramError,
    };

    use crate::{
        anchor_compat::account_discriminator,
        legacy_layouts::{
            ConfigView, ParticipantView, RoundLifecycleView, TokenAccountWithAmountView,
            CONFIG_ACCOUNT_LEN, PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_CLAIMED, ROUND_STATUS_CANCELLED, TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
        },
    };

    use crate::anchor_compat::instruction_discriminator;

    use super::process_instruction;

    const PROGRAM_ID: Address = Address::new_from_array([7u8; 32]);

    const SEED_ROUND: &[u8] = b"round";
    const SEED_PARTICIPANT: &[u8] = b"p";
    const SEED_CFG: &[u8] = b"cfg";

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

        fn lamports(&self) -> u64 {
            let raw = self.backing.as_ptr() as *const RuntimeAccount;
            unsafe { (*raw).lamports }
        }

        fn data_len(&self) -> usize {
            let raw = self.backing.as_ptr() as *const RuntimeAccount;
            unsafe { (*raw).data_len as usize }
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

    fn sample_round(round_id: u64) -> (Address, Vec<u8>) {
        let (round_pda, _) =
            Address::find_program_address(&[SEED_ROUND, &round_id.to_le_bytes()], &PROGRAM_ID);
        let mut data = vec![0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status: ROUND_STATUS_CLAIMED,
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

    fn sample_participant(round: Address, user: Address) -> (Address, Vec<u8>) {
        let (participant_pda, bump) = Address::find_program_address(
            &[SEED_PARTICIPANT, round.as_ref(), user.as_ref()],
            &PROGRAM_ID,
        );
        let mut data = vec![0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Participant"));
        ParticipantView {
            round: round.to_bytes(),
            user: user.to_bytes(),
            index: 1,
            bump,
            tickets_total: 100,
            usdc_total: 1_000_000,
            deposits_count: 1,
            reserved: [0u8; 16],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        (participant_pda, data)
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

    fn token_account(mint: Address, owner: Address, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(owner.as_ref());
        TokenAccountWithAmountView::write_amount_to_account_data(&mut data, amount).unwrap();
        data
    }

    #[test]
    fn rejects_unknown_discriminator() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("unknown_ix"));
        let err = process_instruction(&PROGRAM_ID, &[], &ix).unwrap_err();
        assert_eq!(err, ProgramError::InvalidInstructionData);
    }

    #[test]
    fn routes_terminal_cleanup_slice() {
        let payer = Address::new_from_array([9u8; 32]);
        let user = Address::new_from_array([5u8; 32]);
        let (round_pda, round_data) = sample_round(81);
        let (participant_pda, participant_data) = sample_participant(round_pda, user);

        let mut payer_account = TestAccount::new(
            payer.to_bytes(),
            Address::new_from_array([0u8; 32]),
            true,
            true,
            1_000_000_000,
            &[],
        );
        let mut user_account = TestAccount::new(
            user.to_bytes(),
            Address::new_from_array([0u8; 32]),
            false,
            true,
            500_000,
            &[],
        );
        let mut round_account =
            TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &round_data);
        let mut participant_account = TestAccount::new(
            participant_pda.to_bytes(),
            PROGRAM_ID,
            false,
            true,
            222_000,
            &participant_data,
        );

        let views = [
            payer_account.view(),
            user_account.view(),
            round_account.view(),
            participant_account.view(),
        ];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_participant"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        process_instruction(&PROGRAM_ID, &views, &ix).unwrap();

        assert_eq!(user_account.lamports(), 722_000);
        assert_eq!(participant_account.lamports(), 0);
        assert_eq!(participant_account.data_len(), 0);
    }

    #[test]
    fn routes_refund_slice() {
        let user = Address::new_from_array([5u8; 32]);
        let usdc_mint = Address::new_from_array([9u8; 32]);
        let vault = Address::new_from_array([8u8; 32]);
        let (config_pda, config_data) = sample_config(usdc_mint);
        let (round_pda, mut round_data) = sample_round(81);
        round_data[8 + 40..8 + 72].copy_from_slice(vault.as_ref());
        RoundLifecycleView::write_status_to_account_data(&mut round_data, ROUND_STATUS_CANCELLED).unwrap();
        let (participant_pda, participant_data) = sample_participant(round_pda, user);

        let mut user_account = TestAccount::new(
            user.to_bytes(),
            Address::new_from_array([0u8; 32]),
            true,
            false,
            0,
            &[],
        );
        let mut config_account =
            TestAccount::new(config_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &config_data);
        let mut round_account =
            TestAccount::new(round_pda.to_bytes(), PROGRAM_ID, false, false, 1_000_000, &round_data);
        let mut participant_account = TestAccount::new(
            participant_pda.to_bytes(),
            PROGRAM_ID,
            false,
            true,
            1_000_000,
            &participant_data,
        );
        let mut vault_account = TestAccount::new(
            vault.to_bytes(),
            pinocchio_token::ID,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, round_pda, 1_000_000),
        );
        let mut user_ata_account = TestAccount::new(
            Address::new_from_array([6u8; 32]).to_bytes(),
            pinocchio_token::ID,
            false,
            true,
            1_000_000,
            &token_account(usdc_mint, user, 0),
        );
        let mut token_program_account = TestAccount::new(
            pinocchio_token::ID.to_bytes(),
            Address::new_from_array([0u8; 32]),
            false,
            false,
            0,
            &[],
        );

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

        let participant = ParticipantView::read_from_account_data(participant_account.data()).unwrap();
        assert_eq!(participant.usdc_total, 0);
        let user_ata = TokenAccountWithAmountView::read_from_account_data(user_ata_account.data()).unwrap();
        assert_eq!(user_ata.amount, 1_000_000);
    }
}
