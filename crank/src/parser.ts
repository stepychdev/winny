/**
 * Round data parser — mirrors src/lib/program.ts parseRound.
 * Parses zero-copy Round account from raw buffer.
 */
import { PublicKey } from "@solana/web3.js";

export interface RoundData {
  roundId: bigint;
  status: number;
  bump: number;
  startTs: bigint;
  endTs: bigint;
  firstDepositTs: bigint;
  vaultUsdcAta: PublicKey;
  totalUsdc: bigint;
  totalTickets: bigint;
  participantsCount: number;
  randomness: Uint8Array;
  winningTicket: bigint;
  winner: PublicKey;
  participants: PublicKey[];
  vrfPayer: PublicKey;
}

export interface ParticipantData {
  round: PublicKey;
  user: PublicKey;
  index: number;
  bump: number;
  ticketsTotal: bigint;
  usdcTotal: bigint;
  depositsCount: number;
}

const DISC = 8; // Anchor discriminator

export function parseRound(data: Buffer): RoundData {
  const d = data;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);

  const roundId = view.getBigUint64(DISC + 0, true);
  const status = d[DISC + 8];
  const bump = d[DISC + 9];
  const startTs = view.getBigInt64(DISC + 16, true);
  const endTs = view.getBigInt64(DISC + 24, true);
  const firstDepositTs = view.getBigInt64(DISC + 32, true);
  const vaultUsdcAta = new PublicKey(d.subarray(DISC + 40, DISC + 72));
  const totalUsdc = view.getBigUint64(DISC + 72, true);
  const totalTickets = view.getBigUint64(DISC + 80, true);
  const participantsCount = view.getUint16(DISC + 88, true);
  const randomness = new Uint8Array(d.subarray(DISC + 96, DISC + 128));
  const winningTicket = view.getBigUint64(DISC + 128, true);
  const winner = new PublicKey(d.subarray(DISC + 136, DISC + 168));

  const participants: PublicKey[] = [];
  const pOff = DISC + 168;
  for (let i = 0; i < participantsCount; i++) {
    const s = pOff + i * 32;
    participants.push(new PublicKey(d.subarray(s, s + 32)));
  }

  const vrfPayer = new PublicKey(d.subarray(DISC + 8176, DISC + 8208));

  return {
    roundId,
    status,
    bump,
    startTs,
    endTs,
    firstDepositTs,
    vaultUsdcAta,
    totalUsdc,
    totalTickets,
    participantsCount,
    randomness,
    winningTicket,
    winner,
    participants,
    vrfPayer,
  };
}

export function parseParticipant(data: Buffer): ParticipantData {
  const d = data;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);

  const round = new PublicKey(d.subarray(DISC + 0, DISC + 32));
  const user = new PublicKey(d.subarray(DISC + 32, DISC + 64));
  const index = view.getUint16(DISC + 64, true);
  const bump = d[DISC + 66];
  const ticketsTotal = view.getBigUint64(DISC + 67, true);
  const usdcTotal = view.getBigUint64(DISC + 75, true);
  const depositsCount = view.getUint32(DISC + 83, true);

  return {
    round,
    user,
    index,
    bump,
    ticketsTotal,
    usdcTotal,
    depositsCount,
  };
}
