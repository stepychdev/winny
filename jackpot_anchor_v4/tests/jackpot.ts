import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Jackpot } from "../target/types/jackpot";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

describe("jackpot", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Jackpot as Program<Jackpot>;
  const admin = provider.wallet as anchor.Wallet;

  // Test keypairs
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();

  // Token accounts
  let usdcMint: PublicKey;
  let treasuryUsdcAta: PublicKey;
  let user1UsdcAta: PublicKey;
  let user2UsdcAta: PublicKey;

  // PDAs
  let configPda: PublicKey;

  // Test params
  const TICKET_UNIT = new BN(1_000_000); // 1 USDC = 1 ticket (6 decimals)
  const FEE_BPS = 500; // 5%
  const ROUND_DURATION = 5; // 5 seconds for fast tests
  const MIN_PARTICIPANTS = 2;
  const MIN_TOTAL_TICKETS = new BN(2);
  const ROUND_ID = new BN(1);
  const DEPOSIT_AMOUNT = new BN(10_000_000); // 10 USDC

  // Round account size: 8 (discriminator) + sizeof(Round)
  // Computed from state.rs — must match Round::SPACE
  const ROUND_SPACE =
    8 + // discriminator
    8 + // round_id
    1 + // status
    1 + // bump
    6 + // _padding
    8 + // start_ts
    8 + // end_ts
    8 + // first_deposit_ts
    32 + // vault_usdc_ata
    8 + // total_usdc
    8 + // total_tickets
    2 + // participants_count
    6 + // _padding2
    32 + // randomness
    8 + // winning_ticket
    32 + // winner
    512 * 32 + // participants [[u8;32]; 512]
    513 * 8 + // bit (FenwickTree.data)
    64; // reserved

  function getRoundPda(roundId: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("round"), roundId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  function getParticipantPda(
    roundKey: PublicKey,
    userKey: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("p"), roundKey.toBuffer(), userKey.toBuffer()],
      program.programId
    );
  }

  /**
   * Pre-create a Round PDA account via SystemProgram.createAccount.
   * Needed because Round is ~21KB — exceeds 10KB CPI init limit.
   */
  async function createRoundAccount(roundId: BN): Promise<void> {
    const [roundPda, roundBump] = getRoundPda(roundId);
    const seeds = [
      Buffer.from("round"),
      roundId.toArrayLike(Buffer, "le", 8),
      Buffer.from([roundBump]),
    ];

    const lamports =
      await provider.connection.getMinimumBalanceForRentExemption(ROUND_SPACE);

    const ix = SystemProgram.createAccountWithSeed({
      fromPubkey: admin.publicKey,
      newAccountPubkey: roundPda,
      basePubkey: admin.publicKey, // unused for PDA
      seed: "", // unused for PDA
      lamports,
      space: ROUND_SPACE,
      programId: program.programId,
    });

    // For PDA accounts, we need to use createAccount with program address
    // Actually, for PDA we use SystemProgram.createAccount via a custom IX
    // The simplest way is to use anchor's `zero` constraint which expects
    // the account to already exist with correct space, owned by the program, and all zeros.
    // We create it by calling SystemProgram.createAccount directly:
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: roundPda,
      lamports,
      space: ROUND_SPACE,
      programId: program.programId,
    });

    // But PDA accounts can't sign... We need to use a different approach.
    // The pattern for large zero-copy PDA accounts:
    // 1. Use `allocate` + `assign` via CPI from the program, or
    // 2. Use anchor's `init` with `realloc` pattern
    //
    // Actually the simplest approach: use the program itself to create the account
    // by passing enough lamports and letting it use invoke_signed.
    // But our program doesn't have that logic...
    //
    // The correct fix: change the constraint back to `init` but increase compute budget
    // and use `account::MAX_SIZE_OVERRIDE` or split into 2 transactions.
    //
    // For Solana 1.18+, the 10KB CPI limit was raised in newer versions.
    // Let's check our validator version.
    // Actually, this limit is ONLY for realloc, not for create_account.
    // The limit for SystemProgram.createAccount in CPI is actually the max account size (10MB).
    // The 10240 limit is specifically for REALLOC.
    //
    // Hmm, but the error said "Account data size realloc limited to 10240 in inner instructions"
    // This means Anchor is using realloc instead of create_account.
    // With the `zero` constraint, the account must be pre-created.
    // Since it's a PDA, only the program can create it.
    //
    // SOLUTION: We need to create the account in a separate instruction
    // that uses invoke_signed with SystemProgram.createAccount.
    // For now, let's test with a non-PDA approach or use allocate.
    throw new Error("PDA accounts can't be pre-created by the client");
  }

  before("Setup: create USDC mint, ATAs, fund users", async () => {
    // Airdrop SOL to test users
    for (const user of [user1, user2]) {
      const sig = await provider.connection.requestAirdrop(
        user.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Find config PDA
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("cfg")],
      program.programId
    );

    // Create USDC mint (admin is mint authority)
    usdcMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      6
    );

    // Create treasury ATA
    treasuryUsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      usdcMint,
      admin.publicKey
    );

    // Create user ATAs and mint USDC
    user1UsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      usdcMint,
      user1.publicKey
    );
    user2UsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      usdcMint,
      user2.publicKey
    );

    // Mint 100 USDC to each user
    const mintAmount = 100_000_000;
    await mintTo(
      provider.connection,
      (admin as any).payer,
      usdcMint,
      user1UsdcAta,
      admin.publicKey,
      mintAmount
    );
    await mintTo(
      provider.connection,
      (admin as any).payer,
      usdcMint,
      user2UsdcAta,
      admin.publicKey,
      mintAmount
    );

    console.log("USDC Mint:", usdcMint.toBase58());
    console.log("User1:", user1.publicKey.toBase58());
    console.log("User2:", user2.publicKey.toBase58());
  });

  // =========================================================================
  // init_config
  // =========================================================================

  it("init_config — creates config PDA with correct params", async () => {
    await program.methods
      .initConfig({
        usdcMint,
        treasuryUsdcAta,
        feeBps: FEE_BPS,
        ticketUnit: TICKET_UNIT,
        roundDurationSec: ROUND_DURATION,
        minParticipants: MIN_PARTICIPANTS,
        minTotalTickets: MIN_TOTAL_TICKETS,
        maxDepositPerUser: new BN(0), // 0 = unlimited
      })
      .accounts({
        payer: admin.publicKey,
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.config.fetch(configPda);
    assert.ok(cfg.admin.equals(admin.publicKey));
    assert.ok(cfg.usdcMint.equals(usdcMint));
    assert.ok(cfg.treasuryUsdcAta.equals(treasuryUsdcAta));
    assert.equal(cfg.feeBps, FEE_BPS);
    assert.ok(cfg.ticketUnit.eq(TICKET_UNIT));
    assert.equal(cfg.roundDurationSec, ROUND_DURATION);
    assert.equal(cfg.minParticipants, MIN_PARTICIPANTS);
    assert.ok(cfg.minTotalTickets.eq(MIN_TOTAL_TICKETS));
    assert.equal(cfg.paused, false);
    console.log("  Config bump:", cfg.bump);
  });

  // =========================================================================
  // start_round
  // =========================================================================

  let roundPda: PublicKey;
  let roundBump: number;
  let vaultUsdcAta: PublicKey;

  it("start_round — creates round PDA and vault ATA", async () => {
    [roundPda, roundBump] = getRoundPda(ROUND_ID);
    vaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);

    await program.methods
      .startRound(ROUND_ID)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: roundPda,
        vaultUsdcAta,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify round account exists
    const roundAcct = await provider.connection.getAccountInfo(roundPda);
    assert.ok(roundAcct !== null, "Round account should exist");
    assert.ok(
      roundAcct.owner.equals(program.programId),
      "Round owned by program"
    );

    // Verify vault ATA exists and owned by round PDA
    const vault = await getAccount(provider.connection, vaultUsdcAta);
    assert.ok(vault.owner.equals(roundPda));
    assert.equal(Number(vault.amount), 0);

    console.log("  Round PDA:", roundPda.toBase58());
    console.log("  Vault ATA:", vaultUsdcAta.toBase58());
  });

  // =========================================================================
  // deposit_any — user1
  // =========================================================================

  it("deposit_any — user1 deposits 10 USDC, gets 10 tickets", async () => {
    const [participantPda] = getParticipantPda(roundPda, user1.publicKey);

    const userAcct = await getAccount(provider.connection, user1UsdcAta);
    const balanceBefore = new BN(userAcct.amount.toString());

    // For direct USDC deposit: set usdc_balance_before = balance - deposit
    // Contract: delta = current_balance - usdc_balance_before >= min_out
    const usdcBalanceBefore = balanceBefore.sub(DEPOSIT_AMOUNT);
    const minOut = DEPOSIT_AMOUNT;

    await program.methods
      .depositAny(ROUND_ID, usdcBalanceBefore, minOut)
      .accounts({
        user: user1.publicKey,
        config: configPda,
        round: roundPda,
        participant: participantPda,
        userUsdcAta: user1UsdcAta,
        vaultUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // Verify participant
    const participant = await program.account.participant.fetch(participantPda);
    assert.ok(participant.round.equals(roundPda));
    assert.ok(participant.user.equals(user1.publicKey));
    assert.equal(participant.index, 1);
    assert.ok(participant.ticketsTotal.eq(new BN(10))); // 10M / 1M = 10 tickets
    assert.ok(participant.usdcTotal.eq(DEPOSIT_AMOUNT));
    assert.equal(participant.depositsCount, 1);

    // Verify vault received USDC
    const vaultAcct = await getAccount(provider.connection, vaultUsdcAta);
    assert.equal(Number(vaultAcct.amount), DEPOSIT_AMOUNT.toNumber());

    // Verify user balance decreased
    const userAfter = await getAccount(provider.connection, user1UsdcAta);
    assert.equal(
      Number(userAfter.amount),
      balanceBefore.sub(DEPOSIT_AMOUNT).toNumber()
    );

    console.log("  User1: 10 USDC deposited, 10 tickets");
  });

  // =========================================================================
  // deposit_any — user2
  // =========================================================================

  it("deposit_any — user2 deposits 10 USDC, gets 10 tickets", async () => {
    const [participantPda] = getParticipantPda(roundPda, user2.publicKey);

    const userAcct = await getAccount(provider.connection, user2UsdcAta);
    const balanceBefore = new BN(userAcct.amount.toString());
    const usdcBalanceBefore = balanceBefore.sub(DEPOSIT_AMOUNT);
    const minOut = DEPOSIT_AMOUNT;

    await program.methods
      .depositAny(ROUND_ID, usdcBalanceBefore, minOut)
      .accounts({
        user: user2.publicKey,
        config: configPda,
        round: roundPda,
        participant: participantPda,
        userUsdcAta: user2UsdcAta,
        vaultUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    const participant = await program.account.participant.fetch(participantPda);
    assert.equal(participant.index, 2);
    assert.ok(participant.ticketsTotal.eq(new BN(10)));

    // Vault has both deposits
    const vaultAcct = await getAccount(provider.connection, vaultUsdcAta);
    assert.equal(Number(vaultAcct.amount), DEPOSIT_AMOUNT.toNumber() * 2);

    console.log("  User2: 10 USDC deposited. Vault total: 20 USDC");
  });

  // =========================================================================
  // deposit_any — user1 second deposit
  // =========================================================================

  it("deposit_any — user1 second deposit of 5 USDC", async () => {
    const [participantPda] = getParticipantPda(roundPda, user1.publicKey);
    const secondDeposit = new BN(5_000_000);

    const userAcct = await getAccount(provider.connection, user1UsdcAta);
    const balanceBefore = new BN(userAcct.amount.toString());
    const usdcBalanceBefore = balanceBefore.sub(secondDeposit);

    await program.methods
      .depositAny(ROUND_ID, usdcBalanceBefore, secondDeposit)
      .accounts({
        user: user1.publicKey,
        config: configPda,
        round: roundPda,
        participant: participantPda,
        userUsdcAta: user1UsdcAta,
        vaultUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const participant = await program.account.participant.fetch(participantPda);
    assert.equal(participant.index, 1); // same index
    assert.ok(participant.ticketsTotal.eq(new BN(15))); // 10 + 5
    assert.ok(participant.usdcTotal.eq(new BN(15_000_000)));
    assert.equal(participant.depositsCount, 2);

    const vaultAcct = await getAccount(provider.connection, vaultUsdcAta);
    assert.equal(Number(vaultAcct.amount), 25_000_000);

    console.log("  User1 second deposit: 5 USDC. Vault total: 25 USDC");
  });

  // =========================================================================
  // lock_round — should fail before timer expires
  // =========================================================================

  it("lock_round — fails before countdown ends", async () => {
    try {
      await program.methods
        .lockRound(ROUND_ID)
        .accounts({
          caller: admin.publicKey,
          config: configPda,
          round: roundPda,
        })
        .rpc();
      assert.fail("Should have thrown RoundNotEnded");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotEnded") || errStr.includes("0x176b"),
        `Expected RoundNotEnded, got: ${errStr}`
      );
      console.log("  Correctly rejected: countdown not ended");
    }
  });

  // =========================================================================
  // lock_round — success after timer
  // =========================================================================

  it("lock_round — succeeds after countdown", async () => {
    console.log(`  Waiting ${ROUND_DURATION + 1}s for round timer...`);
    await new Promise((resolve) =>
      setTimeout(resolve, (ROUND_DURATION + 1) * 1000)
    );

    await program.methods
      .lockRound(ROUND_ID)
      .accounts({
        caller: admin.publicKey,
        config: configPda,
        round: roundPda,
      })
      .rpc();

    // Verify round status = Locked (1)
    // Zero-copy: 8-byte discriminator, then round_id(8), status(1)
    const roundAcct = await provider.connection.getAccountInfo(roundPda);
    const status = roundAcct.data[8 + 8]; // discriminator + round_id
    assert.equal(status, 1, "Status should be 1 (Locked)");

    console.log("  Round locked successfully");
  });

  // =========================================================================
  // Negative tests
  // =========================================================================

  it("deposit_any — fails on locked round", async () => {
    const [participantPda] = getParticipantPda(roundPda, user1.publicKey);
    const userAcct = await getAccount(provider.connection, user1UsdcAta);
    const balanceBefore = new BN(userAcct.amount.toString());
    const deposit = new BN(1_000_000);

    try {
      await program.methods
        .depositAny(ROUND_ID, balanceBefore.sub(deposit), deposit)
        .accounts({
          user: user1.publicKey,
          config: configPda,
          round: roundPda,
          participant: participantPda,
          userUsdcAta: user1UsdcAta,
          vaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
      assert.fail("Should have thrown RoundNotOpen");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotOpen") || errStr.includes("0x1770"),
        `Expected RoundNotOpen, got: ${errStr}`
      );
      console.log("  Correctly rejected: deposit on locked round");
    }
  });

  it("lock_round — fails when already locked", async () => {
    try {
      await program.methods
        .lockRound(ROUND_ID)
        .accounts({
          caller: admin.publicKey,
          config: configPda,
          round: roundPda,
        })
        .rpc();
      assert.fail("Should have thrown RoundNotOpen");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotOpen") || errStr.includes("0x1770"),
        `Expected RoundNotOpen, got: ${errStr}`
      );
      console.log("  Correctly rejected: double-lock");
    }
  });

  it("claim — fails when round is not settled", async () => {
    try {
      await program.methods
        .claim(ROUND_ID)
        .accounts({
          winner: user1.publicKey,
          config: configPda,
          round: roundPda,
        vaultUsdcAta,
        winnerUsdcAta: user1UsdcAta,
        treasuryUsdcAta,
        vrfPayerUsdcAta: null,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
        .signers([user1])
        .rpc();
      assert.fail("Should have thrown RoundNotSettled");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotSettled") || errStr.includes("0x1774"),
        `Expected RoundNotSettled, got: ${errStr}`
      );
      console.log("  Correctly rejected: claim on non-settled round");
    }
  });

  // =========================================================================
  // Round 2 — test min_participants validation
  // =========================================================================

  it("lock_round — fails with only 1 participant (min_participants=2)", async () => {
    const roundId2 = new BN(2);
    const [roundPda2] = getRoundPda(roundId2);
    const vaultAta2 = getAssociatedTokenAddressSync(usdcMint, roundPda2, true);

    // Start round 2
    await program.methods
      .startRound(roundId2)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: roundPda2,
        vaultUsdcAta: vaultAta2,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Only user1 deposits
    const [participantPda2] = getParticipantPda(roundPda2, user1.publicKey);
    const userAcct = await getAccount(provider.connection, user1UsdcAta);
    const bal = new BN(userAcct.amount.toString());
    const deposit = new BN(5_000_000);

    await program.methods
      .depositAny(roundId2, bal.sub(deposit), deposit)
      .accounts({
        user: user1.publicKey,
        config: configPda,
        round: roundPda2,
        participant: participantPda2,
        userUsdcAta: user1UsdcAta,
        vaultUsdcAta: vaultAta2,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // Wait for timer
    console.log(`  Waiting ${ROUND_DURATION + 1}s for round 2 timer...`);
    await new Promise((r) => setTimeout(r, (ROUND_DURATION + 1) * 1000));

    // Try to lock — should fail
    try {
      await program.methods
        .lockRound(roundId2)
        .accounts({
          caller: admin.publicKey,
          config: configPda,
          round: roundPda2,
        })
        .rpc();
      assert.fail("Should have thrown NotEnoughParticipants");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("NotEnoughParticipants") || errStr.includes("0x1776"),
        `Expected NotEnoughParticipants, got: ${errStr}`
      );
      console.log("  Correctly rejected: only 1 participant");
    }
  });

  // =========================================================================
  // Round 4 — force cancel -> self-service refunds -> cleanup
  // =========================================================================

  it("force_cancel -> self-service refunds -> close_participant -> close_round", async () => {
    const roundId4 = new BN(4);
    const [roundPda4] = getRoundPda(roundId4);
    const vaultAta4 = getAssociatedTokenAddressSync(usdcMint, roundPda4, true);
    const [participantPda4User1] = getParticipantPda(roundPda4, user1.publicKey);
    const [participantPda4User2] = getParticipantPda(roundPda4, user2.publicKey);

    const user1Before = await getAccount(provider.connection, user1UsdcAta);
    const user2Before = await getAccount(provider.connection, user2UsdcAta);
    const user1Deposit = new BN(3_000_000); // 3 USDC
    const user2Deposit = new BN(7_000_000); // 7 USDC

    // Start round 4
    await program.methods
      .startRound(roundId4)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: roundPda4,
        vaultUsdcAta: vaultAta4,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Deposits from both users
    await program.methods
      .depositAny(
        roundId4,
        new BN(user1Before.amount.toString()).sub(user1Deposit),
        user1Deposit
      )
      .accounts({
        user: user1.publicKey,
        config: configPda,
        round: roundPda4,
        participant: participantPda4User1,
        userUsdcAta: user1UsdcAta,
        vaultUsdcAta: vaultAta4,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    await program.methods
      .depositAny(
        roundId4,
        new BN(user2Before.amount.toString()).sub(user2Deposit),
        user2Deposit
      )
      .accounts({
        user: user2.publicKey,
        config: configPda,
        round: roundPda4,
        participant: participantPda4User2,
        userUsdcAta: user2UsdcAta,
        vaultUsdcAta: vaultAta4,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    // Force-cancel by admin (funds remain in vault for self-refund)
    await program.methods
      .adminForceCancel(roundId4)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: roundPda4,
      })
      .rpc();

    // Verify round status = Cancelled (5)
    const cancelledRoundAcct = await provider.connection.getAccountInfo(roundPda4);
    const cancelledStatus = cancelledRoundAcct.data[8 + 8];
    assert.equal(cancelledStatus, 5, "Status should be 5 (Cancelled)");

    // Guard check: cannot close participant before refund (prevents stuck funds bug)
    try {
      await program.methods
        .closeParticipant(roundId4)
        .accounts({
          payer: admin.publicKey,
          user: user1.publicKey,
          round: roundPda4,
          participant: participantPda4User1,
        })
        .rpc();
      assert.fail("Should have thrown ParticipantNotEmpty");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("ParticipantNotEmpty"),
        `Expected ParticipantNotEmpty, got: ${errStr}`
      );
      console.log("  Correctly rejected: close_participant before refund");
    }

    // Self-service refunds (user signs)
    await program.methods
      .claimRefund(roundId4)
      .accounts({
        user: user1.publicKey,
        config: configPda,
        round: roundPda4,
        participant: participantPda4User1,
        vaultUsdcAta: vaultAta4,
        userUsdcAta: user1UsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();

    await program.methods
      .claimRefund(roundId4)
      .accounts({
        user: user2.publicKey,
        config: configPda,
        round: roundPda4,
        participant: participantPda4User2,
        vaultUsdcAta: vaultAta4,
        userUsdcAta: user2UsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    // Refunds restore user balances to snapshots taken before this round's deposits.
    const user1AfterRefund = await getAccount(provider.connection, user1UsdcAta);
    const user2AfterRefund = await getAccount(provider.connection, user2UsdcAta);
    assert.equal(
      Number(user1AfterRefund.amount),
      Number(user1Before.amount),
      "User1 balance should be restored after refund"
    );
    assert.equal(
      Number(user2AfterRefund.amount),
      Number(user2Before.amount),
      "User2 balance should be restored after refund"
    );

    // Participant accounts should now be zeroed and closable.
    await program.methods
      .closeParticipant(roundId4)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: roundPda4,
        participant: participantPda4User1,
      })
      .rpc();

    await program.methods
      .closeParticipant(roundId4)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: roundPda4,
        participant: participantPda4User2,
      })
      .rpc();

    // Vault should be empty after both refunds, allowing terminal cleanup.
    const vaultAfterRefunds = await getAccount(provider.connection, vaultAta4);
    assert.equal(Number(vaultAfterRefunds.amount), 0, "Vault should be empty");

    await program.methods
      .closeRound(roundId4)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: roundPda4,
        vaultUsdcAta: vaultAta4,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [roundInfo, participant1Info, participant2Info, vaultInfo] =
      await provider.connection.getMultipleAccountsInfo([
        roundPda4,
        participantPda4User1,
        participantPda4User2,
        vaultAta4,
      ]);
    assert.equal(roundInfo, null, "Round account should be closed");
    assert.equal(participant1Info, null, "Participant1 PDA should be closed");
    assert.equal(participant2Info, null, "Participant2 PDA should be closed");
    assert.equal(vaultInfo, null, "Vault ATA should be closed");

    console.log("  Force-cancel refund/cleanup flow completed successfully");
  });

  // =========================================================================
  // mock_settle — settle round 1 using admin mock (bypass VRF)
  // =========================================================================

  it("mock_settle — settles round with deterministic randomness", async () => {
    // Generate deterministic randomness (32 bytes)
    const randomness = Buffer.alloc(32);
    randomness.writeUInt32LE(42, 0); // seed = 42

    await program.methods
      .mockSettle(ROUND_ID, Array.from(randomness))
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: roundPda,
      })
      .rpc();

    // Verify round status = Settled (3)
    const roundAcct = await provider.connection.getAccountInfo(roundPda);
    const status = roundAcct.data[8 + 8]; // discriminator + round_id
    assert.equal(status, 3, "Status should be 3 (Settled)");

    // Read winner from round data:
    // offset: 8(disc) + 8(round_id) + 1(status) + 1(bump) + 6(pad) + 8(start_ts) + 8(end_ts)
    // + 8(first_deposit_ts) + 32(vault) + 8(total_usdc) + 8(total_tickets) + 2(count)
    // + 6(pad2) + 32(randomness) + 8(winning_ticket) = offset of winner
    const winnerOffset = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;
    const winnerBytes = roundAcct.data.slice(winnerOffset, winnerOffset + 32);
    const winner = new PublicKey(winnerBytes);

    // Winner should be either user1 or user2
    const isUser1 = winner.equals(user1.publicKey);
    const isUser2 = winner.equals(user2.publicKey);
    assert.ok(isUser1 || isUser2, "Winner should be user1 or user2");

    console.log("  Round settled! Winner:", winner.toBase58());
    console.log("  Winner is:", isUser1 ? "user1" : "user2");
  });

  // =========================================================================
  // mock_settle — fails on already settled round
  // =========================================================================

  it("mock_settle — fails when round already settled", async () => {
    const randomness = Buffer.alloc(32);
    try {
      await program.methods
        .mockSettle(ROUND_ID, Array.from(randomness))
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          round: roundPda,
        })
        .rpc();
      assert.fail("Should have thrown RoundNotLocked");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotLocked") || errStr.includes("0x1772"),
        `Expected RoundNotLocked, got: ${errStr}`
      );
      console.log("  Correctly rejected: round already settled");
    }
  });

  // =========================================================================
  // claim — happy path: winner claims payout
  // =========================================================================

  it("claim — winner claims payout (95% pot) + treasury gets fee (5%)", async () => {
    // Read round to find the winner
    const roundAcct = await provider.connection.getAccountInfo(roundPda);
    const winnerOffset = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;
    const winnerBytes = roundAcct.data.slice(winnerOffset, winnerOffset + 32);
    const winner = new PublicKey(winnerBytes);

    const isUser1 = winner.equals(user1.publicKey);
    const winnerKeypair = isUser1 ? user1 : user2;
    const winnerUsdcAta = isUser1 ? user1UsdcAta : user2UsdcAta;

    // Record balances before claim
    const winnerBefore = await getAccount(provider.connection, winnerUsdcAta);
    const treasuryBefore = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultBefore = await getAccount(provider.connection, vaultUsdcAta);

    const totalPot = Number(vaultBefore.amount);
    const expectedFee = Math.floor(totalPot * FEE_BPS / 10000); // 5%
    const expectedPayout = totalPot - expectedFee; // 95%

    console.log(`  Total pot: ${totalPot / 1e6} USDC`);
    console.log(`  Expected fee: ${expectedFee / 1e6} USDC`);
    console.log(`  Expected payout: ${expectedPayout / 1e6} USDC`);

    await program.methods
      .claim(ROUND_ID)
      .accounts({
        winner: winnerKeypair.publicKey,
        config: configPda,
        round: roundPda,
        vaultUsdcAta,
        winnerUsdcAta,
        treasuryUsdcAta,
        vrfPayerUsdcAta: null,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([winnerKeypair])
      .rpc();

    // Verify winner received payout
    const winnerAfter = await getAccount(provider.connection, winnerUsdcAta);
    const winnerDelta =
      Number(winnerAfter.amount) - Number(winnerBefore.amount);
    assert.equal(winnerDelta, expectedPayout, "Winner should receive 95% payout");

    // Verify treasury received fee
    const treasuryAfter = await getAccount(provider.connection, treasuryUsdcAta);
    const treasuryDelta =
      Number(treasuryAfter.amount) - Number(treasuryBefore.amount);
    assert.equal(treasuryDelta, expectedFee, "Treasury should receive 5% fee");

    // Verify vault is empty
    const vaultAfter = await getAccount(provider.connection, vaultUsdcAta);
    assert.equal(Number(vaultAfter.amount), 0, "Vault should be empty");

    // Verify round status = Claimed (4)
    const roundAfter = await provider.connection.getAccountInfo(roundPda);
    const status = roundAfter.data[8 + 8];
    assert.equal(status, 4, "Status should be 4 (Claimed)");

    console.log(`  Winner claimed ${winnerDelta / 1e6} USDC`);
    console.log(`  Treasury received ${treasuryDelta / 1e6} USDC fee`);
  });

  // =========================================================================
  // claim — fails when non-winner tries to claim
  // =========================================================================

  it("claim — fails when non-winner tries to claim", async () => {
    // Start a new round (round 3) and run through the full flow
    const roundId3 = new BN(3);
    const [roundPda3] = getRoundPda(roundId3);
    const vaultAta3 = getAssociatedTokenAddressSync(usdcMint, roundPda3, true);

    await program.methods
      .startRound(roundId3)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: roundPda3,
        vaultUsdcAta: vaultAta3,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Both users deposit
    for (const [user, ata] of [
      [user1, user1UsdcAta],
      [user2, user2UsdcAta],
    ] as [Keypair, PublicKey][]) {
      const [pPda] = getParticipantPda(roundPda3, user.publicKey);
      const acct = await getAccount(provider.connection, ata);
      const bal = new BN(acct.amount.toString());
      const dep = new BN(5_000_000);
      await program.methods
        .depositAny(roundId3, bal.sub(dep), dep)
        .accounts({
          user: user.publicKey,
          config: configPda,
          round: roundPda3,
          participant: pPda,
          userUsdcAta: ata,
          vaultUsdcAta: vaultAta3,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    }

    // Wait and lock
    console.log(`  Waiting ${ROUND_DURATION + 1}s for round 3 timer...`);
    await new Promise((r) => setTimeout(r, (ROUND_DURATION + 1) * 1000));

    await program.methods
      .lockRound(roundId3)
      .accounts({
        caller: admin.publicKey,
        config: configPda,
        round: roundPda3,
      })
      .rpc();

    // Settle — deterministic randomness that picks user1
    // With 5+5=10 tickets equally split, randomness [1,0,...] → ticket 2 → user1 (idx 1)
    const randomness3 = Buffer.alloc(32);
    randomness3.writeUInt32LE(0, 0); // picks ticket 1 → user1

    await program.methods
      .mockSettle(roundId3, Array.from(randomness3))
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: roundPda3,
      })
      .rpc();

    // Read winner
    const rAcct = await provider.connection.getAccountInfo(roundPda3);
    const wOff = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;
    const wBytes = rAcct.data.slice(wOff, wOff + 32);
    const winnerPk = new PublicKey(wBytes);
    const loserKeypair = winnerPk.equals(user1.publicKey) ? user2 : user1;
    const loserAta = winnerPk.equals(user1.publicKey) ? user2UsdcAta : user1UsdcAta;

    // Non-winner tries to claim — should fail
    try {
      await program.methods
        .claim(roundId3)
        .accounts({
          winner: loserKeypair.publicKey,
          config: configPda,
          round: roundPda3,
          vaultUsdcAta: vaultAta3,
          winnerUsdcAta: loserAta,
          treasuryUsdcAta,
          vrfPayerUsdcAta: null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([loserKeypair])
        .rpc();
      assert.fail("Should have thrown OnlyWinnerCanClaim");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("OnlyWinnerCanClaim") || errStr.includes("0x177c"),
        `Expected OnlyWinnerCanClaim, got: ${errStr}`
      );
      console.log("  Correctly rejected: non-winner can't claim");
    }
  });

  // =========================================================================
  // claim — fails on double-claim
  // =========================================================================

  it("claim — fails on double-claim", async () => {
    // Round 1 was already claimed above. Try to claim again.
    const roundAcct = await provider.connection.getAccountInfo(roundPda);
    const winnerOffset = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;
    const winnerBytes = roundAcct.data.slice(winnerOffset, winnerOffset + 32);
    const winner = new PublicKey(winnerBytes);
    const isUser1 = winner.equals(user1.publicKey);
    const winnerKeypair = isUser1 ? user1 : user2;
    const winnerUsdcAta = isUser1 ? user1UsdcAta : user2UsdcAta;

    try {
      await program.methods
        .claim(ROUND_ID)
        .accounts({
          winner: winnerKeypair.publicKey,
          config: configPda,
          round: roundPda,
          vaultUsdcAta,
          winnerUsdcAta,
          treasuryUsdcAta,
          vrfPayerUsdcAta: null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerKeypair])
        .rpc();
      assert.fail("Should have thrown RoundNotSettled");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotSettled") ||
          errStr.includes("RoundAlreadyClaimed") ||
          errStr.includes("0x1774") ||
          errStr.includes("0x1775"),
        `Expected RoundNotSettled/AlreadyClaimed, got: ${errStr}`
      );
      console.log("  Correctly rejected: double-claim");
    }
  });

  // =========================================================================
  // Round 5 — NotEnoughTickets (6010) + self-cancel after timer expiry
  // =========================================================================

  it("lock_round — fails with NotEnoughTickets (6010), then users can cancel after countdown", async () => {
    const roundId5 = new BN(5);
    const [roundPda5] = getRoundPda(roundId5);
    const vaultAta5 = getAssociatedTokenAddressSync(usdcMint, roundPda5, true);
    const [participantPda5User1] = getParticipantPda(roundPda5, user1.publicKey);
    const [participantPda5User2] = getParticipantPda(roundPda5, user2.publicKey);
    const oneUsdc = new BN(1_000_000);

    await program.methods
      .updateConfig({
        feeBps: null,
        ticketUnit: null,
        roundDurationSec: null,
        minParticipants: null,
        minTotalTickets: new BN(3), // require > 2 tickets to reproduce 6010
        paused: null,
        maxDepositPerUser: null,
      })
      .accounts({
        admin: admin.publicKey,
        config: configPda,
      })
      .rpc();

    try {
      await program.methods
        .startRound(roundId5)
        .accounts({
          payer: admin.publicKey,
          config: configPda,
          round: roundPda5,
          vaultUsdcAta: vaultAta5,
          usdcMint,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      for (const [user, userUsdcAta, participantPda] of [
        [user1, user1UsdcAta, participantPda5User1],
        [user2, user2UsdcAta, participantPda5User2],
      ] as Array<[Keypair, PublicKey, PublicKey]>) {
        const userAccount = await getAccount(provider.connection, userUsdcAta);
        const balanceBefore = new BN(userAccount.amount.toString());

        await program.methods
          .depositAny(roundId5, balanceBefore.sub(oneUsdc), oneUsdc)
          .accounts({
            user: user.publicKey,
            config: configPda,
            round: roundPda5,
            participant: participantPda,
            userUsdcAta,
            vaultUsdcAta: vaultAta5,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
      }

      console.log(`  Waiting ${ROUND_DURATION + 1}s for round 5 timer...`);
      await new Promise((r) => setTimeout(r, (ROUND_DURATION + 1) * 1000));

      try {
        await program.methods
          .lockRound(roundId5)
          .accounts({
            caller: admin.publicKey,
            config: configPda,
            round: roundPda5,
          })
          .rpc();
        assert.fail("Should have thrown NotEnoughTickets");
      } catch (err: any) {
        const errStr = err.toString();
        assert.ok(
          errStr.includes("NotEnoughTickets") ||
            errStr.includes("0x177a") ||
            errStr.includes("6010"),
          `Expected NotEnoughTickets/6010, got: ${errStr}`
        );
        console.log("  Correctly rejected: not enough tickets (6010)");
      }

      try {
        await program.methods
          .cancelRound(roundId5)
          .accounts({
            user: user1.publicKey,
            config: configPda,
            round: roundPda5,
            participant: participantPda5User1,
            // Deliberately wrong vault (round #1 vault) to test account substitution guard.
            vaultUsdcAta,
            userUsdcAta: user1UsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown InvalidVault");
      } catch (err: any) {
        const errStr = err.toString();
        assert.ok(
          errStr.includes("InvalidVault"),
          `Expected InvalidVault, got: ${errStr}`
        );
        console.log("  Correctly rejected: cancel_round with wrong vault ATA");
      }

      // User-triggered cancel still works because round remains Open.
      await program.methods
        .cancelRound(roundId5)
        .accounts({
          user: user1.publicKey,
          config: configPda,
          round: roundPda5,
          participant: participantPda5User1,
          vaultUsdcAta: vaultAta5,
          userUsdcAta: user1UsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const roundAfterFirstCancel = await provider.connection.getAccountInfo(roundPda5);
      assert.equal(roundAfterFirstCancel!.data[8 + 8], 0, "Round should stay Open until final refund");

      await program.methods
        .cancelRound(roundId5)
        .accounts({
          user: user2.publicKey,
          config: configPda,
          round: roundPda5,
          participant: participantPda5User2,
          vaultUsdcAta: vaultAta5,
          userUsdcAta: user2UsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      const roundAfterSecondCancel = await provider.connection.getAccountInfo(roundPda5);
      assert.equal(roundAfterSecondCancel!.data[8 + 8], 5, "Round should become Cancelled after all refunds");

      await program.methods
        .closeParticipant(roundId5)
        .accounts({
          payer: admin.publicKey,
          user: user1.publicKey,
          round: roundPda5,
          participant: participantPda5User1,
        })
        .rpc();

      await program.methods
        .closeParticipant(roundId5)
        .accounts({
          payer: admin.publicKey,
          user: user2.publicKey,
          round: roundPda5,
          participant: participantPda5User2,
        })
        .rpc();

      await program.methods
        .closeRound(roundId5)
        .accounts({
          payer: admin.publicKey,
          recipient: admin.publicKey,
          round: roundPda5,
          vaultUsdcAta: vaultAta5,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } finally {
      // Restore baseline config so later tests (or local reruns) keep original assumptions.
      await program.methods
        .updateConfig({
          feeBps: null,
          ticketUnit: null,
          roundDurationSec: null,
          minParticipants: null,
          minTotalTickets: MIN_TOTAL_TICKETS,
          paused: null,
          maxDepositPerUser: null,
        })
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .rpc();
    }
  });

  // =========================================================================
  // Round 6 — claim_refund/admin_force_cancel edge cases
  // =========================================================================

  it("claim_refund/admin_force_cancel — rejects invalid states and double refund", async () => {
    const roundId6 = new BN(6);
    const [roundPda6] = getRoundPda(roundId6);
    const vaultAta6 = getAssociatedTokenAddressSync(usdcMint, roundPda6, true);
    const [participantPda6User1] = getParticipantPda(roundPda6, user1.publicKey);
    const [participantPda6User2] = getParticipantPda(roundPda6, user2.publicKey);
    const user1Deposit = new BN(2_000_000);
    const user2Deposit = new BN(4_000_000);

    await program.methods
      .startRound(roundId6)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: roundPda6,
        vaultUsdcAta: vaultAta6,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    for (const [user, userUsdcAta, participantPda, depositAmount] of [
      [user1, user1UsdcAta, participantPda6User1, user1Deposit],
      [user2, user2UsdcAta, participantPda6User2, user2Deposit],
    ] as Array<[Keypair, PublicKey, PublicKey, BN]>) {
      const userAccount = await getAccount(provider.connection, userUsdcAta);
      const balanceBefore = new BN(userAccount.amount.toString());

      await program.methods
        .depositAny(roundId6, balanceBefore.sub(depositAmount), depositAmount)
        .accounts({
          user: user.publicKey,
          config: configPda,
          round: roundPda6,
          participant: participantPda,
          userUsdcAta,
          vaultUsdcAta: vaultAta6,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    }

    try {
      await program.methods
        .claimRefund(roundId6)
        .accounts({
          user: user1.publicKey,
          config: configPda,
          round: roundPda6,
          participant: participantPda6User1,
          vaultUsdcAta: vaultAta6,
          userUsdcAta: user1UsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
      assert.fail("Should have thrown RoundNotCancellable");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotCancellable"),
        `Expected RoundNotCancellable, got: ${errStr}`
      );
      console.log("  Correctly rejected: claim_refund before force-cancel");
    }

    try {
      await program.methods
        .adminForceCancel(roundId6)
        .accounts({
          admin: user1.publicKey,
          config: configPda,
          round: roundPda6,
        })
        .signers([user1])
        .rpc();
      assert.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("Unauthorized"),
        `Expected Unauthorized, got: ${errStr}`
      );
      console.log("  Correctly rejected: non-admin force-cancel");
    }

    await program.methods
      .adminForceCancel(roundId6)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: roundPda6,
      })
      .rpc();

    try {
      await program.methods
        .closeRound(roundId6)
        .accounts({
          payer: admin.publicKey,
          recipient: admin.publicKey,
          round: roundPda6,
          vaultUsdcAta: vaultAta6,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown VaultNotEmpty");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("VaultNotEmpty"),
        `Expected VaultNotEmpty, got: ${errStr}`
      );
      console.log("  Correctly rejected: close_round before refunds (vault not empty)");
    }

    try {
      await program.methods
        .claimRefund(roundId6)
        .accounts({
          user: user1.publicKey,
          config: configPda,
          round: roundPda6,
          participant: participantPda6User1,
          // Deliberately wrong vault (round #1 vault) to test account substitution guard.
          vaultUsdcAta,
          userUsdcAta: user1UsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
      assert.fail("Should have thrown InvalidVault");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("InvalidVault"),
        `Expected InvalidVault, got: ${errStr}`
      );
      console.log("  Correctly rejected: claim_refund with wrong vault ATA");
    }

    try {
      await program.methods
        .claimRefund(roundId6)
        .accounts({
          user: user1.publicKey,
          config: configPda,
          round: roundPda6,
          participant: participantPda6User1,
          vaultUsdcAta: vaultAta6,
          // Deliberately wrong user ATA (belongs to user2)
          userUsdcAta: user2UsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
      assert.fail("Should have thrown InvalidUserUsdcAta");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("InvalidUserUsdcAta"),
        `Expected InvalidUserUsdcAta, got: ${errStr}`
      );
      console.log("  Correctly rejected: claim_refund with foreign userUsdcAta");
    }

    await program.methods
      .claimRefund(roundId6)
      .accounts({
        user: user1.publicKey,
        config: configPda,
        round: roundPda6,
        participant: participantPda6User1,
        vaultUsdcAta: vaultAta6,
        userUsdcAta: user1UsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();

    try {
      await program.methods
        .claimRefund(roundId6)
        .accounts({
          user: user1.publicKey,
          config: configPda,
          round: roundPda6,
          participant: participantPda6User1,
          vaultUsdcAta: vaultAta6,
          userUsdcAta: user1UsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
      assert.fail("Should have thrown NoDepositToRefund");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("NoDepositToRefund"),
        `Expected NoDepositToRefund, got: ${errStr}`
      );
      console.log("  Correctly rejected: double claim_refund");
    }

    try {
      await program.methods
        .adminForceCancel(roundId6)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          round: roundPda6,
        })
        .rpc();
      assert.fail("Should have thrown RoundNotCancellable");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotCancellable"),
        `Expected RoundNotCancellable, got: ${errStr}`
      );
      console.log("  Correctly rejected: force-cancel on cancelled round");
    }

    await program.methods
      .claimRefund(roundId6)
      .accounts({
        user: user2.publicKey,
        config: configPda,
        round: roundPda6,
        participant: participantPda6User2,
        vaultUsdcAta: vaultAta6,
        userUsdcAta: user2UsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    await program.methods
      .closeParticipant(roundId6)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: roundPda6,
        participant: participantPda6User1,
      })
      .rpc();

    await program.methods
      .closeParticipant(roundId6)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: roundPda6,
        participant: participantPda6User2,
      })
      .rpc();

    await program.methods
      .closeRound(roundId6)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: roundPda6,
        vaultUsdcAta: vaultAta6,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("claim/close_participant — validates treasury/user ATA and terminal-state guards", async () => {
    const roundId7 = new BN(7);
    const [roundPda7] = getRoundPda(roundId7);
    const vaultAta7 = getAssociatedTokenAddressSync(usdcMint, roundPda7, true);
    const [participantPda7User1] = getParticipantPda(roundPda7, user1.publicKey);
    const [participantPda7User2] = getParticipantPda(roundPda7, user2.publicKey);
    const dep = new BN(5_000_000); // 5 USDC each

    await program.methods
      .startRound(roundId7)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: roundPda7,
        vaultUsdcAta: vaultAta7,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    for (const [user, ata, participantPda] of [
      [user1, user1UsdcAta, participantPda7User1],
      [user2, user2UsdcAta, participantPda7User2],
    ] as Array<[Keypair, PublicKey, PublicKey]>) {
      const acct = await getAccount(provider.connection, ata);
      const bal = new BN(acct.amount.toString());

      await program.methods
        .depositAny(roundId7, bal.sub(dep), dep)
        .accounts({
          user: user.publicKey,
          config: configPda,
          round: roundPda7,
          participant: participantPda,
          userUsdcAta: ata,
          vaultUsdcAta: vaultAta7,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    }

    console.log(`  Waiting ${ROUND_DURATION + 1}s for round 7 timer...`);
    await new Promise((r) => setTimeout(r, (ROUND_DURATION + 1) * 1000));

    await program.methods
      .lockRound(roundId7)
      .accounts({
        caller: admin.publicKey,
        config: configPda,
        round: roundPda7,
      })
      .rpc();

    const randomness7 = Buffer.alloc(32);
    randomness7.writeUInt32LE(1, 0);

    await program.methods
      .mockSettle(roundId7, Array.from(randomness7))
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: roundPda7,
      })
      .rpc();

    // close_participant should be blocked while round is Settled (not terminal for cleanup yet)
    try {
      await program.methods
        .closeParticipant(roundId7)
        .accounts({
          payer: admin.publicKey,
          user: user1.publicKey,
          round: roundPda7,
          participant: participantPda7User1,
        })
        .rpc();
      assert.fail("Should have thrown RoundNotCloseable");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("RoundNotCloseable"),
        `Expected RoundNotCloseable, got: ${errStr}`
      );
      console.log("  Correctly rejected: close_participant on Settled round");
    }

    const rAcct7 = await provider.connection.getAccountInfo(roundPda7);
    const winnerOffset = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;
    const winnerBytes7 = rAcct7!.data.slice(winnerOffset, winnerOffset + 32);
    const winnerPk7 = new PublicKey(winnerBytes7);
    const winnerKeypair7 = winnerPk7.equals(user1.publicKey) ? user1 : user2;
    const winnerAta7 = winnerPk7.equals(user1.publicKey) ? user1UsdcAta : user2UsdcAta;
    const loserAta7 = winnerPk7.equals(user1.publicKey) ? user2UsdcAta : user1UsdcAta;

    try {
      await program.methods
        .claim(roundId7)
        .accounts({
          winner: winnerKeypair7.publicKey,
          config: configPda,
          round: roundPda7,
          vaultUsdcAta: vaultAta7,
          winnerUsdcAta: winnerAta7,
          // Wrong treasury ATA (belongs to winner)
          treasuryUsdcAta: winnerAta7,
          vrfPayerUsdcAta: null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerKeypair7])
        .rpc();
      assert.fail("Should have thrown InvalidTreasury");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("InvalidTreasury"),
        `Expected InvalidTreasury, got: ${errStr}`
      );
      console.log("  Correctly rejected: claim with wrong treasury ATA");
    }

    try {
      await program.methods
        .claim(roundId7)
        .accounts({
          winner: winnerKeypair7.publicKey,
          config: configPda,
          round: roundPda7,
          vaultUsdcAta: vaultAta7,
          // Wrong user ATA (belongs to loser)
          winnerUsdcAta: loserAta7,
          treasuryUsdcAta,
          vrfPayerUsdcAta: null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerKeypair7])
        .rpc();
      assert.fail("Should have thrown InvalidUserUsdcAta");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("InvalidUserUsdcAta"),
        `Expected InvalidUserUsdcAta, got: ${errStr}`
      );
      console.log("  Correctly rejected: claim with foreign winnerUsdcAta");
    }

    try {
      await program.methods
        .claim(roundId7)
        .accounts({
          winner: winnerKeypair7.publicKey,
          config: configPda,
          round: roundPda7,
          // Deliberately wrong vault ATA (round #1 vault) to test account substitution guard.
          vaultUsdcAta,
          winnerUsdcAta: winnerAta7,
          treasuryUsdcAta,
          vrfPayerUsdcAta: null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerKeypair7])
        .rpc();
      assert.fail("Should have thrown InvalidVault");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("InvalidVault"),
        `Expected InvalidVault, got: ${errStr}`
      );
      console.log("  Correctly rejected: claim with wrong vault ATA");
    }

    await program.methods
      .claim(roundId7)
      .accounts({
        winner: winnerKeypair7.publicKey,
        config: configPda,
        round: roundPda7,
        vaultUsdcAta: vaultAta7,
        winnerUsdcAta: winnerAta7,
        treasuryUsdcAta,
        vrfPayerUsdcAta: null,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([winnerKeypair7])
      .rpc();

    try {
      await program.methods
        .closeParticipant(roundId7)
        .accounts({
          payer: admin.publicKey,
          // Deliberately mismatched user for participantPda7User1 -> should fail seeds validation.
          user: user2.publicKey,
          round: roundPda7,
          participant: participantPda7User1,
        })
        .rpc();
      assert.fail("Should have thrown ConstraintSeeds");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("ConstraintSeeds") ||
          errStr.includes("A seeds constraint was violated"),
        `Expected ConstraintSeeds, got: ${errStr}`
      );
      console.log("  Correctly rejected: close_participant with mismatched user/participant seeds");
    }

    await program.methods
      .closeParticipant(roundId7)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: roundPda7,
        participant: participantPda7User1,
      })
      .rpc();

    await program.methods
      .closeParticipant(roundId7)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: roundPda7,
        participant: participantPda7User2,
      })
      .rpc();

    await program.methods
      .closeRound(roundId7)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: roundPda7,
        vaultUsdcAta: vaultAta7,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("claim — VRF reimbursement pays valid vrf_payer ATA and gracefully skips invalid ATA", async () => {
    const VRF_REIMBURSE_RAW = 200_000; // 0.20 USDC (matches constants::VRF_REIMBURSEMENT_USDC)
    const winnerOffset = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;
    const participantsBytes = 200 * 32; // MAX_PARTICIPANTS in program constants
    const fenwickBytes = (200 + 1) * 8;
    const vrfReimbursedOffset = winnerOffset + 32 + participantsBytes + fenwickBytes + 32;

    async function prepareSettledRound(roundId: BN) {
      const [roundPdaX] = getRoundPda(roundId);
      const vaultAtaX = getAssociatedTokenAddressSync(usdcMint, roundPdaX, true);
      const [participantPdaUser1] = getParticipantPda(roundPdaX, user1.publicKey);
      const [participantPdaUser2] = getParticipantPda(roundPdaX, user2.publicKey);
      const dep = new BN(5_000_000);

      await program.methods
        .startRound(roundId)
        .accounts({
          payer: admin.publicKey,
          config: configPda,
          round: roundPdaX,
          vaultUsdcAta: vaultAtaX,
          usdcMint,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      for (const [user, ata, participantPda] of [
        [user1, user1UsdcAta, participantPdaUser1],
        [user2, user2UsdcAta, participantPdaUser2],
      ] as Array<[Keypair, PublicKey, PublicKey]>) {
        const acct = await getAccount(provider.connection, ata);
        const bal = new BN(acct.amount.toString());
        await program.methods
          .depositAny(roundId, bal.sub(dep), dep)
          .accounts({
            user: user.publicKey,
            config: configPda,
            round: roundPdaX,
            participant: participantPda,
            userUsdcAta: ata,
            vaultUsdcAta: vaultAtaX,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
      }

      console.log(`  Waiting ${ROUND_DURATION + 1}s for round ${roundId.toString()} timer...`);
      await new Promise((r) => setTimeout(r, (ROUND_DURATION + 1) * 1000));

      await program.methods
        .lockRound(roundId)
        .accounts({
          caller: admin.publicKey,
          config: configPda,
          round: roundPdaX,
        })
        .rpc();

      // Deterministic randomness; winner read back from account anyway.
      const randomness = Buffer.alloc(32);
      randomness.writeUInt32LE(0, 0);
      await program.methods
        .mockSettle(roundId, Array.from(randomness))
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          round: roundPdaX,
        })
        .rpc();

      const roundAcct = await provider.connection.getAccountInfo(roundPdaX);
      const winnerBytesX = roundAcct!.data.slice(winnerOffset, winnerOffset + 32);
      const winnerPkX = new PublicKey(winnerBytesX);
      const winnerKeypairX = winnerPkX.equals(user1.publicKey) ? user1 : user2;
      const winnerAtaX = winnerPkX.equals(user1.publicKey) ? user1UsdcAta : user2UsdcAta;
      const loserKeypairX = winnerPkX.equals(user1.publicKey) ? user2 : user1;
      const loserAtaX = winnerPkX.equals(user1.publicKey) ? user2UsdcAta : user1UsdcAta;

      return {
        roundPdaX,
        vaultAtaX,
        participantPdaUser1,
        participantPdaUser2,
        winnerKeypairX,
        winnerAtaX,
        loserKeypairX,
        loserAtaX,
      };
    }

    // Case A: valid VRF payer ATA -> reimbursement is paid, payout/fee calculated on net pot.
    const roundId8 = new BN(8);
    const settled8 = await prepareSettledRound(roundId8);

    await program.methods
      .mockSetVrfMeta(roundId8, settled8.loserKeypairX.publicKey, false)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: settled8.roundPdaX,
      })
      .rpc();

    const winnerBefore8 = await getAccount(provider.connection, settled8.winnerAtaX);
    const vrfPayerBefore8 = await getAccount(provider.connection, settled8.loserAtaX);
    const treasuryBefore8 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultBefore8 = await getAccount(provider.connection, settled8.vaultAtaX);

    const totalPot8 = Number(vaultBefore8.amount);
    const expectedVrf8 = Math.min(VRF_REIMBURSE_RAW, totalPot8);
    const potAfterReimburse8 = totalPot8 - expectedVrf8;
    const expectedFee8 = Math.floor((potAfterReimburse8 * FEE_BPS) / 10_000);
    const expectedPayout8 = potAfterReimburse8 - expectedFee8;

    await program.methods
      .claim(roundId8)
      .accounts({
        winner: settled8.winnerKeypairX.publicKey,
        config: configPda,
        round: settled8.roundPdaX,
        vaultUsdcAta: settled8.vaultAtaX,
        winnerUsdcAta: settled8.winnerAtaX,
        treasuryUsdcAta,
        vrfPayerUsdcAta: settled8.loserAtaX,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([settled8.winnerKeypairX])
      .rpc();

    const winnerAfter8 = await getAccount(provider.connection, settled8.winnerAtaX);
    const vrfPayerAfter8 = await getAccount(provider.connection, settled8.loserAtaX);
    const treasuryAfter8 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultAfter8 = await getAccount(provider.connection, settled8.vaultAtaX);
    const roundAfter8 = await provider.connection.getAccountInfo(settled8.roundPdaX);

    assert.equal(
      Number(winnerAfter8.amount) - Number(winnerBefore8.amount),
      expectedPayout8,
      "Winner payout should be net of VRF reimbursement and fee"
    );
    assert.equal(
      Number(vrfPayerAfter8.amount) - Number(vrfPayerBefore8.amount),
      expectedVrf8,
      "VRF payer should receive reimbursement when ATA is valid"
    );
    assert.equal(
      Number(treasuryAfter8.amount) - Number(treasuryBefore8.amount),
      expectedFee8,
      "Treasury fee should be computed after reimbursement"
    );
    assert.equal(Number(vaultAfter8.amount), 0, "Vault should be empty after claim");
    assert.equal(roundAfter8!.data[8 + 8], 4, "Round #8 status should be Claimed");
    assert.equal(
      roundAfter8!.data[vrfReimbursedOffset],
      1,
      "Round #8 vrf_reimbursed flag should be set"
    );

    // Cleanup round 8 participant PDAs + round
    await program.methods
      .closeParticipant(roundId8)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: settled8.roundPdaX,
        participant: settled8.participantPdaUser1,
      })
      .rpc();
    await program.methods
      .closeParticipant(roundId8)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: settled8.roundPdaX,
        participant: settled8.participantPdaUser2,
      })
      .rpc();
    await program.methods
      .closeRound(roundId8)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: settled8.roundPdaX,
        vaultUsdcAta: settled8.vaultAtaX,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Case B: invalid VRF payer ATA -> claim succeeds, reimbursement skipped gracefully.
    const roundId9 = new BN(9);
    const settled9 = await prepareSettledRound(roundId9);

    await program.methods
      .mockSetVrfMeta(roundId9, settled9.loserKeypairX.publicKey, false)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: settled9.roundPdaX,
      })
      .rpc();

    const winnerBefore9 = await getAccount(provider.connection, settled9.winnerAtaX);
    const vrfPayerBefore9 = await getAccount(provider.connection, settled9.loserAtaX);
    const treasuryBefore9 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultBefore9 = await getAccount(provider.connection, settled9.vaultAtaX);

    const totalPot9 = Number(vaultBefore9.amount);
    const expectedFee9 = Math.floor((totalPot9 * FEE_BPS) / 10_000);
    const expectedPayout9 = totalPot9 - expectedFee9;

    await program.methods
      .claim(roundId9)
      .accounts({
        winner: settled9.winnerKeypairX.publicKey,
        config: configPda,
        round: settled9.roundPdaX,
        vaultUsdcAta: settled9.vaultAtaX,
        winnerUsdcAta: settled9.winnerAtaX,
        treasuryUsdcAta,
        // Deliberately invalid for vrf_payer (owner != loser): should skip reimbursement, not fail.
        vrfPayerUsdcAta: treasuryUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([settled9.winnerKeypairX])
      .rpc();

    const winnerAfter9 = await getAccount(provider.connection, settled9.winnerAtaX);
    const vrfPayerAfter9 = await getAccount(provider.connection, settled9.loserAtaX);
    const treasuryAfter9 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultAfter9 = await getAccount(provider.connection, settled9.vaultAtaX);
    const roundAfter9 = await provider.connection.getAccountInfo(settled9.roundPdaX);

    assert.equal(
      Number(winnerAfter9.amount) - Number(winnerBefore9.amount),
      expectedPayout9,
      "Winner payout should use full pot when reimbursement is skipped"
    );
    assert.equal(
      Number(vrfPayerAfter9.amount) - Number(vrfPayerBefore9.amount),
      0,
      "VRF payer should not be reimbursed when ATA is invalid"
    );
    assert.equal(
      Number(treasuryAfter9.amount) - Number(treasuryBefore9.amount),
      expectedFee9,
      "Treasury fee should be computed on full pot when reimbursement is skipped"
    );
    assert.equal(Number(vaultAfter9.amount), 0, "Vault should be empty after claim");
    assert.equal(roundAfter9!.data[8 + 8], 4, "Round #9 status should be Claimed");
    assert.equal(
      roundAfter9!.data[vrfReimbursedOffset],
      0,
      "Round #9 vrf_reimbursed flag should remain unset when reimbursement was skipped"
    );

    // Cleanup round 9 participant PDAs + round
    await program.methods
      .closeParticipant(roundId9)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: settled9.roundPdaX,
        participant: settled9.participantPdaUser1,
      })
      .rpc();
    await program.methods
      .closeParticipant(roundId9)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: settled9.roundPdaX,
        participant: settled9.participantPdaUser2,
      })
      .rpc();
    await program.methods
      .closeRound(roundId9)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: settled9.roundPdaX,
        vaultUsdcAta: settled9.vaultAtaX,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("auto_claim — non-winner payer can trigger payout, but winner ATA is still validated", async () => {
    const roundId10 = new BN(10);
    const [roundPda10] = getRoundPda(roundId10);
    const vaultAta10 = getAssociatedTokenAddressSync(usdcMint, roundPda10, true);
    const [participantPda10User1] = getParticipantPda(roundPda10, user1.publicKey);
    const [participantPda10User2] = getParticipantPda(roundPda10, user2.publicKey);
    const dep = new BN(5_000_000);
    const winnerOffset = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;

    await program.methods
      .startRound(roundId10)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: roundPda10,
        vaultUsdcAta: vaultAta10,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    for (const [user, ata, participantPda] of [
      [user1, user1UsdcAta, participantPda10User1],
      [user2, user2UsdcAta, participantPda10User2],
    ] as Array<[Keypair, PublicKey, PublicKey]>) {
      const acct = await getAccount(provider.connection, ata);
      const bal = new BN(acct.amount.toString());
      await program.methods
        .depositAny(roundId10, bal.sub(dep), dep)
        .accounts({
          user: user.publicKey,
          config: configPda,
          round: roundPda10,
          participant: participantPda,
          userUsdcAta: ata,
          vaultUsdcAta: vaultAta10,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    }

    console.log(`  Waiting ${ROUND_DURATION + 1}s for round 10 timer...`);
    await new Promise((r) => setTimeout(r, (ROUND_DURATION + 1) * 1000));

    await program.methods
      .lockRound(roundId10)
      .accounts({
        caller: admin.publicKey,
        config: configPda,
        round: roundPda10,
      })
      .rpc();

    const randomness10 = Buffer.alloc(32);
    randomness10.writeUInt32LE(0, 0);
    await program.methods
      .mockSettle(roundId10, Array.from(randomness10))
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: roundPda10,
      })
      .rpc();

    const roundAcct10 = await provider.connection.getAccountInfo(roundPda10);
    const winnerBytes10 = roundAcct10!.data.slice(winnerOffset, winnerOffset + 32);
    const winnerPk10 = new PublicKey(winnerBytes10);
    const isUser1Winner10 = winnerPk10.equals(user1.publicKey);
    const winnerAta10 = isUser1Winner10 ? user1UsdcAta : user2UsdcAta;
    const loserAta10 = isUser1Winner10 ? user2UsdcAta : user1UsdcAta;
    const payerKeypair10 = isUser1Winner10 ? user2 : user1; // payer is intentionally NOT the winner

    try {
      await program.methods
        .autoClaim(roundId10)
        .accounts({
          payer: payerKeypair10.publicKey,
          config: configPda,
          round: roundPda10,
          vaultUsdcAta: vaultAta10,
          // Deliberately wrong winner ATA (belongs to loser)
          winnerUsdcAta: loserAta10,
          treasuryUsdcAta,
          vrfPayerUsdcAta: null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([payerKeypair10])
        .rpc();
      assert.fail("Should have thrown InvalidUserUsdcAta");
    } catch (err: any) {
      const errStr = err.toString();
      assert.ok(
        errStr.includes("InvalidUserUsdcAta"),
        `Expected InvalidUserUsdcAta, got: ${errStr}`
      );
      console.log("  Correctly rejected: auto_claim with foreign winnerUsdcAta");
    }

    const winnerBefore10 = await getAccount(provider.connection, winnerAta10);
    const treasuryBefore10 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultBefore10 = await getAccount(provider.connection, vaultAta10);

    const totalPot10 = Number(vaultBefore10.amount);
    const expectedFee10 = Math.floor((totalPot10 * FEE_BPS) / 10_000);
    const expectedPayout10 = totalPot10 - expectedFee10;

    await program.methods
      .autoClaim(roundId10)
      .accounts({
        payer: payerKeypair10.publicKey,
        config: configPda,
        round: roundPda10,
        vaultUsdcAta: vaultAta10,
        winnerUsdcAta: winnerAta10,
        treasuryUsdcAta,
        vrfPayerUsdcAta: null,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKeypair10])
      .rpc();

    const winnerAfter10 = await getAccount(provider.connection, winnerAta10);
    const treasuryAfter10 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultAfter10 = await getAccount(provider.connection, vaultAta10);
    const roundAfter10 = await provider.connection.getAccountInfo(roundPda10);

    assert.equal(
      Number(winnerAfter10.amount) - Number(winnerBefore10.amount),
      expectedPayout10,
      "auto_claim should pay the on-chain winner"
    );
    assert.equal(
      Number(treasuryAfter10.amount) - Number(treasuryBefore10.amount),
      expectedFee10,
      "auto_claim should pay treasury fee"
    );
    assert.equal(Number(vaultAfter10.amount), 0, "Vault should be empty after auto_claim");
    assert.equal(roundAfter10!.data[8 + 8], 4, "Round #10 status should be Claimed");

    await program.methods
      .closeParticipant(roundId10)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: roundPda10,
        participant: participantPda10User1,
      })
      .rpc();
    await program.methods
      .closeParticipant(roundId10)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: roundPda10,
        participant: participantPda10User2,
      })
      .rpc();
    await program.methods
      .closeRound(roundId10)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: roundPda10,
        vaultUsdcAta: vaultAta10,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("auto_claim — VRF reimbursement pays valid vrf_payer ATA and gracefully skips invalid ATA", async () => {
    const VRF_REIMBURSE_RAW = 200_000; // 0.20 USDC
    const winnerOffset = 8 + 8 + 1 + 1 + 6 + 8 + 8 + 8 + 32 + 8 + 8 + 2 + 6 + 32 + 8;
    const participantsBytes = 200 * 32; // MAX_PARTICIPANTS
    const fenwickBytes = (200 + 1) * 8;
    const vrfReimbursedOffset = winnerOffset + 32 + participantsBytes + fenwickBytes + 32;

    async function prepareSettledRoundForAutoClaim(roundId: BN) {
      const [roundPdaX] = getRoundPda(roundId);
      const vaultAtaX = getAssociatedTokenAddressSync(usdcMint, roundPdaX, true);
      const [participantPdaUser1] = getParticipantPda(roundPdaX, user1.publicKey);
      const [participantPdaUser2] = getParticipantPda(roundPdaX, user2.publicKey);
      const dep = new BN(5_000_000);

      await program.methods
        .startRound(roundId)
        .accounts({
          payer: admin.publicKey,
          config: configPda,
          round: roundPdaX,
          vaultUsdcAta: vaultAtaX,
          usdcMint,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      for (const [user, ata, participantPda] of [
        [user1, user1UsdcAta, participantPdaUser1],
        [user2, user2UsdcAta, participantPdaUser2],
      ] as Array<[Keypair, PublicKey, PublicKey]>) {
        const acct = await getAccount(provider.connection, ata);
        const bal = new BN(acct.amount.toString());
        await program.methods
          .depositAny(roundId, bal.sub(dep), dep)
          .accounts({
            user: user.publicKey,
            config: configPda,
            round: roundPdaX,
            participant: participantPda,
            userUsdcAta: ata,
            vaultUsdcAta: vaultAtaX,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
      }

      console.log(`  Waiting ${ROUND_DURATION + 1}s for round ${roundId.toString()} timer...`);
      await new Promise((r) => setTimeout(r, (ROUND_DURATION + 1) * 1000));

      await program.methods
        .lockRound(roundId)
        .accounts({
          caller: admin.publicKey,
          config: configPda,
          round: roundPdaX,
        })
        .rpc();

      const randomness = Buffer.alloc(32);
      randomness.writeUInt32LE(0, 0);
      await program.methods
        .mockSettle(roundId, Array.from(randomness))
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          round: roundPdaX,
        })
        .rpc();

      const roundAcct = await provider.connection.getAccountInfo(roundPdaX);
      const winnerBytesX = roundAcct!.data.slice(winnerOffset, winnerOffset + 32);
      const winnerPkX = new PublicKey(winnerBytesX);
      const isUser1Winner = winnerPkX.equals(user1.publicKey);

      return {
        roundPdaX,
        vaultAtaX,
        participantPdaUser1,
        participantPdaUser2,
        winnerAtaX: isUser1Winner ? user1UsdcAta : user2UsdcAta,
        loserPubkeyX: isUser1Winner ? user2.publicKey : user1.publicKey,
        loserAtaX: isUser1Winner ? user2UsdcAta : user1UsdcAta,
      };
    }

    // Case A: valid reimbursement ATA
    const roundId11 = new BN(11);
    const settled11 = await prepareSettledRoundForAutoClaim(roundId11);

    await program.methods
      .mockSetVrfMeta(roundId11, settled11.loserPubkeyX, false)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: settled11.roundPdaX,
      })
      .rpc();

    const winnerBefore11 = await getAccount(provider.connection, settled11.winnerAtaX);
    const vrfPayerBefore11 = await getAccount(provider.connection, settled11.loserAtaX);
    const treasuryBefore11 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultBefore11 = await getAccount(provider.connection, settled11.vaultAtaX);

    const totalPot11 = Number(vaultBefore11.amount);
    const expectedVrf11 = Math.min(VRF_REIMBURSE_RAW, totalPot11);
    const potAfterReimburse11 = totalPot11 - expectedVrf11;
    const expectedFee11 = Math.floor((potAfterReimburse11 * FEE_BPS) / 10_000);
    const expectedPayout11 = potAfterReimburse11 - expectedFee11;

    await program.methods
      .autoClaim(roundId11)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: settled11.roundPdaX,
        vaultUsdcAta: settled11.vaultAtaX,
        winnerUsdcAta: settled11.winnerAtaX,
        treasuryUsdcAta,
        vrfPayerUsdcAta: settled11.loserAtaX,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const winnerAfter11 = await getAccount(provider.connection, settled11.winnerAtaX);
    const vrfPayerAfter11 = await getAccount(provider.connection, settled11.loserAtaX);
    const treasuryAfter11 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultAfter11 = await getAccount(provider.connection, settled11.vaultAtaX);
    const roundAfter11 = await provider.connection.getAccountInfo(settled11.roundPdaX);

    assert.equal(Number(winnerAfter11.amount) - Number(winnerBefore11.amount), expectedPayout11);
    assert.equal(Number(vrfPayerAfter11.amount) - Number(vrfPayerBefore11.amount), expectedVrf11);
    assert.equal(Number(treasuryAfter11.amount) - Number(treasuryBefore11.amount), expectedFee11);
    assert.equal(Number(vaultAfter11.amount), 0, "Vault #11 should be empty after auto_claim");
    assert.equal(roundAfter11!.data[8 + 8], 4, "Round #11 status should be Claimed");
    assert.equal(roundAfter11!.data[vrfReimbursedOffset], 1, "Round #11 vrf_reimbursed should be set");

    await program.methods
      .closeParticipant(roundId11)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: settled11.roundPdaX,
        participant: settled11.participantPdaUser1,
      })
      .rpc();
    await program.methods
      .closeParticipant(roundId11)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: settled11.roundPdaX,
        participant: settled11.participantPdaUser2,
      })
      .rpc();
    await program.methods
      .closeRound(roundId11)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: settled11.roundPdaX,
        vaultUsdcAta: settled11.vaultAtaX,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Case B: invalid reimbursement ATA -> skip reimbursement gracefully
    const roundId12 = new BN(12);
    const settled12 = await prepareSettledRoundForAutoClaim(roundId12);

    await program.methods
      .mockSetVrfMeta(roundId12, settled12.loserPubkeyX, false)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        round: settled12.roundPdaX,
      })
      .rpc();

    const winnerBefore12 = await getAccount(provider.connection, settled12.winnerAtaX);
    const vrfPayerBefore12 = await getAccount(provider.connection, settled12.loserAtaX);
    const treasuryBefore12 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultBefore12 = await getAccount(provider.connection, settled12.vaultAtaX);

    const totalPot12 = Number(vaultBefore12.amount);
    const expectedFee12 = Math.floor((totalPot12 * FEE_BPS) / 10_000);
    const expectedPayout12 = totalPot12 - expectedFee12;

    await program.methods
      .autoClaim(roundId12)
      .accounts({
        payer: admin.publicKey,
        config: configPda,
        round: settled12.roundPdaX,
        vaultUsdcAta: settled12.vaultAtaX,
        winnerUsdcAta: settled12.winnerAtaX,
        treasuryUsdcAta,
        // Deliberately invalid for recorded vrf payer (owner = admin instead of loser participant)
        vrfPayerUsdcAta: treasuryUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const winnerAfter12 = await getAccount(provider.connection, settled12.winnerAtaX);
    const vrfPayerAfter12 = await getAccount(provider.connection, settled12.loserAtaX);
    const treasuryAfter12 = await getAccount(provider.connection, treasuryUsdcAta);
    const vaultAfter12 = await getAccount(provider.connection, settled12.vaultAtaX);
    const roundAfter12 = await provider.connection.getAccountInfo(settled12.roundPdaX);

    assert.equal(Number(winnerAfter12.amount) - Number(winnerBefore12.amount), expectedPayout12);
    assert.equal(
      Number(vrfPayerAfter12.amount) - Number(vrfPayerBefore12.amount),
      0,
      "VRF reimbursement should be skipped when vrf_payer ATA is invalid"
    );
    assert.equal(Number(treasuryAfter12.amount) - Number(treasuryBefore12.amount), expectedFee12);
    assert.equal(Number(vaultAfter12.amount), 0, "Vault #12 should be empty after auto_claim");
    assert.equal(roundAfter12!.data[8 + 8], 4, "Round #12 status should be Claimed");
    assert.equal(
      roundAfter12!.data[vrfReimbursedOffset],
      0,
      "Round #12 vrf_reimbursed should remain unset when reimbursement skipped"
    );

    await program.methods
      .closeParticipant(roundId12)
      .accounts({
        payer: admin.publicKey,
        user: user1.publicKey,
        round: settled12.roundPdaX,
        participant: settled12.participantPdaUser1,
      })
      .rpc();
    await program.methods
      .closeParticipant(roundId12)
      .accounts({
        payer: admin.publicKey,
        user: user2.publicKey,
        round: settled12.roundPdaX,
        participant: settled12.participantPdaUser2,
      })
      .rpc();
    await program.methods
      .closeRound(roundId12)
      .accounts({
        payer: admin.publicKey,
        recipient: admin.publicKey,
        round: settled12.roundPdaX,
        vaultUsdcAta: settled12.vaultAtaX,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  // =========================================================================
  // Summary
  // =========================================================================

  it("summary", () => {
    console.log("\n=== Test Summary ===");
    console.log("  init_config ............. OK");
    console.log("  start_round ............. OK");
    console.log("  deposit_any (x3) ........ OK");
    console.log("  lock_round (timer) ...... OK");
    console.log("  mock_settle ............. OK");
    console.log("  claim (happy path) ...... OK");
    console.log("  Neg: early lock ......... OK");
    console.log("  Neg: deposit locked ..... OK");
    console.log("  Neg: double lock ........ OK");
    console.log("  Neg: claim early ........ OK");
    console.log("  Neg: min participants ... OK");
    console.log("  force_cancel/refund/cleanup OK");
    console.log("  Neg: double settle ...... OK");
    console.log("  Neg: non-winner claim ... OK");
    console.log("  Neg: double claim ....... OK");
    console.log("  Neg: not-enough tickets . OK");
    console.log("  cancel after expiry ..... OK");
    console.log("  claim_refund edges ...... OK");
    console.log("  Neg: account substitution OK");
    console.log("  claim/cleanup guards .... OK");
    console.log("  VRF reimbursement claim . OK");
    console.log("  auto_claim .............. OK");
    console.log("  auto_claim VRF reimburse  OK");
    console.log("=============================\n");
  });
});
