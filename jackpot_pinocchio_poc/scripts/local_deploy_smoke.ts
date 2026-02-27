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
} from "@solana/spl-token";

const RPC_URL = process.env.PINOCCHIO_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PINOCCHIO_PROGRAM_ID ?? fail("PINOCCHIO_PROGRAM_ID is required"),
);
const KEYPAIR_PATH = process.env.PINOCCHIO_KEYPAIR_PATH ?? fail("PINOCCHIO_KEYPAIR_PATH is required");
const ROUND_ID = Number(process.env.PINOCCHIO_ROUND_ID ?? "1");
const FALLBACK_TIMEOUT_SEC = Number(process.env.PINOCCHIO_FALLBACK_TIMEOUT_SEC ?? "300");

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

type DegenConfigView = {
  executor: PublicKey;
  fallbackTimeoutSec: number;
  bump: number;
};

type RoundLifecycleView = {
  roundId: bigint;
  status: number;
  bump: number;
  startTs: bigint;
  endTs: bigint;
  firstDepositTs: bigint;
  totalUsdc: bigint;
  totalTickets: bigint;
  participantsCount: number;
};

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(KEYPAIR_PATH);
  const admin = payer;
  const executor = payer.publicKey;

  await ensureBalance(connection, payer.publicKey, 2);

  const usdcMint = await createMint(connection, payer, payer.publicKey, null, 6);
  const treasuryAta = (
    await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, admin.publicKey)
  ).address;

  const [configPda, configBump] = PublicKey.findProgramAddressSync([Buffer.from("cfg")], PROGRAM_ID);
  const [degenConfigPda, degenConfigBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("degen_cfg")],
    PROGRAM_ID,
  );
  const roundIdBytes = Buffer.alloc(8);
  roundIdBytes.writeBigUInt64LE(BigInt(ROUND_ID), 0);
  const [roundPda, roundBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), roundIdBytes],
    PROGRAM_ID,
  );
  const vaultAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);

  await sendIx(
    connection,
    payer,
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeInitConfig(usdcMint, treasuryAta, 25, 10_000n, 120, 1, 2n, 1_000_000n),
    }),
  );

  const configData = await getAccountData(connection, configPda);
  const config = decodeConfig(configData);
  assert.equal(configData.length, 162);
  assert.deepEqual(configData.subarray(0, 8), anchorDiscriminator("Config"));
  assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
  assert.equal(config.usdcMint.toBase58(), usdcMint.toBase58());
  assert.equal(config.treasuryAta.toBase58(), treasuryAta.toBase58());
  assert.equal(config.feeBps, 25);
  assert.equal(config.ticketUnit, 10_000n);
  assert.equal(config.roundDurationSec, 120);
  assert.equal(config.minParticipants, 1);
  assert.equal(config.minTotalTickets, 2n);
  assert.equal(config.bump, configBump);
  assert.equal(config.maxDepositPerUser, 1_000_000n);

  await sendIx(
    connection,
    payer,
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: degenConfigPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeUpsertDegenConfig(executor, FALLBACK_TIMEOUT_SEC),
    }),
  );

  const degenData = await getAccountData(connection, degenConfigPda);
  const degenConfig = decodeDegenConfig(degenData);
  assert.equal(degenData.length, 72);
  assert.deepEqual(degenData.subarray(0, 8), anchorDiscriminator("DegenConfig"));
  assert.equal(degenConfig.executor.toBase58(), executor.toBase58());
  assert.equal(degenConfig.fallbackTimeoutSec, FALLBACK_TIMEOUT_SEC);
  assert.equal(degenConfig.bump, degenConfigBump);

  await sendIx(
    connection,
    payer,
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
  );

  const roundData = await getAccountData(connection, roundPda);
  const round = decodeRound(roundData);
  assert.equal(roundData.length, 8_248);
  assert.deepEqual(roundData.subarray(0, 8), anchorDiscriminator("Round"));
  assert.equal(round.roundId, BigInt(ROUND_ID));
  assert.equal(round.status, 0);
  assert.equal(round.bump, roundBump);
  assert.equal(round.totalUsdc, 0n);
  assert.equal(round.totalTickets, 0n);
  assert.equal(round.participantsCount, 0);
  assert.equal(readPubkey(roundData, 48).toBase58(), vaultAta.toBase58());

  const vault = await getAccount(connection, vaultAta);
  assert.equal(vault.owner.toBase58(), roundPda.toBase58());
  assert.equal(vault.mint.toBase58(), usdcMint.toBase58());

  console.log(
    JSON.stringify(
      {
        ok: true,
        rpcUrl: RPC_URL,
        programId: PROGRAM_ID.toBase58(),
        configPda: configPda.toBase58(),
        degenConfigPda: degenConfigPda.toBase58(),
        roundPda: roundPda.toBase58(),
        vaultAta: vaultAta.toBase58(),
        usdcMint: usdcMint.toBase58(),
        treasuryAta: treasuryAta.toBase58(),
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

async function ensureBalance(connection: Connection, pubkey: PublicKey, minSol: number) {
  const lamports = await connection.getBalance(pubkey, "confirmed");
  if (lamports >= minSol * 1_000_000_000) return;

  const sig = await connection.requestAirdrop(pubkey, Math.ceil(minSol * 1_000_000_000));
  await connection.confirmTransaction(sig, "confirmed");
}

async function sendIx(
  connection: Connection,
  payer: Keypair,
  ix: TransactionInstruction,
  computeUnits = 400_000,
) {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ix,
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    skipPreflight: false,
  });
  return sig;
}

async function getAccountData(connection: Connection, pubkey: PublicKey): Promise<Buffer> {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info) throw new Error(`missing account ${pubkey.toBase58()}`);
  return Buffer.from(info.data);
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

function encodeUpsertDegenConfig(executor: PublicKey, fallbackTimeoutSec: number) {
  const data = Buffer.alloc(8 + 32 + 4);
  let offset = 0;
  ixDiscriminator("upsert_degen_config").copy(data, offset);
  offset += 8;
  executor.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt32LE(fallbackTimeoutSec, offset);
  return data;
}

function encodeRoundIdIx(name: string, roundId: number) {
  const data = Buffer.alloc(8 + 8);
  ixDiscriminator(name).copy(data, 0);
  data.writeBigUInt64LE(BigInt(roundId), 8);
  return data;
}

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

function decodeDegenConfig(data: Buffer): DegenConfigView {
  let offset = 8;
  const executor = readPubkey(data, offset);
  offset += 32;
  const fallbackTimeoutSec = data.readUInt32LE(offset);
  offset += 4;
  const bump = data[offset];
  return { executor, fallbackTimeoutSec, bump };
}

function decodeRound(data: Buffer): RoundLifecycleView {
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
  };
}

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32));
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  });
