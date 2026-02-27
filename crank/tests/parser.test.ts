import assert from "node:assert";
import { test } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { parseParticipant, parseRound } from "../src/parser.ts";

const DISC = 8;

function writePubkey(buffer: Buffer, offset: number, pubkey: PublicKey) {
  pubkey.toBuffer().copy(buffer, offset);
}

test("parseRound parses zero-copy round offsets including participants and vrfPayer", () => {
  const roundId = 82n;
  const status = 5;
  const bump = 254;
  const startTs = 1_700_000_000n;
  const endTs = 1_700_000_123n;
  const firstDepositTs = 1_700_000_010n;
  const totalUsdc = 1_975_320n;
  const totalTickets = 197n;
  const participantsCount = 2;
  const winningTicket = 123n;

  const vaultUsdcAta = Keypair.generate().publicKey;
  const winner = Keypair.generate().publicKey;
  const participant1 = Keypair.generate().publicKey;
  const participant2 = Keypair.generate().publicKey;
  const vrfPayer = Keypair.generate().publicKey;

  const buffer = Buffer.alloc(DISC + 8240);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  view.setBigUint64(DISC + 0, roundId, true);
  buffer[DISC + 8] = status;
  buffer[DISC + 9] = bump;
  view.setBigInt64(DISC + 16, startTs, true);
  view.setBigInt64(DISC + 24, endTs, true);
  view.setBigInt64(DISC + 32, firstDepositTs, true);
  writePubkey(buffer, DISC + 40, vaultUsdcAta);
  view.setBigUint64(DISC + 72, totalUsdc, true);
  view.setBigUint64(DISC + 80, totalTickets, true);
  view.setUint16(DISC + 88, participantsCount, true);

  for (let i = 0; i < 32; i++) {
    buffer[DISC + 96 + i] = i + 1;
  }
  view.setBigUint64(DISC + 128, winningTicket, true);
  writePubkey(buffer, DISC + 136, winner);

  writePubkey(buffer, DISC + 168, participant1);
  writePubkey(buffer, DISC + 200, participant2);

  writePubkey(buffer, DISC + 8176, vrfPayer);

  const parsed = parseRound(buffer);

  assert.equal(parsed.roundId, roundId);
  assert.equal(parsed.status, status);
  assert.equal(parsed.bump, bump);
  assert.equal(parsed.startTs, startTs);
  assert.equal(parsed.endTs, endTs);
  assert.equal(parsed.firstDepositTs, firstDepositTs);
  assert.equal(parsed.vaultUsdcAta.toBase58(), vaultUsdcAta.toBase58());
  assert.equal(parsed.totalUsdc, totalUsdc);
  assert.equal(parsed.totalTickets, totalTickets);
  assert.equal(parsed.participantsCount, participantsCount);
  assert.equal(parsed.winningTicket, winningTicket);
  assert.equal(parsed.winner.toBase58(), winner.toBase58());
  assert.deepEqual(
    Array.from(parsed.randomness.slice(0, 4)),
    [1, 2, 3, 4]
  );
  assert.equal(parsed.participants.length, 2);
  assert.equal(parsed.participants[0].toBase58(), participant1.toBase58());
  assert.equal(parsed.participants[1].toBase58(), participant2.toBase58());
  assert.equal(parsed.vrfPayer.toBase58(), vrfPayer.toBase58());
});

test("parseParticipant parses participant zero-copy layout", () => {
  const round = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;
  const index = 7;
  const bump = 201;
  const ticketsTotal = 110n;
  const usdcTotal = 1_100_000n;
  const depositsCount = 3;

  const buffer = Buffer.alloc(DISC + 128);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  writePubkey(buffer, DISC + 0, round);
  writePubkey(buffer, DISC + 32, user);
  view.setUint16(DISC + 64, index, true);
  buffer[DISC + 66] = bump;
  view.setBigUint64(DISC + 67, ticketsTotal, true);
  view.setBigUint64(DISC + 75, usdcTotal, true);
  view.setUint32(DISC + 83, depositsCount, true);

  const parsed = parseParticipant(buffer);

  assert.equal(parsed.round.toBase58(), round.toBase58());
  assert.equal(parsed.user.toBase58(), user.toBase58());
  assert.equal(parsed.index, index);
  assert.equal(parsed.bump, bump);
  assert.equal(parsed.ticketsTotal, ticketsTotal);
  assert.equal(parsed.usdcTotal, usdcTotal);
  assert.equal(parsed.depositsCount, depositsCount);
});

