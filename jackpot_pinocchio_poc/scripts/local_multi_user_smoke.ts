import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

// ---------------------------------------------------------------------------
// Multi-user classic round smoke: 3 depositors, Fenwick-tree winner selection
// ---------------------------------------------------------------------------

const RPC_URL = process.env.PINOCCHIO_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PINOCCHIO_PROGRAM_ID ?? fail("PINOCCHIO_PROGRAM_ID is required"),
);
const KEYPAIR_PATH =
  process.env.PINOCCHIO_KEYPAIR_PATH ?? fail("PINOCCHIO_KEYPAIR_PATH is required");
const VRF_IDENTITY_KEYPAIR_PATH =
  process.env.PINOCCHIO_VRF_IDENTITY_KEYPAIR_PATH ??
  fail("PINOCCHIO_VRF_IDENTITY_KEYPAIR_PATH is required");
const VRF_PROGRAM_ID = new PublicKey(
  process.env.PINOCCHIO_VRF_PROGRAM_ID ?? fail("PINOCCHIO_VRF_PROGRAM_ID is required"),
);
const VRF_QUEUE_PUBKEY = new PublicKey(
  process.env.PINOCCHIO_VRF_QUEUE_PUBKEY ?? fail("PINOCCHIO_VRF_QUEUE_PUBKEY is required"),
);

const ROUND_ID = Number(process.env.PINOCCHIO_ROUND_ID ?? "1");
const TICKET_UNIT = 10_000n;
const FEE_BPS = 25;

// Three users with different deposit amounts — total = 100_000 → 10 tickets
const DEPOSIT_A = 30_000n; // 3 tickets  → participant[0], ticket range [1, 3]
const DEPOSIT_B = 20_000n; // 2 tickets  → participant[1], ticket range [4, 5]
const DEPOSIT_C = 50_000n; // 5 tickets  → participant[2], ticket range [6, 10]
const TOTAL_DEPOSIT = DEPOSIT_A + DEPOSIT_B + DEPOSIT_C;
const TOTAL_TICKETS = 10n;

// Randomness all-zeros → winning_ticket = (0 % 10) + 1 = 1 → participant[0] (User A)
const RANDOMNESS_HEX =
  "0000000000000000000000000000000000000000000000000000000000000000";

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(KEYPAIR_PATH);
  const vrfIdentity = loadKeypair(VRF_IDENTITY_KEYPAIR_PATH);

  // User A = payer, Users B & C are generated fresh
  const userB = Keypair.generate();
  const userC = Keypair.generate();
  console.log(`User A (payer):    ${payer.publicKey.toBase58()}`);
  console.log(`User B (generated): ${userB.publicKey.toBase58()}`);
  console.log(`User C (generated): ${userC.publicKey.toBase58()}`);

  // Fund everyone
  await ensureBalance(connection, payer.publicKey, 10);
  await ensureBalance(connection, vrfIdentity.publicKey, 1, payer);
  await fundKeypair(connection, payer, userB, 2);
  await fundKeypair(connection, payer, userC, 2);
  await ensureSystemRecipient(connection, payer, VRF_QUEUE_PUBKEY, 1_000_000);

  const usdcMint = process.env.PINOCCHIO_USDC_MINT
    ? new PublicKey(process.env.PINOCCHIO_USDC_MINT)
    : await createMint(connection, payer, payer.publicKey, null, 6);

  // Config PDA
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("cfg")], PROGRAM_ID);
  const [programIdentityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    PROGRAM_ID,
  );
  await ensureSystemRecipient(connection, payer, programIdentityPda, 1_000_000);

  // Treasury
  const existingConfigInfo = await connection.getAccountInfo(configPda, "confirmed");
  const configAlreadyInit =
    existingConfigInfo &&
    existingConfigInfo.owner.equals(PROGRAM_ID) &&
    !existingConfigInfo.data.every((b: number) => b === 0);
  let treasuryAta: PublicKey;
  if (configAlreadyInit) {
    treasuryAta = decodeConfig(existingConfigInfo!.data as Buffer).treasuryAta;
  } else {
    const treasuryOwner = Keypair.generate();
    treasuryAta = (
      await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, treasuryOwner.publicKey)
    ).address;
  }

  // Create ATAs and mint USDC to each user
  const ataA = (
    await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey)
  ).address;
  const ataB = (
    await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, userB.publicKey)
  ).address;
  const ataC = (
    await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, userC.publicKey)
  ).address;

  const preBalA = BigInt((await getAccount(connection, ataA)).amount);
  const preBalB = BigInt((await getAccount(connection, ataB)).amount);
  const preBalC = BigInt((await getAccount(connection, ataC)).amount);

  await mintTo(connection, payer, usdcMint, ataA, payer.publicKey, Number(DEPOSIT_A));
  await mintTo(connection, payer, usdcMint, ataB, payer.publicKey, Number(DEPOSIT_B));
  await mintTo(connection, payer, usdcMint, ataC, payer.publicKey, Number(DEPOSIT_C));

  // Init config: min_participants=2, round_duration=1s
  if (!configAlreadyInit) {
    await sendIxs(connection, payer, [
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInitConfig(usdcMint, treasuryAta, FEE_BPS, TICKET_UNIT, 10, 2, 2n, 100_000_000n),
      }),
    ]);
  }

  // Round and vault
  const roundPda = getRoundPda(ROUND_ID);
  const vaultAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);

  // Participant PDAs
  const [partPdaA] = PublicKey.findProgramAddressSync(
    [Buffer.from("p"), roundPda.toBuffer(), payer.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [partPdaB] = PublicKey.findProgramAddressSync(
    [Buffer.from("p"), roundPda.toBuffer(), userB.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [partPdaC] = PublicKey.findProgramAddressSync(
    [Buffer.from("p"), roundPda.toBuffer(), userC.publicKey.toBuffer()],
    PROGRAM_ID,
  );

  // ==== Start round ====
  await sendIxs(connection, payer, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdIx("start_round", ROUND_ID),
    }),
  ]);
  console.log("Round started");

  // ==== Deposit A (payer) — 30_000 ====
  await sendIxs(connection, payer, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: partPdaA, isSigner: false, isWritable: true },
        { pubkey: ataA, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeDepositAny(ROUND_ID, preBalA, DEPOSIT_A),
    }),
  ]);
  console.log("User A deposited 30_000");

  // ==== Deposit B (userB) — 20_000 ====
  await sendIxs(
    connection,
    userB,
    [
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: userB.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: roundPda, isSigner: false, isWritable: true },
          { pubkey: partPdaB, isSigner: false, isWritable: true },
          { pubkey: ataB, isSigner: false, isWritable: true },
          { pubkey: vaultAta, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeDepositAny(ROUND_ID, preBalB, DEPOSIT_B),
      }),
    ],
    [userB],
  );
  console.log("User B deposited 20_000");

  // ==== Deposit C (userC) — 50_000 ====
  await sendIxs(
    connection,
    userC,
    [
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: userC.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: roundPda, isSigner: false, isWritable: true },
          { pubkey: partPdaC, isSigner: false, isWritable: true },
          { pubkey: ataC, isSigner: false, isWritable: true },
          { pubkey: vaultAta, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeDepositAny(ROUND_ID, preBalC, DEPOSIT_C),
      }),
    ],
    [userC],
  );
  console.log("User C deposited 50_000");

  // ==== Verify round state after all deposits ====
  const roundAfterDeposit = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterDeposit.totalUsdc, TOTAL_DEPOSIT);
  assert.equal(roundAfterDeposit.totalTickets, TOTAL_TICKETS);
  assert.equal(roundAfterDeposit.participantsCount, 3);
  console.log("All 3 deposits verified");

  // ==== Wait, lock, request VRF, callback ====
  await waitUntilRoundEnded(connection, roundPda);

  await sendIxs(connection, payer, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      data: encodeRoundIdIx("lock_round", ROUND_ID),
    }),
  ]);
  console.log("Round locked");

  await sendIxs(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: roundPda, isSigner: false, isWritable: true },
          { pubkey: programIdentityPda, isSigner: false, isWritable: false },
          { pubkey: VRF_QUEUE_PUBKEY, isSigner: false, isWritable: true },
          { pubkey: VRF_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeRoundIdIx("request_vrf", ROUND_ID),
      }),
    ],
    [payer],
    500_000,
  );
  console.log("VRF requested");

  const randomness = Buffer.from(RANDOMNESS_HEX, "hex");
  assert.equal(randomness.length, 32);

  await sendIxs(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: vrfIdentity.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: roundPda, isSigner: false, isWritable: true },
        ],
        data: encodeVrfCallback(randomness),
      }),
    ],
    [payer, vrfIdentity],
  );
  console.log("VRF callback delivered");

  await sleep(2_000);
  const roundAfterSettle = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterSettle.status, 3); // Settled
  assert.equal(roundAfterSettle.winningTicket, 1n); // (0 % 10) + 1 = 1

  // Winner should be User A (participant[0] owns tickets 1-3)
  assert.equal(
    roundAfterSettle.winner.toBase58(),
    payer.publicKey.toBase58(),
    "User A should be the winner (ticket #1 in range [1,3])",
  );
  console.log(`Winner = User A (${payer.publicKey.toBase58()}), winningTicket = ${roundAfterSettle.winningTicket}`);

  // ==== Try claim as User B (should fail) ====
  let wrongClaimFailed = false;
  try {
    await sendIxs(
      connection,
      userB,
      [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: userB.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: roundPda, isSigner: false, isWritable: true },
            { pubkey: vaultAta, isSigner: false, isWritable: true },
            { pubkey: ataB, isSigner: false, isWritable: true },
            { pubkey: treasuryAta, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: encodeRoundIdIx("claim", ROUND_ID),
        }),
      ],
      [userB],
    );
  } catch {
    wrongClaimFailed = true;
  }
  assert.ok(wrongClaimFailed, "Non-winner (User B) should NOT be able to claim");
  console.log("User B claim correctly rejected");

  // ==== Claim as User A (the real winner) ====
  const aPreClaim = BigInt((await getAccount(connection, ataA)).amount);
  const treasuryPreClaim = BigInt((await getAccount(connection, treasuryAta)).amount);

  await sendIxs(connection, payer, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: ataA, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdIx("claim", ROUND_ID),
    }),
  ]);
  console.log("User A claimed");

  // ==== Verify final state ====
  const roundAfterClaim = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterClaim.status, 4); // Claimed

  const aPostClaim = BigInt((await getAccount(connection, ataA)).amount);
  const treasuryPostClaim = BigInt((await getAccount(connection, treasuryAta)).amount);
  const vaultPost = BigInt((await getAccount(connection, vaultAta)).amount);

  const payoutRaw = aPostClaim - aPreClaim;
  const treasuryFeeRaw = treasuryPostClaim - treasuryPreClaim;
  const expectedFee = (TOTAL_DEPOSIT * BigInt(FEE_BPS)) / 10_000n; // 250
  const expectedPayout = TOTAL_DEPOSIT - expectedFee; // 99_750

  assert.equal(payoutRaw, expectedPayout, `payout should be ${expectedPayout}`);
  assert.equal(treasuryFeeRaw, expectedFee, `fee should be ${expectedFee}`);
  assert.equal(vaultPost, 0n, "vault should be empty");

  console.log(
    JSON.stringify(
      {
        ok: true,
        rpcUrl: RPC_URL,
        programId: PROGRAM_ID.toBase58(),
        participants: 3,
        depositA: DEPOSIT_A.toString(),
        depositB: DEPOSIT_B.toString(),
        depositC: DEPOSIT_C.toString(),
        totalDeposit: TOTAL_DEPOSIT.toString(),
        totalTickets: TOTAL_TICKETS.toString(),
        winningTicket: roundAfterSettle.winningTicket.toString(),
        winner: roundAfterSettle.winner.toBase58(),
        payoutRaw: payoutRaw.toString(),
        treasuryFeeRaw: treasuryFeeRaw.toString(),
      },
      null,
      2,
    ),
  );
}

// ============================================================================
// Helpers (shared with other smoke scripts)
// ============================================================================

function fail(message: string): never {
  throw new Error(message);
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

function getRoundPda(roundId: number): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(roundId), 0);
  return PublicKey.findProgramAddressSync([Buffer.from("round"), buf], PROGRAM_ID)[0];
}

async function ensureBalance(
  connection: Connection,
  pubkey: PublicKey,
  minSol: number,
  funder?: Keypair,
) {
  const lamports = await connection.getBalance(pubkey, "confirmed");
  if (lamports >= minSol * 1_000_000_000) return;
  const needed = Math.ceil(minSol * 1_000_000_000) - lamports;
  if (funder && funder.publicKey.toBase58() !== pubkey.toBase58()) {
    await sendIxs(connection, funder, [
      SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: pubkey, lamports: needed }),
    ]);
    return;
  }
  try {
    const sig = await connection.requestAirdrop(pubkey, needed);
    await connection.confirmTransaction(sig, "confirmed");
  } catch {
    throw new Error(`Airdrop failed for ${pubkey.toBase58()}`);
  }
}

async function fundKeypair(
  connection: Connection,
  funder: Keypair,
  target: Keypair,
  solAmount: number,
) {
  await sendIxs(connection, funder, [
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: target.publicKey,
      lamports: solAmount * 1_000_000_000,
    }),
  ]);
}

async function ensureSystemRecipient(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  lamports: number,
) {
  const info = await connection.getAccountInfo(recipient, "confirmed");
  if (info) return;
  await sendIxs(connection, payer, [
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports }),
  ]);
}

async function waitUntilRoundEnded(connection: Connection, roundPda: PublicKey) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const round = decodeRound(await getAccountData(connection, roundPda));
    const slot = await connection.getSlot("confirmed");
    const blockTime = await connection.getBlockTime(slot);
    const now = blockTime ?? Math.floor(Date.now() / 1000);
    if (now >= Number(round.endTs)) return;
    await sleep(1_000);
  }
  throw new Error("round did not reach end_ts in time");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendIxs(
  connection: Connection,
  feePayer: Keypair,
  ixs: TransactionInstruction[],
  signers: Keypair[] = [feePayer],
  computeUnits = 500_000,
) {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ...ixs,
  );
  return sendAndConfirmTransaction(connection, tx, signers, {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

async function getAccountData(connection: Connection, pubkey: PublicKey): Promise<Buffer> {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info) throw new Error(`missing account ${pubkey.toBase58()}`);
  return Buffer.from(info.data);
}

function ixDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeInitConfig(
  usdcMint: PublicKey,
  treasuryAta: PublicKey,
  feeBps: number,
  ticketUnit: bigint,
  roundDurationSec: number,
  minParticipants: number,
  minTotalTickets: bigint,
  maxDepositPerUser: bigint,
) {
  const data = Buffer.alloc(8 + 32 + 32 + 2 + 8 + 4 + 2 + 8 + 8);
  let offset = 0;
  ixDiscriminator("init_config").copy(data, offset);
  offset += 8;
  usdcMint.toBuffer().copy(data, offset);
  offset += 32;
  treasuryAta.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt16LE(feeBps, offset);
  offset += 2;
  data.writeBigUInt64LE(ticketUnit, offset);
  offset += 8;
  data.writeUInt32LE(roundDurationSec, offset);
  offset += 4;
  data.writeUInt16LE(minParticipants, offset);
  offset += 2;
  data.writeBigUInt64LE(minTotalTickets, offset);
  offset += 8;
  data.writeBigUInt64LE(maxDepositPerUser, offset);
  return data;
}

function encodeRoundIdIx(name: string, roundId: number) {
  const data = Buffer.alloc(8 + 8);
  ixDiscriminator(name).copy(data, 0);
  data.writeBigUInt64LE(BigInt(roundId), 8);
  return data;
}

function encodeDepositAny(roundId: number, usdcBalanceBefore: bigint, minOut: bigint) {
  const data = Buffer.alloc(8 + 8 + 8 + 8);
  let offset = 0;
  ixDiscriminator("deposit_any").copy(data, offset);
  offset += 8;
  data.writeBigUInt64LE(BigInt(roundId), offset);
  offset += 8;
  data.writeBigUInt64LE(usdcBalanceBefore, offset);
  offset += 8;
  data.writeBigUInt64LE(minOut, offset);
  return data;
}

function encodeVrfCallback(randomness: Buffer) {
  const data = Buffer.alloc(8 + 32);
  ixDiscriminator("vrf_callback").copy(data, 0);
  randomness.copy(data, 8);
  return data;
}

type ConfigView = {
  admin: PublicKey;
  usdcMint: PublicKey;
  treasuryAta: PublicKey;
  feeBps: number;
  ticketUnit: bigint;
  roundDurationSec: number;
  minParticipants: number;
  minTotalTickets: bigint;
  paused: boolean;
  bump: number;
  maxDepositPerUser: bigint;
};

function decodeConfig(data: Buffer): ConfigView {
  let offset = 8;
  const admin = readPubkey(data, offset);
  offset += 32;
  const usdcMint = readPubkey(data, offset);
  offset += 32;
  const treasuryAta = readPubkey(data, offset);
  offset += 32;
  const feeBps = data.readUInt16LE(offset);
  offset += 2;
  const ticketUnit = data.readBigUInt64LE(offset);
  offset += 8;
  const roundDurationSec = data.readUInt32LE(offset);
  offset += 4;
  const minParticipants = data.readUInt16LE(offset);
  offset += 2;
  const minTotalTickets = data.readBigUInt64LE(offset);
  offset += 8;
  const paused = data[offset] !== 0;
  offset += 1;
  const bump = data[offset];
  offset += 1;
  const maxDepositPerUser = data.readBigUInt64LE(offset);
  return {
    admin,
    usdcMint,
    treasuryAta,
    feeBps,
    ticketUnit,
    roundDurationSec,
    minParticipants,
    minTotalTickets,
    paused,
    bump,
    maxDepositPerUser,
  };
}

type RoundView = {
  roundId: bigint;
  status: number;
  bump: number;
  startTs: bigint;
  endTs: bigint;
  firstDepositTs: bigint;
  totalUsdc: bigint;
  totalTickets: bigint;
  participantsCount: number;
  winner: PublicKey;
  winningTicket: bigint;
};

function decodeRound(data: Buffer): RoundView {
  let offset = 8;
  const roundId = data.readBigUInt64LE(offset);
  offset += 8;
  const status = data[offset];
  offset += 1;
  const bump = data[offset];
  offset += 1;
  offset += 6;
  const startTs = data.readBigInt64LE(offset);
  offset += 8;
  const endTs = data.readBigInt64LE(offset);
  offset += 8;
  const firstDepositTs = data.readBigInt64LE(offset);
  offset += 8;
  offset += 32;
  const totalUsdc = data.readBigUInt64LE(offset);
  offset += 8;
  const totalTickets = data.readBigUInt64LE(offset);
  offset += 8;
  const participantsCount = data.readUInt16LE(offset);
  offset = 8 + 136;
  const winner = readPubkey(data, offset);
  offset = 8 + 128;
  const winningTicket = data.readBigUInt64LE(offset);
  return {
    roundId,
    status,
    bump,
    startTs,
    endTs,
    firstDepositTs,
    totalUsdc,
    totalTickets,
    participantsCount,
    winner,
    winningTicket,
  };
}

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
