import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
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

const RPC_URL = process.env.PINOCCHIO_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PINOCCHIO_PROGRAM_ID ?? fail("PINOCCHIO_PROGRAM_ID is required"),
);
const KEYPAIR_PATH = process.env.PINOCCHIO_KEYPAIR_PATH ?? fail("PINOCCHIO_KEYPAIR_PATH is required");
const ROUND_ID = Number(process.env.PINOCCHIO_ROUND_ID ?? "1");

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair(KEYPAIR_PATH);
  const userTwo = Keypair.generate();
  const treasuryOwner = Keypair.generate();

  await ensureBalance(connection, admin.publicKey, 5);
  await ensureBalance(connection, userTwo.publicKey, 2);

  const usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
  const treasuryAta = (
    await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, treasuryOwner.publicKey)
  ).address;
  const userOneAta = (
    await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, admin.publicKey)
  ).address;
  const userTwoAta = (
    await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, userTwo.publicKey)
  ).address;

  await mintTo(connection, admin, usdcMint, userOneAta, admin.publicKey, 10_000);
  await mintTo(connection, admin, usdcMint, userTwoAta, admin.publicKey, 20_000);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("cfg")], PROGRAM_ID);
  const roundPda = getRoundPda(ROUND_ID);
  const participantOnePda = getParticipantPda(roundPda, admin.publicKey);
  const participantTwoPda = getParticipantPda(roundPda, userTwo.publicKey);
  const vaultAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeInitConfig(usdcMint, treasuryAta, 25, 10_000n, 120, 2, 2n, 1_000_000n),
    }),
  ]);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
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

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: participantOnePda, isSigner: false, isWritable: true },
        { pubkey: userOneAta, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeDepositAny(ROUND_ID, 0n, 10_000n),
    }),
  ]);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: userTwo.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: participantTwoPda, isSigner: false, isWritable: true },
        { pubkey: userTwoAta, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeDepositAny(ROUND_ID, 0n, 20_000n),
    }),
  ], [admin, userTwo]);

  const roundAfterDeposits = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterDeposits.status, 0);
  assert.equal(roundAfterDeposits.participantsCount, 2);
  assert.equal(roundAfterDeposits.totalUsdc, 30_000n);
  assert.equal(roundAfterDeposits.totalTickets, 3n);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      data: encodeRoundIdIx("admin_force_cancel", ROUND_ID),
    }),
  ]);

  const roundAfterCancel = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterCancel.status, 5);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: false },
        { pubkey: participantOnePda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: userOneAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdIx("claim_refund", ROUND_ID),
    }),
  ]);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: userTwo.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: false },
        { pubkey: participantTwoPda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: userTwoAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdIx("claim_refund", ROUND_ID),
    }),
  ], [admin, userTwo]);

  const userOneToken = await getAccount(connection, userOneAta);
  const userTwoToken = await getAccount(connection, userTwoAta);
  const vaultAfterRefunds = await getAccount(connection, vaultAta);
  assert.equal(userOneToken.amount, 10_000n);
  assert.equal(userTwoToken.amount, 20_000n);
  assert.equal(vaultAfterRefunds.amount, 0n);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: admin.publicKey, isSigner: false, isWritable: true },
        { pubkey: roundPda, isSigner: false, isWritable: false },
        { pubkey: participantOnePda, isSigner: false, isWritable: true },
      ],
      data: encodeRoundIdIx("close_participant", ROUND_ID),
    }),
  ]);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: userTwo.publicKey, isSigner: false, isWritable: true },
        { pubkey: roundPda, isSigner: false, isWritable: false },
        { pubkey: participantTwoPda, isSigner: false, isWritable: true },
      ],
      data: encodeRoundIdIx("close_participant", ROUND_ID),
    }),
  ]);

  await sendIxs(connection, admin, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: admin.publicKey, isSigner: false, isWritable: true },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdIx("close_round", ROUND_ID),
    }),
  ]);

  assertClosed(await connection.getAccountInfo(participantOnePda, "confirmed"), "participant one");
  assertClosed(await connection.getAccountInfo(participantTwoPda, "confirmed"), "participant two");
  assertClosed(await connection.getAccountInfo(roundPda, "confirmed"), "round");
  assertClosed(await connection.getAccountInfo(vaultAta, "confirmed"), "vault ata");

  console.log(
    JSON.stringify(
      {
        ok: true,
        rpcUrl: RPC_URL,
        programId: PROGRAM_ID.toBase58(),
        configPda: configPda.toBase58(),
        roundPda: roundPda.toBase58(),
        participantOnePda: participantOnePda.toBase58(),
        participantTwoPda: participantTwoPda.toBase58(),
        vaultAta: vaultAta.toBase58(),
        userOneAta: userOneAta.toBase58(),
        userTwoAta: userTwoAta.toBase58(),
        roundId: ROUND_ID,
      },
      null,
      2,
    ),
  );
}

function fail(message: string): never {
  throw new Error(message);
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function getRoundPda(roundId: number): PublicKey {
  const roundIdBytes = Buffer.alloc(8);
  roundIdBytes.writeBigUInt64LE(BigInt(roundId), 0);
  return PublicKey.findProgramAddressSync([Buffer.from("round"), roundIdBytes], PROGRAM_ID)[0];
}

function getParticipantPda(round: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("p"), round.toBuffer(), user.toBuffer()], PROGRAM_ID)[0];
}

async function ensureBalance(connection: Connection, pubkey: PublicKey, minSol: number) {
  const lamports = await connection.getBalance(pubkey, "confirmed");
  if (lamports >= minSol * 1_000_000_000) return;
  const sig = await connection.requestAirdrop(pubkey, Math.ceil(minSol * 1_000_000_000));
  await connection.confirmTransaction(sig, "confirmed");
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

function assertClosed(info: Awaited<ReturnType<Connection["getAccountInfo"]>>, label: string) {
  if (info === null) return;
  assert.equal(info.lamports, 0, `${label} should be closed`);
}

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
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

function decodeRound(data: Buffer) {
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
  return { roundId, status, bump, startTs, endTs, firstDepositTs, totalUsdc, totalTickets, participantsCount };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
