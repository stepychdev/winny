/**
 * Instruction builders for the crank service.
 * Mirrors src/lib/program.ts builders but uses Node.js Anchor provider.
 */
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
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
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  PROGRAM_ID,
  USDC_MINT,
  TREASURY_USDC_ATA,
  VRF_PROGRAM_ID,
  DEFAULT_QUEUE,
  SLOT_HASHES,
  getConfigPda,
  getRoundPda,
  getParticipantPda,
  getDegenClaimPda,
  getDegenConfigPda,
  getIdentityPda,
} from "./constants.js";
import IDL from "../../src/idl/jackpot.json" with { type: "json" };

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Applied to all crank txs. Can be tuned per environment without redeploying.
const CRANK_COMPUTE_UNIT_LIMIT = envInt("CRANK_COMPUTE_UNIT_LIMIT", 600_000);
const CRANK_PRIORITY_FEE_MICROLAMPORTS = envInt(
  "CRANK_PRIORITY_FEE_MICROLAMPORTS",
  20_000
);

// ─── Program instance ───────────────────────────────────────

export function createProgram(connection: Connection, payer: Keypair): Program {
  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  };
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  const idlWithAddress = {
    ...IDL,
    address: PROGRAM_ID.toBase58(),
  };
  return new Program(idlWithAddress as unknown as Idl, provider);
}

// ─── Send helper ────────────────────────────────────────────

export async function signAndSend(
  connection: Connection,
  ixs: TransactionInstruction[],
  payer: Keypair,
  skipPreflight = false
): Promise<string> {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: CRANK_COMPUTE_UNIT_LIMIT,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: CRANK_PRIORITY_FEE_MICROLAMPORTS,
    }),
    ...ixs
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight,
    commitment: "confirmed",
  });
  return sig;
}

// ─── Instruction builders ───────────────────────────────────

export async function buildStartRound(
  program: Program,
  payer: PublicKey,
  roundId: number
): Promise<TransactionInstruction> {
  const roundPda = getRoundPda(roundId);
  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, roundPda, true);

  return await (program.methods as any)
    .startRound(new BN(roundId))
    .accounts({
      payer,
      config: getConfigPda(),
      round: roundPda,
      vaultUsdcAta: vaultAta,
      usdcMint: USDC_MINT,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildLockRound(
  program: Program,
  caller: PublicKey,
  roundId: number
): Promise<TransactionInstruction> {
  return await (program.methods as any)
    .lockRound(new BN(roundId))
    .accounts({
      caller,
      config: getConfigPda(),
      round: getRoundPda(roundId),
    })
    .instruction();
}

export async function buildRequestVrf(
  program: Program,
  payer: PublicKey,
  roundId: number
): Promise<TransactionInstruction> {
  return await (program.methods as any)
    .requestVrf(new BN(roundId))
    .accounts({
      payer,
      config: getConfigPda(),
      round: getRoundPda(roundId),
      programIdentity: getIdentityPda(),
      oracleQueue: DEFAULT_QUEUE,
      vrfProgram: VRF_PROGRAM_ID,
      slotHashes: SLOT_HASHES,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildAutoClaim(
  program: Program,
  payer: PublicKey,
  winner: PublicKey,
  roundId: number,
  vrfPayer?: PublicKey
): Promise<TransactionInstruction> {
  const roundPda = getRoundPda(roundId);
  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, roundPda, true);
  const winnerAta = await getAssociatedTokenAddress(USDC_MINT, winner);

  let vrfPayerUsdcAta: PublicKey | null = null;
  if (vrfPayer && !vrfPayer.equals(PublicKey.default)) {
    vrfPayerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, vrfPayer);
  }

  return await (program.methods as any)
    .autoClaim(new BN(roundId))
    .accounts({
      payer,
      config: getConfigPda(),
      round: roundPda,
      vaultUsdcAta: vaultAta,
      winnerUsdcAta: winnerAta,
      treasuryUsdcAta: TREASURY_USDC_ATA,
      vrfPayerUsdcAta: vrfPayerUsdcAta as any,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildAutoClaimDegenFallback(
  program: Program,
  payer: PublicKey,
  winner: PublicKey,
  roundId: number,
  fallbackReason: number
): Promise<TransactionInstruction> {
  const roundPda = getRoundPda(roundId);
  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, roundPda, true);
  const winnerAta = await getAssociatedTokenAddress(USDC_MINT, winner);

  return await (program.methods as any)
    .autoClaimDegenFallback(new BN(roundId), fallbackReason)
    .accounts({
      payer,
      config: getConfigPda(),
      round: roundPda,
      degenClaim: getDegenClaimPda(roundId, winner),
      vaultUsdcAta: vaultAta,
      winnerUsdcAta: winnerAta,
      treasuryUsdcAta: TREASURY_USDC_ATA,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildClaimRefund(
  program: Program,
  user: PublicKey,
  roundId: number
): Promise<TransactionInstruction> {
  const roundPda = getRoundPda(roundId);
  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, roundPda, true);
  const userUsdcAta = await getAssociatedTokenAddress(USDC_MINT, user);

  return await (program.methods as any)
    .claimRefund(new BN(roundId))
    .accounts({
      config: getConfigPda(),
      round: roundPda,
      user,
      participant: getParticipantPda(roundPda, user),
      vaultUsdcAta: vaultAta,
      userUsdcAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildTransferAdmin(
  program: Program,
  admin: PublicKey,
  newAdmin: PublicKey
): Promise<TransactionInstruction> {
  return await (program.methods as any)
    .transferAdmin(newAdmin)
    .accounts({
      admin,
      config: getConfigPda(),
    })
    .instruction();
}

export async function buildSetTreasuryUsdcAta(
  program: Program,
  admin: PublicKey,
  newTreasuryUsdcAta: PublicKey,
  expectedOwner: PublicKey
): Promise<TransactionInstruction> {
  return await (program.methods as any)
    .setTreasuryUsdcAta()
    .accounts({
      admin,
      config: getConfigPda(),
      newTreasuryUsdcAta,
      expectedOwner,
    })
    .instruction();
}

export async function buildCloseRound(
  program: Program,
  payer: PublicKey,
  recipient: PublicKey,
  roundId: number
): Promise<TransactionInstruction> {
  const roundPda = getRoundPda(roundId);
  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, roundPda, true);

  return await (program.methods as any)
    .closeRound(new BN(roundId))
    .accounts({
      payer,
      recipient,
      round: roundPda,
      vaultUsdcAta: vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildCloseParticipant(
  program: Program,
  payer: PublicKey,
  user: PublicKey,
  roundId: number
): Promise<TransactionInstruction> {
  const roundPda = getRoundPda(roundId);

  return await (program.methods as any)
    .closeParticipant(new BN(roundId))
    .accounts({
      payer,
      user,
      round: roundPda,
      participant: getParticipantPda(roundPda, user),
    })
    .instruction();
}

export async function buildBeginDegenExecution(
  program: Program,
  executor: PublicKey,
  winner: PublicKey,
  roundId: number,
  candidateRank: number,
  tokenIndex: number,
  minOutRaw: BN,
  routeHash: number[],
  selectedTokenMint: PublicKey,
  receiverTokenAta: PublicKey
): Promise<TransactionInstruction> {
  const roundPda = getRoundPda(roundId);
  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, roundPda, true);
  const executorAta = await getAssociatedTokenAddress(USDC_MINT, executor);

  return await (program.methods as any)
    .beginDegenExecution(
      new BN(roundId),
      candidateRank,
      tokenIndex,
      minOutRaw,
      routeHash
    )
    .accounts({
      executor,
      config: getConfigPda(),
      degenConfig: getDegenConfigPda(),
      round: roundPda,
      degenClaim: getDegenClaimPda(roundId, winner),
      vaultUsdcAta: vaultAta,
      executorUsdcAta: executorAta,
      treasuryUsdcAta: TREASURY_USDC_ATA,
      selectedTokenMint,
      receiverTokenAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildFinalizeDegenSuccess(
  program: Program,
  executor: PublicKey,
  winner: PublicKey,
  roundId: number,
  receiverTokenAta: PublicKey
): Promise<TransactionInstruction> {
  const executorAta = await getAssociatedTokenAddress(USDC_MINT, executor);

  return await (program.methods as any)
    .finalizeDegenSuccess(new BN(roundId))
    .accounts({
      executor,
      degenConfig: getDegenConfigPda(),
      round: getRoundPda(roundId),
      degenClaim: getDegenClaimPda(roundId, winner),
      executorUsdcAta: executorAta,
      receiverTokenAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildUpsertDegenConfig(
  program: Program,
  admin: PublicKey,
  executor: PublicKey,
  fallbackTimeoutSec: number
): Promise<TransactionInstruction> {
  return await (program.methods as any)
    .upsertDegenConfig({
      executor,
      fallbackTimeoutSec,
    })
    .accounts({
      admin,
      config: getConfigPda(),
      degenConfig: getDegenConfigPda(),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}
