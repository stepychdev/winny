/// Mollusk CU benchmark: Pinocchio vs Anchor side-by-side (matrix) plus
/// Pinocchio-only init instructions.  Run via `scripts/run_cu_bench.sh`.
///
/// Output:
///   - `target/benches/mx_compute_units.md`  — Pinocchio ↔ Anchor matrix
///   - `target/benches/compute_units.md`      — Pinocchio-only (init ix)
use std::str::FromStr;
use mollusk_svm::Mollusk;
use mollusk_svm::program::create_program_account_loader_v3;
use mollusk_svm_bencher::{MolluskComputeUnitBencher, MolluskComputeUnitMatrixBencher};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use jackpot_pinocchio_poc::{
    anchor_compat::{account_discriminator, instruction_discriminator},
    legacy_layouts::{
        CONFIG_ACCOUNT_LEN, DEGEN_CLAIM_ACCOUNT_LEN, DEGEN_CONFIG_ACCOUNT_LEN,
        PARTICIPANT_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
        ROUND_STATUS_CLAIMED, ROUND_STATUS_OPEN, ROUND_STATUS_SETTLED,
        ConfigView, DegenClaimView, DegenConfigView, ParticipantView,
        RoundLifecycleView,
        DEGEN_MODE_EXECUTING, DEGEN_MODE_VRF_READY,
    },
};

fn main() {
    // Use Anchor devnet declared_id so the Anchor ELF passes its
    // entrypoint program-id check.  Pinocchio doesn't check → works with any.
    let program_id = Pubkey::from_str("4PhNzNQ7XZAPrFmwcBFMe2ZY8ZaQWos8nJjcsjv1CHyh").unwrap();
    let token_program = Pubkey::new_from_array(pinocchio_token::ID.to_bytes());
    let system_program = Pubkey::default();

    let mut mollusk = Mollusk::new(&program_id, "jackpot_pinocchio_poc");
    mollusk.add_program(&token_program, "token_stub_program");

    // ─── init_config ────────────────────────────────────────────────────
    let payer = Pubkey::new_unique();
    let admin = Pubkey::new_unique();
    let usdc_mint = Pubkey::new_from_array([2u8; 32]);
    let treasury_ata = Pubkey::new_from_array([3u8; 32]);
    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);

    let init_config_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: encode_init_config(usdc_mint, treasury_ata, 25, 10_000, 120, 1, 2, 1_000_000),
    };
    let init_config_accounts = vec![
        (payer, signer_account()),
        (admin, signer_account()),
        (config_pda, Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, &program_id)),
        (system_program, Account::new(1_000_000, 0, &Pubkey::default())),
    ];

    // ─── update_config ──────────────────────────────────────────────────
    let update_config_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data: encode_update_config(250, 10_000, 60, 2, 200),
    };
    let update_config_accounts = vec![
        (admin, signer_account()),
        (config_pda, config_account(&program_id, config_bump, admin, 25, 1_000_000, 30, 1, 2)),
    ];

    // ─── upsert_degen_config ────────────────────────────────────────────
    let (degen_config_pda, degen_config_bump) =
        Pubkey::find_program_address(&[b"degen_cfg"], &program_id);
    let upsert_degen_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(degen_config_pda, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: encode_upsert_degen_config(Pubkey::new_from_array([9u8; 32]), 300),
    };
    let upsert_degen_accounts = vec![
        (admin, signer_account()),
        (config_pda, config_account(&program_id, config_bump, admin, 25, 1_000_000, 30, 1, 2)),
        (degen_config_pda, degen_config_account_with_timeout(&program_id, degen_config_bump, Pubkey::default(), 0)),
        (system_program, Account::new(1_000_000, 0, &Pubkey::default())),
    ];

    // ─── transfer_admin ─────────────────────────────────────────────────
    let new_admin = Pubkey::new_unique();
    let transfer_admin_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data: encode_transfer_admin(new_admin),
    };
    let transfer_admin_accounts = vec![
        (admin, signer_account()),
        (config_pda, config_account(&program_id, config_bump, admin, 25, 1_000_000, 30, 1, 2)),
    ];

    // ─── admin_force_cancel ─────────────────────────────────────────────
    let round_id = 42u64;
    let (round_pda, _round_bump) =
        Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id);
    let force_cancel_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(round_pda, false),
        ],
        data: encode_round_id_ix("admin_force_cancel", round_id),
    };
    let force_cancel_accounts = vec![
        (admin, signer_account()),
        (config_pda, config_account(&program_id, config_bump, admin, 25, 1_000_000, 30, 1, 2)),
        (round_pda, round_account(&program_id, round_id, ROUND_STATUS_OPEN)),
    ];

    // ─── lock_round ─────────────────────────────────────────────────────
    let lock_round_id = 46u64;
    let (lock_round_pda, _) =
        Pubkey::find_program_address(&[b"round", &lock_round_id.to_le_bytes()], &program_id);
    let lock_round_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(payer, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(lock_round_pda, false),
        ],
        data: encode_round_id_ix("lock_round", lock_round_id),
    };
    let lock_round_accounts = vec![
        (payer, signer_account()),
        (config_pda, config_account(&program_id, config_bump, admin, 25, 1_000_000, 30, 1, 2)),
        (lock_round_pda, round_account(&program_id, lock_round_id, ROUND_STATUS_OPEN)),
    ];

    // ─── start_round ────────────────────────────────────────────────────
    let start_round_id = 45u64;
    let (start_round_pda, _) =
        Pubkey::find_program_address(&[b"round", &start_round_id.to_le_bytes()], &program_id);
    let ata_program = Pubkey::new_from_array(pinocchio_associated_token_account::ID.to_bytes());
    let (vault_ata_start, _) = Pubkey::find_program_address(
        &[start_round_pda.as_ref(), token_program.as_ref(), usdc_mint.as_ref()],
        &ata_program,
    );
    let start_round_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(start_round_pda, false),
            AccountMeta::new(vault_ata_start, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new_readonly(ata_program, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(system_program, false),
        ],
        data: encode_round_id_ix("start_round", start_round_id),
    };
    let start_round_accounts = vec![
        (payer, signer_account()),
        (config_pda, config_account_with_usdc(&program_id, config_bump, payer, usdc_mint, 25, 1_000_000, 30, 1, 2)),
        (start_round_pda, Account::new(1_000_000_000, ROUND_ACCOUNT_LEN, &program_id)),
        (vault_ata_start, token_account(&token_program, usdc_mint, start_round_pda, 0)),
        (usdc_mint, Account::new(1_000_000_000, 0, &token_program)),
        (ata_program, Account::new(1_000_000, 0, &Pubkey::default())),
        (token_program, Account::new(1_000_000, 0, &Pubkey::default())),
        (system_program, Account::new(1_000_000, 0, &Pubkey::default())),
    ];

    // ─── close_participant ──────────────────────────────────────────────
    let close_round_id = 43u64;
    let user = Pubkey::new_unique();
    let (close_round_pda, _) =
        Pubkey::find_program_address(&[b"round", &close_round_id.to_le_bytes()], &program_id);
    let (participant_pda, participant_bump) =
        Pubkey::find_program_address(&[b"p", close_round_pda.as_ref(), user.as_ref()], &program_id);
    let close_participant_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(user, false),
            AccountMeta::new_readonly(close_round_pda, false),
            AccountMeta::new(participant_pda, false),
        ],
        data: encode_round_id_ix("close_participant", close_round_id),
    };
    let close_participant_accounts = vec![
        (payer, signer_account()),
        (user, writable_user_account()),
        (close_round_pda, round_account(&program_id, close_round_id, ROUND_STATUS_CLAIMED)),
        (participant_pda, participant_account(&program_id, participant_bump, close_round_pda, user)),
    ];

    // ─── begin_degen_execution ──────────────────────────────────────────
    let degen_round_id = 44u64;
    let executor = Pubkey::new_unique();
    let winner = Pubkey::new_unique();
    let (degen_round_pda, degen_round_bump) =
        Pubkey::find_program_address(&[b"round", &degen_round_id.to_le_bytes()], &program_id);
    let (degen_claim_pda, degen_claim_bump) = Pubkey::find_program_address(
        &[b"degen_claim", &degen_round_id.to_le_bytes(), winner.as_ref()],
        &program_id,
    );
    let token_index = jackpot_pinocchio_poc::degen_pool_compat::derive_degen_candidate_index_at_rank(&[7u8; 32], 1, 0);
    let token_mint_bytes = jackpot_pinocchio_poc::degen_pool_compat::degen_token_mint_by_index(token_index).unwrap();
    let token_mint = Pubkey::new_from_array(token_mint_bytes);
    let vault_ata = Pubkey::new_unique();
    let executor_usdc_ata = Pubkey::new_unique();
    let treasury_usdc_ata = Pubkey::new_unique();
    let receiver_token_ata = Pubkey::new_unique();

    let mut begin_degen_data = Vec::with_capacity(61);
    begin_degen_data.extend_from_slice(&instruction_discriminator("begin_degen_execution"));
    begin_degen_data.extend_from_slice(&degen_round_id.to_le_bytes());
    begin_degen_data.push(0); // candidate_rank
    begin_degen_data.extend_from_slice(&token_index.to_le_bytes());
    begin_degen_data.extend_from_slice(&777u64.to_le_bytes());
    begin_degen_data.extend_from_slice(&[33u8; 32]);

    let begin_degen_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(executor, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(degen_config_pda, false),
            AccountMeta::new(degen_round_pda, false),
            AccountMeta::new(degen_claim_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(executor_usdc_ata, false),
            AccountMeta::new(treasury_usdc_ata, false),
            AccountMeta::new_readonly(token_mint, false),
            AccountMeta::new(receiver_token_ata, false),
            AccountMeta::new_readonly(token_program, false),
        ],
        data: begin_degen_data,
    };
    let begin_degen_accounts = vec![
        (executor, signer_account()),
        (config_pda, config_account_with_treasury(&program_id, config_bump, executor, usdc_mint, treasury_usdc_ata, 25, 10_000_000, 30, 1, 2)),
        (degen_config_pda, degen_config_account(&program_id, degen_config_bump, executor)),
        (degen_round_pda, degen_round_vrf_ready_account(&program_id, degen_round_bump, degen_round_id, winner, vault_ata)),
        (degen_claim_pda, degen_claim_vrf_ready_account(&program_id, degen_claim_bump, degen_round_pda, winner, degen_round_id)),
        (vault_ata, token_account(&token_program, usdc_mint, degen_round_pda, 1_000_000)),
        (executor_usdc_ata, token_account(&token_program, usdc_mint, executor, 0)),
        (treasury_usdc_ata, token_account(&token_program, usdc_mint, Pubkey::new_unique(), 0)),
        (token_mint, Account::new(1_000_000, 0, &token_program)),
        (receiver_token_ata, token_account(&token_program, token_mint, winner, 500)),
        (token_program, create_program_account_loader_v3(&token_program)),
    ];

    // ─── claim_degen_fallback ───────────────────────────────────────────
    let fb_round_id = 45u64;
    let fb_winner = Pubkey::new_unique();
    let (fb_config_pda, fb_config_bump) = Pubkey::find_program_address(&[b"cfg"], &program_id);
    let (fb_round_pda, fb_round_bump) =
        Pubkey::find_program_address(&[b"round", &fb_round_id.to_le_bytes()], &program_id);
    let (fb_claim_pda, fb_claim_bump) = Pubkey::find_program_address(
        &[b"degen_claim", &fb_round_id.to_le_bytes(), fb_winner.as_ref()],
        &program_id,
    );
    let fb_vault = Pubkey::new_unique();
    let fb_winner_ata = Pubkey::new_unique();
    let fb_treasury = Pubkey::new_unique();

    let mut fb_data = Vec::with_capacity(17);
    fb_data.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
    fb_data.extend_from_slice(&fb_round_id.to_le_bytes());
    fb_data.push(9); // fallback_reason

    let claim_fallback_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(fb_winner, true),
            AccountMeta::new_readonly(fb_config_pda, false),
            AccountMeta::new(fb_round_pda, false),
            AccountMeta::new(fb_claim_pda, false),
            AccountMeta::new(fb_vault, false),
            AccountMeta::new(fb_winner_ata, false),
            AccountMeta::new(fb_treasury, false),
            AccountMeta::new_readonly(token_program, false),
        ],
        data: fb_data,
    };
    // Note: fb_config_pda == config_pda since seeds are the same; we re-derive to be explicit.
    let claim_fallback_accounts = vec![
        (fb_winner, signer_account()),
        (fb_config_pda, config_account_with_treasury(&program_id, fb_config_bump, fb_winner, usdc_mint, fb_treasury, 25, 1_000_000, 30, 1, 2)),
        (fb_round_pda, degen_round_fallback_account(&program_id, fb_round_bump, fb_round_id, fb_winner, fb_vault)),
        (fb_claim_pda, degen_claim_fallback_ready_account(&program_id, fb_claim_bump, fb_round_pda, fb_winner, fb_round_id)),
        (fb_vault, token_account(&token_program, usdc_mint, fb_round_pda, 1_000_000)),
        (fb_winner_ata, token_account(&token_program, usdc_mint, fb_winner, 0)),
        (fb_treasury, token_account(&token_program, usdc_mint, Pubkey::new_unique(), 0)),
        (token_program, create_program_account_loader_v3(&token_program)),
    ];

    // ─── finalize_degen_success ─────────────────────────────────────────
    let fin_round_id = 44u64;
    let fin_executor = Pubkey::new_unique();
    let fin_winner = Pubkey::new_unique();
    let (fin_degen_cfg, fin_degen_cfg_bump) =
        Pubkey::find_program_address(&[b"degen_cfg"], &program_id);
    let (fin_round_pda, fin_round_bump) =
        Pubkey::find_program_address(&[b"round", &fin_round_id.to_le_bytes()], &program_id);
    let (fin_claim_pda, fin_claim_bump) = Pubkey::find_program_address(
        &[b"degen_claim", &fin_round_id.to_le_bytes(), fin_winner.as_ref()],
        &program_id,
    );
    let fin_token_mint = Pubkey::new_unique();
    let fin_receiver_ata = Pubkey::new_unique();
    let fin_executor_ata = Pubkey::new_unique();

    let finalize_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(fin_executor, true),
            AccountMeta::new_readonly(fin_degen_cfg, false),
            AccountMeta::new(fin_round_pda, false),
            AccountMeta::new(fin_claim_pda, false),
            AccountMeta::new(fin_executor_ata, false),
            AccountMeta::new(fin_receiver_ata, false),
            AccountMeta::new_readonly(token_program, false),
        ],
        data: encode_round_id_ix("finalize_degen_success", fin_round_id),
    };
    let finalize_accounts = vec![
        (fin_executor, signer_account()),
        (fin_degen_cfg, degen_config_account(&program_id, fin_degen_cfg_bump, fin_executor)),
        (fin_round_pda, degen_round_account(&program_id, fin_round_bump, fin_round_id, fin_winner)),
        (fin_claim_pda, degen_claim_account(&program_id, fin_claim_bump, fin_round_pda, fin_winner, fin_executor, fin_receiver_ata, fin_token_mint, fin_round_id)),
        (fin_executor_ata, token_account(&token_program, Pubkey::new_unique(), fin_executor, 0)),
        (fin_receiver_ata, token_account(&token_program, fin_token_mint, fin_winner, 1_300)),
        (token_program, create_program_account_loader_v3(&token_program)),
    ];

    // ═══════════════════════════════════════════════════════════════════
    // 1. MATRIX BENCH — Pinocchio vs Anchor (non-CPI instructions)
    //    CPI-heavy instructions (deposit, cancel_round, claim_refund,
    //    claim, auto_claim, close_round, begin_degen_execution,
    //    claim_degen_fallback) are excluded because:
    //      a) Anchor and Pinocchio have different account ordering for
    //         optional accounts (vrf_payer_authority/vrf_payer_usdc_ata)
    //      b) Anchor's #[account(init)] needs real system-program CPI
    //      c) Anchor's Account<Mint> needs 82-byte SPL Mint layout
    //    VRF instructions are excluded because they CPI to Switchboard.
    // ═══════════════════════════════════════════════════════════════════

    // Set clock for lock_round (requires now >= round.end_ts=120)
    mollusk.sysvars.clock.unix_timestamp = 200;

    MolluskComputeUnitMatrixBencher::new(&mut mollusk)
        .programs(&["jackpot_pinocchio_poc", "jackpot"])
        .bench(("update_config", &update_config_ix, &update_config_accounts))
        .bench(("transfer_admin", &transfer_admin_ix, &transfer_admin_accounts))
        .bench(("admin_force_cancel", &force_cancel_ix, &force_cancel_accounts))
        .bench(("lock_round", &lock_round_ix, &lock_round_accounts))
        .bench(("close_participant", &close_participant_ix, &close_participant_accounts))
        .bench(("finalize_degen_success", &finalize_ix, &finalize_accounts))
        .must_pass(true)
        .out_dir("../target/benches")
        .execute();

    // ═══════════════════════════════════════════════════════════════════
    // 2. PINOCCHIO-ONLY — all 9 instructions (includes init & CPI ix
    //    that need Pinocchio-specific mock account layouts)
    // ═══════════════════════════════════════════════════════════════════
    let mut mollusk_p = Mollusk::new(&program_id, "jackpot_pinocchio_poc");
    mollusk_p.add_program(&token_program, "token_stub_program");
    MolluskComputeUnitBencher::new(mollusk_p)
        .bench(("init_config", &init_config_ix, &init_config_accounts))
        .bench(("update_config", &update_config_ix, &update_config_accounts))
        .bench(("upsert_degen_config", &upsert_degen_ix, &upsert_degen_accounts))
        .bench(("admin_force_cancel", &force_cancel_ix, &force_cancel_accounts))
        .bench(("start_round", &start_round_ix, &start_round_accounts))
        .bench(("close_participant", &close_participant_ix, &close_participant_accounts))
        .bench(("begin_degen_execution", &begin_degen_ix, &begin_degen_accounts))
        .bench(("claim_degen_fallback", &claim_fallback_ix, &claim_fallback_accounts))
        .bench(("finalize_degen_success", &finalize_ix, &finalize_accounts))
        .must_pass(true)
        .out_dir("../target/benches")
        .execute();
}

// ─── Helper functions (same as mollusk_smoke.rs) ────────────────────────────

fn signer_account() -> Account {
    Account::new(1_000_000_000, 0, &Pubkey::default())
}

fn writable_user_account() -> Account {
    Account::new(500_000, 0, &Pubkey::default())
}

fn config_account(
    program_id: &Pubkey, bump: u8, admin: Pubkey,
    fee_bps: u16, ticket_unit: u64, round_duration_sec: i64,
    min_participants: u16, min_total_tickets: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Config"));
    ConfigView {
        admin: admin.to_bytes(), usdc_mint: Pubkey::new_unique().to_bytes(),
        treasury_usdc_ata: Pubkey::new_unique().to_bytes(), fee_bps, ticket_unit,
        round_duration_sec: round_duration_sec as u32, min_participants, min_total_tickets,
        paused: false, bump, max_deposit_per_user: 10_000_000, reserved: [0u8; 24],
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn config_account_with_usdc(
    program_id: &Pubkey, bump: u8, admin: Pubkey, usdc_mint: Pubkey,
    fee_bps: u16, ticket_unit: u64, round_duration_sec: i64,
    min_participants: u16, min_total_tickets: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Config"));
    ConfigView {
        admin: admin.to_bytes(), usdc_mint: usdc_mint.to_bytes(),
        treasury_usdc_ata: Pubkey::new_unique().to_bytes(), fee_bps, ticket_unit,
        round_duration_sec: round_duration_sec as u32, min_participants, min_total_tickets,
        paused: false, bump, max_deposit_per_user: 10_000_000, reserved: [0u8; 24],
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn config_account_with_treasury(
    program_id: &Pubkey, bump: u8, admin: Pubkey, usdc_mint: Pubkey,
    treasury_ata: Pubkey, fee_bps: u16, max_deposit_per_user: u64,
    round_duration_sec: u32, min_participants: u16, min_total_tickets: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Config"));
    ConfigView {
        admin: admin.to_bytes(), usdc_mint: usdc_mint.to_bytes(),
        treasury_usdc_ata: treasury_ata.to_bytes(), fee_bps, ticket_unit: 10_000,
        round_duration_sec, min_participants, min_total_tickets,
        paused: false, bump, max_deposit_per_user, reserved: [0u8; 24],
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn round_account(program_id: &Pubkey, round_id: u64, status: u8) -> Account {
    let (_, round_bump) = Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], program_id);
    let mut account = Account::new(1_000_000_000, ROUND_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Round"));
    RoundLifecycleView {
        round_id, status, bump: round_bump, start_ts: 100, end_ts: 120,
        first_deposit_ts: 101, total_usdc: 1_000_000, total_tickets: 100, participants_count: 2,
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn participant_account(program_id: &Pubkey, bump: u8, round: Pubkey, user: Pubkey) -> Account {
    let mut account = Account::new(222_000, PARTICIPANT_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Participant"));
    ParticipantView {
        round: round.to_bytes(), user: user.to_bytes(), index: 1, bump,
        tickets_total: 100, usdc_total: 1_000_000, deposits_count: 1, reserved: [0u8; 16],
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn degen_config_account(program_id: &Pubkey, bump: u8, executor: Pubkey) -> Account {
    degen_config_account_with_timeout(program_id, bump, executor, 300)
}

fn degen_config_account_with_timeout(program_id: &Pubkey, bump: u8, executor: Pubkey, timeout: u32) -> Account {
    let mut account = Account::new(1_000_000_000, DEGEN_CONFIG_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("DegenConfig"));
    DegenConfigView {
        executor: executor.to_bytes(), fallback_timeout_sec: timeout, bump, reserved: [0u8; 27],
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn degen_round_vrf_ready_account(program_id: &Pubkey, bump: u8, round_id: u64, winner: Pubkey, vault_ata: Pubkey) -> Account {
    let mut account = Account::new(1_000_000_000, ROUND_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("Round"));
    RoundLifecycleView {
        round_id, status: ROUND_STATUS_SETTLED, bump, start_ts: 100, end_ts: 120,
        first_deposit_ts: 101, total_usdc: 1_000_000, total_tickets: 100, participants_count: 2,
    }.write_to_account_data(&mut account.data).unwrap();
    account.data[48..80].copy_from_slice(&vault_ata.to_bytes());
    RoundLifecycleView::write_winner_to_account_data(&mut account.data, &winner.to_bytes()).unwrap();
    RoundLifecycleView::write_degen_mode_status_to_account_data(&mut account.data, DEGEN_MODE_VRF_READY).unwrap();
    account
}

fn degen_round_fallback_account(program_id: &Pubkey, bump: u8, round_id: u64, winner: Pubkey, vault_ata: Pubkey) -> Account {
    degen_round_vrf_ready_account(program_id, bump, round_id, winner, vault_ata)
}

fn degen_claim_vrf_ready_account(program_id: &Pubkey, bump: u8, round: Pubkey, winner: Pubkey, round_id: u64) -> Account {
    let mut account = Account::new(1_000_000_000, DEGEN_CLAIM_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
    DegenClaimView {
        round: round.to_bytes(), winner: winner.to_bytes(), round_id,
        status: jackpot_pinocchio_poc::legacy_layouts::DEGEN_CLAIM_STATUS_VRF_READY,
        bump, selected_candidate_rank: u8::MAX, fallback_reason: 0, token_index: 0,
        pool_version: 1, candidate_window: 10, padding0: [0u8; 7],
        requested_at: 777, fulfilled_at: 900, claimed_at: 0, fallback_after_ts: 0,
        payout_raw: 997_500, min_out_raw: 0, receiver_pre_balance: 0,
        token_mint: [0u8; 32], executor: [0u8; 32], receiver_token_ata: [0u8; 32],
        randomness: [7u8; 32], route_hash: [0u8; 32], reserved: [0u8; 32],
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn degen_claim_fallback_ready_account(program_id: &Pubkey, bump: u8, round: Pubkey, winner: Pubkey, round_id: u64) -> Account {
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
        round_id, status: ROUND_STATUS_SETTLED, bump, start_ts: 100, end_ts: 120,
        first_deposit_ts: 101, total_usdc: 1_000_000, total_tickets: 100, participants_count: 2,
    }.write_to_account_data(&mut account.data).unwrap();
    account.data[48..80].copy_from_slice(
        &Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], program_id).0.to_bytes(),
    );
    RoundLifecycleView::write_winner_to_account_data(&mut account.data, &winner.to_bytes()).unwrap();
    RoundLifecycleView::write_degen_mode_status_to_account_data(&mut account.data, DEGEN_MODE_EXECUTING).unwrap();
    account
}

fn degen_claim_account(
    program_id: &Pubkey, bump: u8, round: Pubkey, winner: Pubkey,
    executor: Pubkey, receiver_token_ata: Pubkey, token_mint: Pubkey, round_id: u64,
) -> Account {
    let mut account = Account::new(1_000_000_000, DEGEN_CLAIM_ACCOUNT_LEN, program_id);
    account.data[..8].copy_from_slice(&account_discriminator("DegenClaim"));
    DegenClaimView {
        round: round.to_bytes(), winner: winner.to_bytes(), round_id,
        status: jackpot_pinocchio_poc::legacy_layouts::DEGEN_CLAIM_STATUS_EXECUTING,
        bump, selected_candidate_rank: 0, fallback_reason: 0, token_index: 123,
        pool_version: 1, candidate_window: 10, padding0: [0u8; 7],
        requested_at: 777, fulfilled_at: 900, claimed_at: 0, fallback_after_ts: 1_200,
        payout_raw: 1_000_000, min_out_raw: 1_234, receiver_pre_balance: 10,
        token_mint: token_mint.to_bytes(), executor: executor.to_bytes(),
        receiver_token_ata: receiver_token_ata.to_bytes(),
        randomness: [7u8; 32], route_hash: [9u8; 32], reserved: [0u8; 32],
    }.write_to_account_data(&mut account.data).unwrap();
    account
}

fn token_account(token_program: &Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    // Full 165-byte SPL Token Account layout so Anchor's TokenAccount::unpack() works.
    // Pinocchio and the token stub only read the first 72 bytes, so this is safe.
    const SPL_TOKEN_ACCOUNT_LEN: usize = 165;
    let mut account = Account::new(1_000_000_000, SPL_TOKEN_ACCOUNT_LEN, token_program);
    account.data[..32].copy_from_slice(&mint.to_bytes());
    account.data[32..64].copy_from_slice(&owner.to_bytes());
    account.data[64..72].copy_from_slice(&amount.to_le_bytes());
    account.data[108] = 1; // AccountState::Initialized
    account
}

fn encode_init_config(
    usdc_mint: Pubkey, treasury_ata: Pubkey, fee_bps: u16, ticket_unit: u64,
    round_duration_sec: u32, min_participants: u16, min_total_tickets: u64, max_deposit_per_user: u64,
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

fn encode_update_config(
    fee_bps: u16, ticket_unit: u64, round_duration_sec: i64,
    min_participants: u16, min_total_tickets: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(&instruction_discriminator("update_config"));
    data.push(1); data.extend_from_slice(&fee_bps.to_le_bytes());
    data.push(1); data.extend_from_slice(&ticket_unit.to_le_bytes());
    data.push(1); data.extend_from_slice(&(round_duration_sec as u32).to_le_bytes());
    data.push(1); data.extend_from_slice(&min_participants.to_le_bytes());
    data.push(1); data.extend_from_slice(&min_total_tickets.to_le_bytes());
    data.push(0); data.push(0);
    data
}

fn encode_upsert_degen_config(executor: Pubkey, fallback_timeout_sec: u32) -> Vec<u8> {
    let mut data = Vec::with_capacity(44);
    data.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
    data.extend_from_slice(executor.as_ref());
    data.extend_from_slice(&fallback_timeout_sec.to_le_bytes());
    data
}

fn encode_transfer_admin(new_admin: Pubkey) -> Vec<u8> {
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(&instruction_discriminator("transfer_admin"));
    data.extend_from_slice(&new_admin.to_bytes());
    data
}

fn encode_round_id_ix(ix_name: &str, round_id: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&instruction_discriminator(ix_name));
    data.extend_from_slice(&round_id.to_le_bytes());
    data
}
