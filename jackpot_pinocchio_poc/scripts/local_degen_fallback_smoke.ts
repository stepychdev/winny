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
const ROUND_ID = Number(process.env.PINOCCHIO_ROUND_ID ?? "81");
const DEPOSIT_RAW = BigInt(process.env.PINOCCHIO_DEPOSIT_RAW ?? "10000000");
const RANDOMNESS_HEX =
  process.env.PINOCCHIO_DEGEN_RANDOMNESS_HEX ?? "1111111111111111111111111111111111111111111111111111111111111111";
const FALLBACK_TIMEOUT_SEC = Number(process.env.PINOCCHIO_DEGEN_FALLBACK_TIMEOUT_SEC ?? "1");
const FALLBACK_REASON = Number(process.env.PINOCCHIO_DEGEN_FALLBACK_REASON ?? "9");

type RoundView = {
  roundId: bigint;
  status: number;
  endTs: bigint;
  totalUsdc: bigint;
  totalTickets: bigint;
  participantsCount: number;
  winner: PublicKey;
  degenMode: number;
  vrfPayer: PublicKey;
};

type DegenClaimView = {
  status: number;
  round: PublicKey;
  winner: PublicKey;
  roundId: bigint;
  fallbackAfterTs: bigint;
  payoutRaw: bigint;
  claimedAt: bigint;
  fallbackReason: number;
  randomness: Buffer;
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

  const [degenConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("degen_cfg")], PROGRAM_ID);
  const [programIdentityPda] = PublicKey.findProgramAddressSync([Buffer.from("identity")], PROGRAM_ID);
  const roundPda = getRoundPda(ROUND_ID);
  const participantPda = getParticipantPda(roundPda, payer.publicKey);
  const [degenClaimPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("degen_claim"), u64Bytes(ROUND_ID), payer.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const vaultAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);
  // winner == vrfPayer: payer's ATA serves both roles (tests the double-borrow fix)
  const vrfRequesterAta = userAta;

  await ensureSystemRecipient(connection, payer, programIdentityPda, 1_000_000);
  await ensureSystemRecipient(connection, payer, degenClaimPda, 1_000_000);

  // Idempotent init: skip init_config/degen_config if config PDA already initialized
  const initIxs: TransactionInstruction[] = [];
  if (!configAlreadyInit) {
    initIxs.push(
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
    );
  } else {
    console.log("Config PDA already initialized, skipping init_config");
  }

  // Upsert degen config (idempotent — always safe to call)
  const degenConfigInfo = await connection.getAccountInfo(degenConfigPda, "confirmed");
  const needsDegenConfig = !degenConfigInfo || !degenConfigInfo.owner.equals(PROGRAM_ID);
  if (needsDegenConfig || !configAlreadyInit) {
    initIxs.push(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: degenConfigPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeUpsertDegenConfig(payer.publicKey, FALLBACK_TIMEOUT_SEC),
      }),
    );
  }

  initIxs.push(
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

  await sendIxs(connection, payer, initIxs);

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

  const randomness = Buffer.from(RANDOMNESS_HEX, "hex");
  if (randomness.length !== 32) {
    throw new Error("PINOCCHIO_DEGEN_RANDOMNESS_HEX must be 32-byte hex");
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

  await sendIxs(connection, payer, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: degenClaimPda, isSigner: false, isWritable: true },
        { pubkey: programIdentityPda, isSigner: false, isWritable: false },
        { pubkey: VRF_QUEUE_PUBKEY, isSigner: false, isWritable: true },
        { pubkey: VRF_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdIx("request_degen_vrf", ROUND_ID),
    }),
  ], [payer], 600_000);

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
          { pubkey: degenClaimPda, isSigner: false, isWritable: true },
          { pubkey: degenConfigPda, isSigner: false, isWritable: false },
        ],
        data: encodeDegenVrfCallback(randomness),
      }),
    ],
    [payer, vrfIdentity],
  );

  const degenReady = decodeDegenClaim(await getAccountData(connection, degenClaimPda));
  assert.equal(degenReady.status, 2);
  assert.equal(degenReady.round.toBase58(), roundPda.toBase58());
  assert.equal(degenReady.winner.toBase58(), payer.publicKey.toBase58());
  assert.equal(degenReady.roundId, BigInt(ROUND_ID));
  assert.deepEqual(degenReady.randomness, randomness);
  // payout = total(10M) - vrfReimburse(200k) - fee(24.5k) = 9_775_500
  assert.equal(degenReady.payoutRaw, 9_775_500n);

  await sleep((FALLBACK_TIMEOUT_SEC + 1) * 1_000);

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
        { pubkey: degenClaimPda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: userAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: false, isWritable: false },
        { pubkey: userAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeRoundIdU8Ix("claim_degen_fallback", ROUND_ID, FALLBACK_REASON),
    }),
  ]);

  const roundAfterFallback = decodeRound(await getAccountData(connection, roundPda));
  const degenAfterFallback = decodeDegenClaim(await getAccountData(connection, degenClaimPda));
  const userToken = await getAccount(connection, userAta);
  const treasuryToken = await getAccount(connection, treasuryAta);
  const vaultToken = await getAccount(connection, vaultAta);

  assert.equal(roundAfterFallback.status, 4);
  assert.equal(roundAfterFallback.degenMode, 4);
  assert.equal(degenAfterFallback.status, 5); // CLAIMED_FALLBACK = 5
  assert.equal(degenAfterFallback.payoutRaw, 9_775_500n);
  assert.equal(Number(degenAfterFallback.fallbackReason), FALLBACK_REASON);
  assert.ok(degenAfterFallback.claimedAt > 0n);

  // winner == vrfPayer: user ATA receives payout + vrf_reimburse combined
  const userDelta = BigInt(userToken.amount) - userPreClaim;
  const treasuryDelta = BigInt(treasuryToken.amount) - treasuryPreClaim;
  assert.equal(userDelta, 9_975_500n, "winner should get payout(9_775_500) + vrfReimburse(200_000)");
  assert.equal(treasuryDelta, 24_500n);
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
        degenConfigPda: degenConfigPda.toBase58(),
        roundPda: roundPda.toBase58(),
        degenClaimPda: degenClaimPda.toBase58(),
        participantPda: participantPda.toBase58(),
        vaultAta: vaultAta.toBase58(),
        userAta: userAta.toBase58(),
        treasuryAta: treasuryAta.toBase58(),
        roundId: ROUND_ID,
        payoutRaw: degenAfterFallback.payoutRaw.toString(),
        fallbackReason: degenAfterFallback.fallbackReason,
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
  return PublicKey.findProgramAddressSync([Buffer.from("round"), u64Bytes(roundId)], PROGRAM_ID)[0];
}

function getParticipantPda(round: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("p"), round.toBuffer(), user.toBuffer()], PROGRAM_ID)[0];
}

function u64Bytes(value: number) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value), 0);
  return data;
}

async function ensureBalance(connection: Connection, pubkey: PublicKey, minSol: number, funder?: Keypair) {
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
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports }),
  ]);
}

async function waitUntilRoundEnded(connection: Connection, roundPda: PublicKey) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
  computeUnits = 600_000,
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

function encodeUpsertDegenConfig(executor: PublicKey, fallbackTimeoutSec: number) {
  const data = Buffer.alloc(8 + 32 + 4);
  ixDiscriminator("upsert_degen_config").copy(data, 0);
  executor.toBuffer().copy(data, 8);
  data.writeUInt32LE(fallbackTimeoutSec, 40);
  return data;
}

function encodeRoundIdIx(name: string, roundId: number) {
  const data = Buffer.alloc(16);
  ixDiscriminator(name).copy(data, 0);
  data.writeBigUInt64LE(BigInt(roundId), 8);
  return data;
}

function encodeRoundIdU8Ix(name: string, roundId: number, value: number) {
  const data = Buffer.alloc(17);
  ixDiscriminator(name).copy(data, 0);
  data.writeBigUInt64LE(BigInt(roundId), 8);
  data.writeUInt8(value, 16);
  return data;
}

function encodeDepositAny(roundId: number, usdcBalanceBefore: bigint, minOut: bigint) {
  const data = Buffer.alloc(32);
  ixDiscriminator("deposit_any").copy(data, 0);
  data.writeBigUInt64LE(BigInt(roundId), 8);
  data.writeBigUInt64LE(usdcBalanceBefore, 16);
  data.writeBigUInt64LE(minOut, 24);
  return data;
}

function encodeVrfCallback(randomness: Buffer) {
  const data = Buffer.alloc(40);
  ixDiscriminator("vrf_callback").copy(data, 0);
  randomness.copy(data, 8);
  return data;
}

function encodeDegenVrfCallback(randomness: Buffer) {
  const data = Buffer.alloc(40);
  ixDiscriminator("degen_vrf_callback").copy(data, 0);
  randomness.copy(data, 8);
  return data;
}

function decodeConfig(data: Buffer): { treasuryAta: PublicKey } {
  // offset 8: admin(32), usdcMint(32), treasuryAta(32)
  const treasuryAta = readPubkey(data, 8 + 32 + 32);
  return { treasuryAta };
}

function decodeRound(data: Buffer): RoundView {
  const roundId = data.readBigUInt64LE(8);
  const status = data[16];
  const endTs = data.readBigInt64LE(32);
  const totalUsdc = data.readBigUInt64LE(72);
  const totalTickets = data.readBigUInt64LE(80);
  const participantsCount = data.readUInt16LE(88);
  const winningTicket = data.readBigUInt64LE(136); // unused but keeps offsets aligned mentally
  void winningTicket;
  const winner = readPubkey(data, 144);
  // degenMode and vrfPayer live AFTER the 6400-byte participants array (200×32)
  // and 1608-byte fenwick tree (201×8), so their offsets are very large:
  //   body: participants=168, bit=168+6400=6568, fenwick ends at 6568+1608=8176
  //   vrfPayer=8176 (body), vrfReimbursed=8208, degenMode=8209
  //   account offsets = body + 8 (discriminator)
  const degenMode = data[8217];
  const vrfPayer = readPubkey(data, 8184);
  return { roundId, status, endTs, totalUsdc, totalTickets, participantsCount, winner, degenMode, vrfPayer };
}

function decodeDegenClaim(data: Buffer): DegenClaimView {
  const round = readPubkey(data, 8);
  const winner = readPubkey(data, 40);
  const roundId = data.readBigUInt64LE(72);
  const status = data[80];
  const fallbackReason = data[83];
  const fallbackAfterTs = data.readBigInt64LE(124);
  const payoutRaw = data.readBigUInt64LE(132);
  const claimedAt = data.readBigInt64LE(116);
  const randomness = Buffer.from(data.subarray(252, 284));
  return { status, round, winner, roundId, fallbackAfterTs, payoutRaw, claimedAt, fallbackReason, randomness };
}

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
