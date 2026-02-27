use mollusk_svm::Mollusk;
use mollusk_svm::program::create_program_account_loader_v3;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use jackpot_pinocchio_poc::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    legacy_layouts::{
        CONFIG_ACCOUNT_LEN, DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CONFIG_ACCOUNT_LEN,
        PARTICIPANT_ACCOUNT_LEN, TOKEN_ACCOUNT_WITH_AMOUNT_LEN, ConfigView, DegenClaimView,
        DegenConfigView, ParticipantView, RoundLifecycleView, TokenAccountWithAmountView,
        DEGEN_CLAIM_STATUS_EXECUTING, DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED, DEGEN_MODE_CLAIMED,
        DEGEN_MODE_EXECUTING, ROUND_ACCOUNT_LEN, ROUND_STATUS_CANCELLED, ROUND_STATUS_CLAIMED,
        ROUND_STATUS_OPEN, ROUND_STATUS_SETTLED,
    },
};

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn loads_routed_runtime_program_elf() {
    let program_id = Pubkey::new_unique();
    let _mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn init_config_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let payer = Pubkey::new_unique();
    let admin = Pubkey::new_unique();
    let usdc_mint = Pubkey::new_from_array([2u8; 32]);
    let treasury_ata = Pubkey::new_from_array([3u8; 32]);
    let (config_pda, _config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);
    let system_program = Pubkey::default();

    let mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: encode_init_config(usdc_mint, treasury_ata, 25, 10_000, 120, 1, 2, 1_000_000),
    };

    let accounts = vec![
        (payer, signer_account()),
        (admin, signer_account()),
        (config_pda, Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, &program_id)),
        (system_program, Account::new(1_000_000, 0, &Pubkey::default())),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated = result.get_account(&config_pda).expect("config account");
    let view = ConfigView::read_from_account_data(&updated.data).expect("config layout");
    assert_eq!(view.admin, admin.to_bytes());
    assert_eq!(view.usdc_mint, usdc_mint.to_bytes());
    assert_eq!(view.treasury_usdc_ata, treasury_ata.to_bytes());
    assert_eq!(view.fee_bps, 25);
    assert_eq!(view.ticket_unit, 10_000);
    assert_eq!(view.round_duration_sec, 120);
    assert_eq!(view.min_participants, 1);
    assert_eq!(view.min_total_tickets, 2);
    assert_eq!(view.max_deposit_per_user, 1_000_000);
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn update_config_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let admin = Pubkey::new_unique();
    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);

    let mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data: encode_update_config(250, 10_000, 60, 2, 200),
    };

    let accounts = vec![
        (admin, signer_account()),
        (
            config_pda,
            config_account(
                &program_id,
                config_bump,
                admin,
                25,
                1_000_000,
                30,
                1,
                2,
            ),
        ),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated = result.get_account(&config_pda).expect("config account");
    let view = ConfigView::read_from_account_data(&updated.data).expect("config layout");
    assert_eq!(view.fee_bps, 250);
    assert_eq!(view.ticket_unit, 10_000);
    assert_eq!(view.round_duration_sec, 60);
    assert_eq!(view.min_participants, 2);
    assert_eq!(view.min_total_tickets, 200);
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn upsert_degen_config_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let admin = Pubkey::new_unique();
    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);
    let (degen_config_pda, degen_config_bump) =
        Pubkey::find_program_address(&[b"degen_cfg"], &program_id);
    let system_program = Pubkey::default();

    let mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(degen_config_pda, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: encode_upsert_degen_config(Pubkey::new_from_array([9u8; 32]), 300),
    };

    let accounts = vec![
        (admin, signer_account()),
        (
            config_pda,
            config_account(
                &program_id,
                config_bump,
                admin,
                25,
                1_000_000,
                30,
                1,
                2,
            ),
        ),
        (
            degen_config_pda,
            degen_config_account_with_timeout(
                &program_id,
                degen_config_bump,
                Pubkey::default(),
                0,
            ),
        ),
        (system_program, Account::new(1_000_000, 0, &Pubkey::default())),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated = result
        .get_account(&degen_config_pda)
        .expect("degen config account");
    let view = DegenConfigView::read_from_account_data(&updated.data).expect("degen config layout");
    assert_eq!(view.executor, [9u8; 32]);
    assert_eq!(view.fallback_timeout_sec, 300);
    assert_eq!(view.bump, degen_config_bump);
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn admin_force_cancel_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let admin = Pubkey::new_unique();
    let round_id = 42u64;
    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);
    let (round_pda, _round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id);

    let mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(round_pda, false),
        ],
        data: encode_round_id_ix("admin_force_cancel", round_id),
    };

    let accounts = vec![
        (admin, signer_account()),
        (
            config_pda,
            config_account(
                &program_id,
                config_bump,
                admin,
                25,
                1_000_000,
                30,
                1,
                2,
            ),
        ),
        (round_pda, round_account(&program_id, round_id, ROUND_STATUS_OPEN)),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated = result.get_account(&round_pda).expect("round account");
    let view = RoundLifecycleView::read_from_account_data(&updated.data).expect("round layout");
    assert_eq!(view.status, ROUND_STATUS_CANCELLED);
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn close_participant_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let payer = Pubkey::new_unique();
    let user = Pubkey::new_unique();
    let round_id = 43u64;
    let (round_pda, _round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id);
    let (participant_pda, participant_bump) =
        Pubkey::find_program_address(&[b"p", round_pda.as_ref(), user.as_ref()], &program_id);

    let mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(user, false),
            AccountMeta::new_readonly(round_pda, false),
            AccountMeta::new(participant_pda, false),
        ],
        data: encode_round_id_ix("close_participant", round_id),
    };

    let accounts = vec![
        (payer, signer_account()),
        (user, writable_user_account()),
        (round_pda, round_account(&program_id, round_id, ROUND_STATUS_CLAIMED)),
        (
            participant_pda,
            participant_account(&program_id, participant_bump, round_pda, user),
        ),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated_user = result.get_account(&user).expect("user account");
    assert!(updated_user.lamports > 500_000);

    let updated_participant = result
        .get_account(&participant_pda)
        .expect("participant account");
    assert_eq!(updated_participant.lamports, 0);
    assert_eq!(updated_participant.data.len(), 0);
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn start_round_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let payer = Pubkey::new_unique();
    let round_id = 45u64;
    let usdc_mint = Pubkey::new_from_array([2u8; 32]);
    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);
    let (round_pda, _round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id);
    let associated_token_program =
        Pubkey::new_from_array(pinocchio_associated_token_account::ID.to_bytes());
    let token_program = Pubkey::new_from_array(pinocchio_token::ID.to_bytes());
    let system_program = Pubkey::default();
    let (vault_ata, _) = Pubkey::find_program_address(
        &[round_pda.as_ref(), token_program.as_ref(), usdc_mint.as_ref()],
        &associated_token_program,
    );

    let mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(round_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new_readonly(associated_token_program, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: encode_round_id_ix("start_round", round_id),
    };

    let accounts = vec![
        (payer, signer_account()),
        (
            config_pda,
            config_account_with_usdc(
                &program_id,
                config_bump,
                payer,
                usdc_mint,
                25,
                1_000_000,
                30,
                1,
                2,
            ),
        ),
        (round_pda, Account::new(1_000_000_000, ROUND_ACCOUNT_LEN, &program_id)),
        (vault_ata, token_account(&token_program, usdc_mint, round_pda, 0)),
        (usdc_mint, Account::new(1_000_000_000, 0, &token_program)),
        (
            associated_token_program,
            Account::new(1_000_000, 0, &Pubkey::default()),
        ),
        (token_program, Account::new(1_000_000, 0, &Pubkey::default())),
        (system_program, Account::new(1_000_000, 0, &Pubkey::default())),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated = result.get_account(&round_pda).expect("round account");
    let view = RoundLifecycleView::read_from_account_data(&updated.data).expect("round layout");
    assert_eq!(view.round_id, round_id);
    assert_eq!(view.status, ROUND_STATUS_OPEN);
    assert_eq!(view.start_ts, 0);
    assert_eq!(
        RoundLifecycleView::read_vault_pubkey_from_account_data(&updated.data).expect("vault pubkey"),
        vault_ata.to_bytes(),
    );
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn begin_degen_execution_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let executor = Pubkey::new_unique();
    let winner = Pubkey::new_unique();
    let round_id = 44u64;
    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);
    let (degen_config_pda, degen_config_bump) =
        Pubkey::find_program_address(&[b"degen_cfg"], &program_id);
    let (round_pda, round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id);
    let (degen_claim_pda, degen_claim_bump) = Pubkey::find_program_address(
        &[b"degen_claim", &round_id.to_le_bytes(), winner.as_ref()],
        &program_id,
    );
    let token_mint = Pubkey::new_from_array(jackpot_pinocchio_poc::degen_pool_compat::degen_token_mint_by_index(
        jackpot_pinocchio_poc::degen_pool_compat::derive_degen_candidate_index_at_rank(&[7u8; 32], 1, 0),
    ).expect("live degen mint"));
    let token_index = jackpot_pinocchio_poc::degen_pool_compat::derive_degen_candidate_index_at_rank(&[7u8; 32], 1, 0);
    let receiver_token_ata = Pubkey::new_unique();
    let vault_ata = Pubkey::new_unique();
    let executor_usdc_ata = Pubkey::new_unique();
    let treasury_usdc_ata = Pubkey::new_unique();
    let usdc_mint = Pubkey::new_from_array([2u8; 32]);
    let token_program = Pubkey::new_from_array(pinocchio_token::ID.to_bytes());

    let mut mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");
    mollusk.add_program(&token_program, "token_stub_program");

    let mut data = Vec::with_capacity(8 + 8 + 1 + 4 + 8 + 32);
    data.extend_from_slice(&instruction_discriminator("begin_degen_execution"));
    data.extend_from_slice(&round_id.to_le_bytes());
    data.push(0);
    data.extend_from_slice(&token_index.to_le_bytes());
    data.extend_from_slice(&777u64.to_le_bytes());
    data.extend_from_slice(&[33u8; 32]);

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(executor, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(degen_config_pda, false),
            AccountMeta::new(round_pda, false),
            AccountMeta::new(degen_claim_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(executor_usdc_ata, false),
            AccountMeta::new(treasury_usdc_ata, false),
            AccountMeta::new_readonly(token_mint, false),
            AccountMeta::new(receiver_token_ata, false),
            AccountMeta::new_readonly(token_program, false),
        ],
        data,
    };

    let accounts = vec![
        (executor, signer_account()),
        (config_pda, config_account_with_treasury(&program_id, config_bump, executor, usdc_mint, treasury_usdc_ata, 25, 10_000_000, 30, 1, 2)),
        (degen_config_pda, degen_config_account(&program_id, degen_config_bump, executor)),
        (round_pda, degen_round_vrf_ready_account(&program_id, round_bump, round_id, winner, vault_ata)),
        (
            degen_claim_pda,
            degen_claim_vrf_ready_account(&program_id, degen_claim_bump, round_pda, winner, round_id),
        ),
        (vault_ata, token_account(&token_program, usdc_mint, round_pda, 1_000_000)),
        (executor_usdc_ata, token_account(&token_program, usdc_mint, executor, 0)),
        (treasury_usdc_ata, token_account(&token_program, usdc_mint, Pubkey::new_unique(), 0)),
        (token_mint, Account::new(1_000_000, 0, &token_program)),
        (receiver_token_ata, token_account(&token_program, token_mint, winner, 500)),
        (token_program, create_program_account_loader_v3(&token_program)),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated_round = result.get_account(&round_pda).expect("round account");
    assert_eq!(
        RoundLifecycleView::read_degen_mode_status_from_account_data(&updated_round.data).expect("degen status"),
        DEGEN_MODE_EXECUTING,
    );

    let updated_claim = result.get_account(&degen_claim_pda).expect("degen claim account");
    let claim = DegenClaimView::read_from_account_data(&updated_claim.data).expect("degen claim layout");
    assert_eq!(claim.status, DEGEN_CLAIM_STATUS_EXECUTING);
    assert_eq!(claim.token_index, token_index);
    assert_eq!(claim.token_mint, token_mint.to_bytes());
    assert_eq!(claim.executor, executor.to_bytes());

    let updated_executor = result.get_account(&executor_usdc_ata).expect("executor usdc ata");
    let executor_ata = TokenAccountWithAmountView::read_from_account_data(&updated_executor.data)
        .expect("executor ata layout");
    assert_eq!(executor_ata.amount, 997_500);
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn claim_degen_fallback_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let winner = Pubkey::new_unique();
    let treasury_owner = Pubkey::new_unique();
    let round_id = 45u64;
    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);
    let (round_pda, round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id);
    let (degen_claim_pda, degen_claim_bump) = Pubkey::find_program_address(
        &[b"degen_claim", &round_id.to_le_bytes(), winner.as_ref()],
        &program_id,
    );
    let vault_ata = Pubkey::new_unique();
    let winner_usdc_ata = Pubkey::new_unique();
    let treasury_usdc_ata = Pubkey::new_unique();
    let token_program = Pubkey::new_from_array(pinocchio_token::ID.to_bytes());
    let usdc_mint = Pubkey::new_from_array([2u8; 32]);

    let mut mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");
    mollusk.add_program(&token_program, "token_stub_program");
    mollusk.sysvars.clock.unix_timestamp = 1_700_000_000;

    let mut data = Vec::with_capacity(8 + 8 + 1);
    data.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
    data.extend_from_slice(&round_id.to_le_bytes());
    data.push(9);

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(winner, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(round_pda, false),
            AccountMeta::new(degen_claim_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(winner_usdc_ata, false),
            AccountMeta::new(treasury_usdc_ata, false),
            AccountMeta::new_readonly(token_program, false),
        ],
        data,
    };

    let accounts = vec![
        (winner, signer_account()),
        (config_pda, config_account_with_treasury(&program_id, config_bump, winner, usdc_mint, treasury_usdc_ata, 25, 1_000_000, 30, 1, 2)),
        (round_pda, degen_round_fallback_account(&program_id, round_bump, round_id, winner, vault_ata)),
        (degen_claim_pda, degen_claim_fallback_ready_account(&program_id, degen_claim_bump, round_pda, winner, round_id)),
        (vault_ata, token_account(&token_program, usdc_mint, round_pda, 1_000_000)),
        (winner_usdc_ata, token_account(&token_program, usdc_mint, winner, 0)),
        (treasury_usdc_ata, token_account(&token_program, usdc_mint, treasury_owner, 0)),
        (token_program, create_program_account_loader_v3(&token_program)),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated_round = result.get_account(&round_pda).expect("round account");
    let round = RoundLifecycleView::read_from_account_data(&updated_round.data).expect("round layout");
    assert_eq!(round.status, ROUND_STATUS_CLAIMED);
    assert_eq!(
        RoundLifecycleView::read_degen_mode_status_from_account_data(&updated_round.data).expect("degen status"),
        DEGEN_MODE_CLAIMED,
    );

    let updated_claim = result.get_account(&degen_claim_pda).expect("degen claim account");
    let claim = DegenClaimView::read_from_account_data(&updated_claim.data).expect("degen claim layout");
    assert_eq!(claim.status, jackpot_pinocchio_poc::legacy_layouts::DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK);
    assert_eq!(claim.fallback_reason, 9);

    let updated_winner = result.get_account(&winner_usdc_ata).expect("winner usdc ata");
    let winner_ata = TokenAccountWithAmountView::read_from_account_data(&updated_winner.data)
        .expect("winner ata layout");
    assert_eq!(winner_ata.amount, 997_500);

    let updated_treasury = result.get_account(&treasury_usdc_ata).expect("treasury usdc ata");
    let treasury_ata = TokenAccountWithAmountView::read_from_account_data(&updated_treasury.data)
        .expect("treasury ata layout");
    assert_eq!(treasury_ata.amount, 2_500);
}

#[test]
#[ignore = "requires prebuilt SBF fixture via scripts/run_mollusk_smoke.sh"]
fn finalize_degen_success_instruction_succeeds_in_mollusk() {
    let program_id = Pubkey::new_unique();
    let executor = Pubkey::new_unique();
    let winner = Pubkey::new_unique();
    let round_id = 44u64;
    let (degen_config_pda, degen_config_bump) =
        Pubkey::find_program_address(&[b"degen_cfg"], &program_id);
    let (round_pda, round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id);
    let (degen_claim_pda, degen_claim_bump) = Pubkey::find_program_address(
        &[b"degen_claim", &round_id.to_le_bytes(), winner.as_ref()],
        &program_id,
    );
    let token_mint = Pubkey::new_unique();
    let receiver_token_ata = Pubkey::new_unique();
    let executor_usdc_ata = Pubkey::new_unique();
    let token_program = Pubkey::new_from_array(pinocchio_token::ID.to_bytes());

    let mut mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");
    mollusk.add_program(&token_program, "token_stub_program");

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(executor, true),
            AccountMeta::new_readonly(degen_config_pda, false),
            AccountMeta::new(round_pda, false),
            AccountMeta::new(degen_claim_pda, false),
            AccountMeta::new(executor_usdc_ata, false),
            AccountMeta::new(receiver_token_ata, false),
            AccountMeta::new_readonly(token_program, false),
        ],
        data: encode_round_id_ix("finalize_degen_success", round_id),
    };

    let accounts = vec![
        (executor, signer_account()),
        (
            degen_config_pda,
            degen_config_account(&program_id, degen_config_bump, executor),
        ),
        (
            round_pda,
            degen_round_account(&program_id, round_bump, round_id, winner),
        ),
        (
            degen_claim_pda,
            degen_claim_account(
                &program_id,
                degen_claim_bump,
                round_pda,
                winner,
                executor,
                receiver_token_ata,
                token_mint,
                round_id,
            ),
        ),
        (
            executor_usdc_ata,
            token_account(&token_program, Pubkey::new_unique(), executor, 0),
        ),
        (
            receiver_token_ata,
            token_account(&token_program, token_mint, winner, 1_300),
        ),
        (token_program, create_program_account_loader_v3(&token_program)),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let updated_round = result.get_account(&round_pda).expect("round account");
    let round = RoundLifecycleView::read_from_account_data(&updated_round.data).expect("round layout");
    assert_eq!(round.status, ROUND_STATUS_CLAIMED);
    assert_eq!(
        RoundLifecycleView::read_degen_mode_status_from_account_data(&updated_round.data).expect("degen status"),
        DEGEN_MODE_CLAIMED
    );

    let updated_claim = result.get_account(&degen_claim_pda).expect("degen claim account");
    let degen_claim =
        DegenClaimView::read_from_account_data(&updated_claim.data).expect("degen claim layout");
    assert_eq!(degen_claim.status, DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED);
    assert!(degen_claim.claimed_at >= 0);
}

fn encode_upsert_degen_config(executor: Pubkey, fallback_timeout_sec: u32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(8 + 32 + 4);
    bytes.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
    bytes.extend_from_slice(executor.as_ref());
    bytes.extend_from_slice(&fallback_timeout_sec.to_le_bytes());
    bytes
}

fn signer_account() -> Account {
    Account::new(1_000_000_000, 0, &Pubkey::default())
}

fn writable_user_account() -> Account {
    Account::new(500_000, 0, &Pubkey::default())
}

fn config_account(
    program_id: &Pubkey,
    bump: u8,
    admin: Pubkey,
    fee_bps: u16,
    ticket_unit: u64,
    round_duration_sec: i64,
    min_participants: u16,
    min_total_tickets: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Config"));
    ConfigView {
        admin: admin.to_bytes(),
        usdc_mint: Pubkey::new_unique().to_bytes(),
        treasury_usdc_ata: Pubkey::new_unique().to_bytes(),
        fee_bps,
        ticket_unit,
        round_duration_sec: round_duration_sec as u32,
        min_participants,
        min_total_tickets,
        paused: false,
        bump,
        max_deposit_per_user: 10_000_000,
        reserved: [0u8; 24],
    }
    .write_to_account_data(&mut account.data)
    .expect("config write");
    account
}

fn config_account_with_usdc(
    program_id: &Pubkey,
    bump: u8,
    admin: Pubkey,
    usdc_mint: Pubkey,
    fee_bps: u16,
    ticket_unit: u64,
    round_duration_sec: i64,
    min_participants: u16,
    min_total_tickets: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Config"));
    ConfigView {
        admin: admin.to_bytes(),
        usdc_mint: usdc_mint.to_bytes(),
        treasury_usdc_ata: Pubkey::new_unique().to_bytes(),
        fee_bps,
        ticket_unit,
        round_duration_sec: round_duration_sec as u32,
        min_participants,
        min_total_tickets,
        paused: false,
        bump,
        max_deposit_per_user: 10_000_000,
        reserved: [0u8; 24],
    }
    .write_to_account_data(&mut account.data)
    .expect("config write");
    account
}

fn round_account(program_id: &Pubkey, round_id: u64, status: u8) -> Account {
    let (_round_pda, round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], program_id);
    let mut account = Account::new(1_000_000_000, ROUND_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Round"));
    RoundLifecycleView {
        round_id,
        status,
        bump: round_bump,
        start_ts: 100,
        end_ts: 120,
        first_deposit_ts: 101,
        total_usdc: 1_000_000,
        total_tickets: 100,
        participants_count: 2,
    }
    .write_to_account_data(&mut account.data)
    .expect("round write");
    account
}

fn participant_account(
    program_id: &Pubkey,
    bump: u8,
    round: Pubkey,
    user: Pubkey,
) -> Account {
    let mut account = Account::new(222_000, PARTICIPANT_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Participant"));
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
    .write_to_account_data(&mut account.data)
    .expect("participant write");
    account
}

fn degen_config_account(
    program_id: &Pubkey,
    bump: u8,
    executor: Pubkey,
) -> Account {
    degen_config_account_with_timeout(program_id, bump, executor, 300)
}

fn degen_config_account_with_timeout(
    program_id: &Pubkey,
    bump: u8,
    executor: Pubkey,
    timeout: u32,
) -> Account {
    let mut account = Account::new(1_000_000_000, DEGEN_CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("DegenConfig"));
    DegenConfigView {
        executor: executor.to_bytes(),
        fallback_timeout_sec: timeout,
        bump,
        reserved: [0u8; 27],
    }
    .write_to_account_data(&mut account.data)
    .expect("degen config write");
    account
}

fn config_account_with_treasury(
    program_id: &Pubkey,
    bump: u8,
    admin: Pubkey,
    usdc_mint: Pubkey,
    treasury_ata: Pubkey,
    fee_bps: u16,
    max_deposit_per_user: u64,
    round_duration_sec: u32,
    min_participants: u16,
    min_total_tickets: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Config"));
    ConfigView {
        admin: admin.to_bytes(),
        usdc_mint: usdc_mint.to_bytes(),
        treasury_usdc_ata: treasury_ata.to_bytes(),
        fee_bps,
        ticket_unit: 10_000,
        round_duration_sec,
        min_participants,
        min_total_tickets,
        paused: false,
        bump,
        max_deposit_per_user,
        reserved: [0u8; 24],
    }
    .write_to_account_data(&mut account.data)
    .expect("config write");
    account
}

fn degen_round_vrf_ready_account(
    program_id: &Pubkey,
    bump: u8,
    round_id: u64,
    winner: Pubkey,
    vault_ata: Pubkey,
) -> Account {
    let mut account = Account::new(1_000_000_000, ROUND_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Round"));
    RoundLifecycleView {
        round_id,
        status: ROUND_STATUS_SETTLED,
        bump,
        start_ts: 100,
        end_ts: 120,
        first_deposit_ts: 101,
        total_usdc: 1_000_000,
        total_tickets: 100,
        participants_count: 2,
    }
    .write_to_account_data(&mut account.data)
    .expect("round write");
    account.data[48..80].copy_from_slice(&vault_ata.to_bytes());
    RoundLifecycleView::write_winner_to_account_data(&mut account.data, &winner.to_bytes())
        .expect("winner write");
    RoundLifecycleView::write_degen_mode_status_to_account_data(&mut account.data, jackpot_pinocchio_poc::legacy_layouts::DEGEN_MODE_VRF_READY)
        .expect("degen mode write");
    account
}

fn degen_round_fallback_account(
    program_id: &Pubkey,
    bump: u8,
    round_id: u64,
    winner: Pubkey,
    vault_ata: Pubkey,
) -> Account {
    degen_round_vrf_ready_account(program_id, bump, round_id, winner, vault_ata)
}

fn degen_claim_vrf_ready_account(
    program_id: &Pubkey,
    bump: u8,
    round: Pubkey,
    winner: Pubkey,
    round_id: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, DEGEN_CLAIM_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
    DegenClaimView {
        round: round.to_bytes(),
        winner: winner.to_bytes(),
        round_id,
        status: jackpot_pinocchio_poc::legacy_layouts::DEGEN_CLAIM_STATUS_VRF_READY,
        bump,
        selected_candidate_rank: u8::MAX,
        fallback_reason: 0,
        token_index: 0,
        pool_version: 1,
        candidate_window: 10,
        padding0: [0u8; 7],
        requested_at: 777,
        fulfilled_at: 900,
        claimed_at: 0,
        fallback_after_ts: 0,
        payout_raw: 997_500,
        min_out_raw: 0,
        receiver_pre_balance: 0,
        token_mint: [0u8; 32],
        executor: [0u8; 32],
        receiver_token_ata: [0u8; 32],
        randomness: [7u8; 32],
        route_hash: [0u8; 32],
        reserved: [0u8; 32],
    }
    .write_to_account_data(&mut account.data)
    .expect("degen claim write");
    account
}

fn degen_claim_fallback_ready_account(
    program_id: &Pubkey,
    bump: u8,
    round: Pubkey,
    winner: Pubkey,
    round_id: u64,
) -> Account {
    let mut account = degen_claim_vrf_ready_account(program_id, bump, round, winner, round_id);
    let now = 1_700_000_000i64;
    let fallback_after = now - 1;
    account.data[104..112].copy_from_slice(&fallback_after.to_le_bytes());
    account
}

fn degen_round_account(program_id: &Pubkey, bump: u8, round_id: u64, winner: Pubkey) -> Account {
    let mut account = Account::new(1_000_000_000, ROUND_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Round"));
    RoundLifecycleView {
        round_id,
        status: ROUND_STATUS_SETTLED,
        bump,
        start_ts: 100,
        end_ts: 120,
        first_deposit_ts: 101,
        total_usdc: 1_000_000,
        total_tickets: 100,
        participants_count: 2,
    }
    .write_to_account_data(&mut account.data)
    .expect("round write");
    account.data[48..80].copy_from_slice(
        &Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], program_id)
            .0
            .to_bytes(),
    );
    RoundLifecycleView::write_winner_to_account_data(&mut account.data, &winner.to_bytes())
        .expect("winner write");
    RoundLifecycleView::write_degen_mode_status_to_account_data(&mut account.data, DEGEN_MODE_EXECUTING)
        .expect("degen mode write");
    account
}

fn degen_claim_account(
    program_id: &Pubkey,
    bump: u8,
    round: Pubkey,
    winner: Pubkey,
    executor: Pubkey,
    receiver_token_ata: Pubkey,
    token_mint: Pubkey,
    round_id: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, DEGEN_CLAIM_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
    DegenClaimView {
        round: round.to_bytes(),
        winner: winner.to_bytes(),
        round_id,
        status: DEGEN_CLAIM_STATUS_EXECUTING,
        bump,
        selected_candidate_rank: 0,
        fallback_reason: 0,
        token_index: 123,
        pool_version: 1,
        candidate_window: 10,
        padding0: [0u8; 7],
        requested_at: 777,
        fulfilled_at: 900,
        claimed_at: 0,
        fallback_after_ts: 1_200,
        payout_raw: 1_000_000,
        min_out_raw: 1_234,
        receiver_pre_balance: 10,
        token_mint: token_mint.to_bytes(),
        executor: executor.to_bytes(),
        receiver_token_ata: receiver_token_ata.to_bytes(),
        randomness: [7u8; 32],
        route_hash: [9u8; 32],
        reserved: [0u8; 32],
    }
    .write_to_account_data(&mut account.data)
    .expect("degen claim write");
    account
}

fn token_account(
    token_program: &Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, TOKEN_ACCOUNT_WITH_AMOUNT_LEN, token_program);
    account.data[..32].copy_from_slice(&mint.to_bytes());
    account.data[32..64].copy_from_slice(&owner.to_bytes());
    TokenAccountWithAmountView::write_amount_to_account_data(&mut account.data, amount)
        .expect("token amount write");
    account
}

fn encode_update_config(
    fee_bps: u16,
    ticket_unit: u64,
    round_duration_sec: i64,
    min_participants: u16,
    min_total_tickets: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 1 + 2 + 1 + 8 + 1 + 4 + 1 + 2 + 1 + 8 + 1 + 1);
    data.extend_from_slice(&instruction_discriminator("update_config"));
    data.push(1);
    data.extend_from_slice(&fee_bps.to_le_bytes());
    data.push(1);
    data.extend_from_slice(&ticket_unit.to_le_bytes());
    data.push(1);
    data.extend_from_slice(&(round_duration_sec as u32).to_le_bytes());
    data.push(1);
    data.extend_from_slice(&min_participants.to_le_bytes());
    data.push(1);
    data.extend_from_slice(&min_total_tickets.to_le_bytes());
    data.push(0);
    data.push(0);
    data
}

fn encode_init_config(
    usdc_mint: Pubkey,
    treasury_ata: Pubkey,
    fee_bps: u16,
    ticket_unit: u64,
    round_duration_sec: u32,
    min_participants: u16,
    min_total_tickets: u64,
    max_deposit_per_user: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 32 + 32 + 2 + 8 + 4 + 2 + 8 + 8);
    data.extend_from_slice(&instruction_discriminator("init_config"));
    data.extend_from_slice(&usdc_mint.to_bytes());
    data.extend_from_slice(&treasury_ata.to_bytes());
    data.extend_from_slice(&fee_bps.to_le_bytes());
    data.extend_from_slice(&ticket_unit.to_le_bytes());
    data.extend_from_slice(&round_duration_sec.to_le_bytes());
    data.extend_from_slice(&min_participants.to_le_bytes());
    data.extend_from_slice(&min_total_tickets.to_le_bytes());
    data.extend_from_slice(&max_deposit_per_user.to_le_bytes());
    data
}

fn encode_round_id_ix(ix_name: &str, round_id: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&instruction_discriminator(ix_name));
    data.extend_from_slice(&round_id.to_le_bytes());
    data
}
