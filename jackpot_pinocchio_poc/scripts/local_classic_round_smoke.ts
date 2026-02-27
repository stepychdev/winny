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

const RPC_URL = process.env.PINOCCHIO_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PINOCCHIO_PROGRAM_ID ?? fail("PINOCCHIO_PROGRAM_ID is required"),
);
const KEYPAIR_PATH = process.env.PINOCCHIO_KEYPAIR_PATH ?? fail("PINOCCHIO_KEYPAIR_PATH is required");
const VRF_IDENTITY_KEYPAIR_PATH =
  process.env.PINOCCHIO_VRF_IDENTITY_KEYPAIR_PATH ?? fail("PINOCCHIO_VRF_IDENTITY_KEYPAIR_PATH is required");
const VRF_PROGRAM_ID = new PublicKey(
  process.env.PINOCCHIO_VRF_PROGRAM_ID ?? fail("PINOCCHIO_VRF_PROGRAM_ID is required"),
);
const VRF_QUEUE_PUBKEY = new PublicKey(
  process.env.PINOCCHIO_VRF_QUEUE_PUBKEY ?? fail("PINOCCHIO_VRF_QUEUE_PUBKEY is required"),
);
const ROUND_ID = Number(process.env.PINOCCHIO_ROUND_ID ?? "1");
const DEPOSIT_RAW = BigInt(process.env.PINOCCHIO_DEPOSIT_RAW ?? "20000");
const RANDOMNESS_HEX =
  process.env.PINOCCHIO_VRF_RANDOMNESS_HEX ?? "0000000000000000000000000000000000000000000000000000000000000000";

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
  winner: PublicKey;
  winningTicket: bigint;
};

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(KEYPAIR_PATH);
  const vrfIdentity = loadKeypair(VRF_IDENTITY_KEYPAIR_PATH);

  await ensureBalance(connection, payer.publicKey, 5);
  await ensureBalance(connection, vrfIdentity.publicKey, 1, payer);
  await ensureSystemRecipient(connection, payer, VRF_QUEUE_PUBKEY, 1_000_000);

  // Allow reuse of existing mint on devnet via env vars
  const usdcMint = process.env.PINOCCHIO_USDC_MINT
    ? new PublicKey(process.env.PINOCCHIO_USDC_MINT)
    : await createMint(connection, payer, payer.publicKey, null, 6);

  // Determine treasury ATA: use config-stored value if config already exists, else create new
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("cfg")], PROGRAM_ID);
  const existingConfigInfo = await connection.getAccountInfo(configPda, "confirmed");
  const configAlreadyInit = existingConfigInfo && existingConfigInfo.owner.equals(PROGRAM_ID) && !existingConfigInfo.data.every((b: number) => b === 0);
  let treasuryAta: PublicKey;
  if (configAlreadyInit) {
    const existingConfig = decodeConfig(existingConfigInfo!.data as Buffer);
    treasuryAta = existingConfig.treasuryAta;
    console.log(`Reusing existing treasury ATA from config: ${treasuryAta.toBase58()}`);
  } else {
    const treasuryOwner = Keypair.generate();
    treasuryAta = process.env.PINOCCHIO_TREASURY_ATA
      ? new PublicKey(process.env.PINOCCHIO_TREASURY_ATA)
      : (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, treasuryOwner.publicKey)).address;
  }
  const userAta = (
    await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey)
  ).address;

  // Record balance before minting (may be non-zero on devnet re-runs)
  const preMintBalance = BigInt((await getAccount(connection, userAta)).amount);
  await mintTo(connection, payer, usdcMint, userAta, payer.publicKey, Number(DEPOSIT_RAW));

  const [programIdentityPda] = PublicKey.findProgramAddressSync([Buffer.from("identity")], PROGRAM_ID);
  const [participantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("p"), getRoundPda(ROUND_ID).toBuffer(), payer.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const roundPda = getRoundPda(ROUND_ID);
  const vaultAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);

  await ensureSystemRecipient(connection, payer, programIdentityPda, 1_000_000);

  // Idempotent init: skip init_config if config PDA is already initialized
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
        data: encodeInitConfig(usdcMint, treasuryAta, 25, 10_000n, 1, 1, 2n, 100_000_000n),
      }),
    ]);
  } else {
    console.log("Config PDA already initialized, skipping init_config");
  }

  const configData = await getAccountData(connection, configPda);
  const config = decodeConfig(configData);
  assert.equal(config.minParticipants, 1);
  assert.equal(config.roundDurationSec, 1);

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

  await sendIxs(connection, payer, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: participantPda, isSigner: false, isWritable: true },
        { pubkey: userAta, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeDepositAny(ROUND_ID, preMintBalance, DEPOSIT_RAW),
    }),
  ]);

  const roundAfterDeposit = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterDeposit.status, 0);
  assert.equal(roundAfterDeposit.totalUsdc, DEPOSIT_RAW);
  assert.equal(roundAfterDeposit.totalTickets, 2n);
  assert.equal(roundAfterDeposit.participantsCount, 1);

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

  const roundAfterLock = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterLock.status, 1);

  await sendIxs(connection, payer, [
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
  ], [payer], 500_000);

  const roundAfterRequest = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterRequest.status, 2);

  const randomness = Buffer.from(RANDOMNESS_HEX, "hex");
  if (randomness.length !== 32) {
    throw new Error("PINOCCHIO_VRF_RANDOMNESS_HEX must be 32-byte hex");
  }

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

  await sleep(2_000); // Devnet confirmation propagation delay
  const roundAfterSettle = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterSettle.status, 3);
  assert.equal(roundAfterSettle.winner.toBase58(), payer.publicKey.toBase58());
  assert.equal(roundAfterSettle.winningTicket, 1n);

  // Record balances before claim for delta assertions (devnet may have pre-existing balances)
  const userPreClaim = BigInt((await getAccount(connection, userAta)).amount);
  const treasuryPreClaim = BigInt((await getAccount(connection, treasuryAta)).amount);

  await sendIxs(connection, payer, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: userAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdIx("claim", ROUND_ID),
    }),
  ]);

  const roundAfterClaim = decodeRound(await getAccountData(connection, roundPda));
  assert.equal(roundAfterClaim.status, 4);

  const userToken = await getAccount(connection, userAta);
  const treasuryToken = await getAccount(connection, treasuryAta);
  const vaultToken = await getAccount(connection, vaultAta);

  const payoutRaw = BigInt(userToken.amount) - userPreClaim;
  const treasuryFeeRaw = BigInt(treasuryToken.amount) - treasuryPreClaim;
  assert.equal(payoutRaw, 19_950n);
  assert.equal(treasuryFeeRaw, 50n);
  assert.equal(vaultToken.amount, 0n);

  console.log(
    JSON.stringify(
      {
        ok: true,
        rpcUrl: RPC_URL,
        programId: PROGRAM_ID.toBase58(),
        vrfProgramId: VRF_PROGRAM_ID.toBase58(),
        vrfIdentity: vrfIdentity.publicKey.toBase58(),
        vrfQueue: VRF_QUEUE_PUBKEY.toBase58(),
        configPda: configPda.toBase58(),
        roundPda: roundPda.toBase58(),
        participantPda: participantPda.toBase58(),
        vaultAta: vaultAta.toBase58(),
        userAta: userAta.toBase58(),
        treasuryAta: treasuryAta.toBase58(),
        roundId: ROUND_ID,
        winner: roundAfterSettle.winner.toBase58(),
        payoutRaw: payoutRaw.toString(),
        treasuryFeeRaw: treasuryFeeRaw.toString(),
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

async function ensureBalance(connection: Connection, pubkey: PublicKey, minSol: number, funder?: Keypair) {
  const lamports = await connection.getBalance(pubkey, "confirmed");
  if (lamports >= minSol * 1_000_000_000) return;
  const needed = Math.ceil(minSol * 1_000_000_000) - lamports;
  if (funder && funder.publicKey.toBase58() !== pubkey.toBase58()) {
    // Use transfer from funder (works on devnet without rate limits)
    await sendIxs(connection, funder, [
      SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: pubkey, lamports: needed }),
    ]);
    return;
  }
  try {
    const sig = await connection.requestAirdrop(pubkey, needed);
    await connection.confirmTransaction(sig, "confirmed");
  } catch {
    // Airdrop may fail on devnet due to rate limits — caller should ensure funder is provided
    throw new Error(`Airdrop failed for ${pubkey.toBase58()}; pass funder keypair on devnet`);
  }
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
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports,
    }),
  ]);
}

async function waitUntilRoundEnded(connection: Connection, roundPda: PublicKey) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const round = decodeRound(await getAccountData(connection, roundPda));
    const slot = await connection.getSlot("confirmed");
    const blockTime = await connection.getBlockTime(slot);
    const now = blockTime ?? Math.floor(Date.now() / 1000);
    if (now >= Number(round.endTs)) {
      return;
    }
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

function encodeVrfCallback(randomness: Buffer) {
  const data = Buffer.alloc(8 + 32);
  ixDiscriminator("vrf_callback").copy(data, 0);
  randomness.copy(data, 8);
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
