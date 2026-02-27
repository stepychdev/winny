import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { jupiterFetchJson } from "./jupiterApi";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  slippageBps: number;
}

export interface JupiterSwapInstructions {
  computeBudgetInstructions: SerializedInstruction[];
  setupInstructions: SerializedInstruction[];
  swapInstruction: SerializedInstruction;
  cleanupInstruction?: SerializedInstruction;
  addressLookupTableAddresses: string[];
}

interface SerializedInstruction {
  programId: string;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: string; // base64
}

const COMPUTE_BUDGET_PROGRAM = new PublicKey(
  "ComputeBudget111111111111111111111111111111"
);
// Extra headroom for jackpot `deposit_any` after all Jupiter swaps.
const DEPOSIT_ANY_CU_BUFFER = 150_000;
const MIN_CU = 400_000;
const MAX_CU = 1_400_000; // Solana hard cap is 1.4M

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function readU64LeAsBigInt(buf: Buffer, offset: number): bigint {
  let out = 0n;
  for (let i = 0; i < 8; i++) {
    out |= BigInt(buf[offset + i] ?? 0) << (8n * BigInt(i));
  }
  return out;
}

function deserializeInstruction(ix: SerializedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

function splitJupiterInstructions(
  swapIxSets: JupiterSwapInstructions[]
): {
  computeBudgetIxs: TransactionInstruction[];
  bodyIxs: TransactionInstruction[];
} {
  const computeBudgetIxs: TransactionInstruction[] = [];
  const bodyIxs: TransactionInstruction[] = [];

  let totalJupiterCuEstimate = 0;
  let sawCuEstimate = false;
  let maxPriorityFeeMicrolamports: bigint | null = null;
  const passthroughComputeBudgetIxs: TransactionInstruction[] = [];

  for (const swapIxs of swapIxSets) {
    for (const ix of swapIxs.computeBudgetInstructions) {
      const deserialized = deserializeInstruction(ix);
      if (!deserialized.programId.equals(COMPUTE_BUDGET_PROGRAM)) {
        passthroughComputeBudgetIxs.push(deserialized);
        continue;
      }

      const kind = deserialized.data[0];
      if (kind === 2 && deserialized.data.length >= 5) {
        totalJupiterCuEstimate += deserialized.data.readUInt32LE(1);
        sawCuEstimate = true;
        continue;
      }
      if (kind === 3 && deserialized.data.length >= 9) {
        const price = readU64LeAsBigInt(deserialized.data, 1);
        if (maxPriorityFeeMicrolamports === null || price > maxPriorityFeeMicrolamports) {
          maxPriorityFeeMicrolamports = price;
        }
        continue;
      }

      passthroughComputeBudgetIxs.push(deserialized);
    }
  }

  const fallbackEstimatePerSwap = 200_000;
  const jupiterCuEstimate = sawCuEstimate
    ? totalJupiterCuEstimate
    : fallbackEstimatePerSwap * swapIxSets.length;
  const boostedCu = clamp(jupiterCuEstimate + DEPOSIT_ANY_CU_BUFFER, MIN_CU, MAX_CU);
  computeBudgetIxs.push(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: boostedCu,
    })
  );

  if (maxPriorityFeeMicrolamports !== null) {
    computeBudgetIxs.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: maxPriorityFeeMicrolamports,
      })
    );
  }

  computeBudgetIxs.push(...passthroughComputeBudgetIxs);

  for (const swapIxs of swapIxSets) {
    for (const ix of swapIxs.setupInstructions) {
      bodyIxs.push(deserializeInstruction(ix));
    }
    bodyIxs.push(deserializeInstruction(swapIxs.swapInstruction));
    if (swapIxs.cleanupInstruction) {
      bodyIxs.push(deserializeInstruction(swapIxs.cleanupInstruction));
    }
  }

  return {
    computeBudgetIxs,
    bodyIxs,
  };
}

export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string, // in smallest units (lamports)
  slippageBps = 50,
  swapMode: 'ExactIn' | 'ExactOut' = 'ExactIn'
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
    swapMode,
    restrictIntermediateTokens: 'true',
  });

  return jupiterFetchJson<JupiterQuote>(`/swap/v1/quote?${params.toString()}`, {
    timeoutMs: 5_000,
  });
}

export async function getJupiterSwapInstructions(
  userPublicKey: string,
  quote: JupiterQuote
): Promise<JupiterSwapInstructions> {
  return jupiterFetchJson<JupiterSwapInstructions>("/swap/v1/swap-instructions", {
    method: "POST",
    body: {
      quoteResponse: quote,
      userPublicKey,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    },
    timeoutMs: 10_000,
  });
}

export async function resolveAddressLookupTables(
  connection: Connection,
  addresses: string[]
): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];

  const accounts = await connection.getMultipleAccountsInfo(
    addresses.map((a) => new PublicKey(a))
  );

  return accounts
    .map((acc, i) => {
      if (!acc) return null;
      return new AddressLookupTableAccount({
        key: new PublicKey(addresses[i]),
        state: AddressLookupTableAccount.deserialize(acc.data),
      });
    })
    .filter((a): a is AddressLookupTableAccount => a !== null);
}

export function buildMultiJupiterInstructions(
  swapIxSets: JupiterSwapInstructions[]
): TransactionInstruction[] {
  if (swapIxSets.length === 0) return [];

  const { computeBudgetIxs, bodyIxs } = splitJupiterInstructions(swapIxSets);
  return [...computeBudgetIxs, ...bodyIxs];
}

export function buildJupiterInstructions(
  swapIxs: JupiterSwapInstructions
): TransactionInstruction[] {
  return buildMultiJupiterInstructions([swapIxs]);
}

function mergeAltAddresses(swapIxSets: JupiterSwapInstructions[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const swapIxs of swapIxSets) {
    for (const addr of swapIxs.addressLookupTableAddresses) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      merged.push(addr);
    }
  }
  return merged;
}

export async function buildSwapAndDepositTx(
  connection: Connection,
  payer: PublicKey,
  jupiterSwapIxs: JupiterSwapInstructions,
  depositIx: TransactionInstruction,
  prefixInstructions: TransactionInstruction[] = []
): Promise<VersionedTransaction> {
  return buildMultiSwapAndDepositTx(
    connection,
    payer,
    [jupiterSwapIxs],
    depositIx,
    prefixInstructions
  );
}

export async function buildClaimAndSwapTx(
  connection: Connection,
  payer: PublicKey,
  claimIx: TransactionInstruction,
  jupiterSwapIxs: JupiterSwapInstructions
): Promise<VersionedTransaction> {
  const { computeBudgetIxs, bodyIxs } = splitJupiterInstructions([jupiterSwapIxs]);
  const alts = await resolveAddressLookupTables(connection, jupiterSwapIxs.addressLookupTableAddresses);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...computeBudgetIxs, claimIx, ...bodyIxs],
  }).compileToV0Message(alts);

  return new VersionedTransaction(messageV0);
}

export async function buildMultiSwapAndDepositTx(
  connection: Connection,
  payer: PublicKey,
  jupiterSwapIxSets: JupiterSwapInstructions[],
  depositIx: TransactionInstruction,
  prefixInstructions: TransactionInstruction[] = []
): Promise<VersionedTransaction> {
  const jupIxs = buildMultiJupiterInstructions(jupiterSwapIxSets);

  const allIxs = [...prefixInstructions, ...jupIxs, depositIx];

  const alts = await resolveAddressLookupTables(connection, mergeAltAddresses(jupiterSwapIxSets));

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: allIxs,
  }).compileToV0Message(alts);

  return new VersionedTransaction(messageV0);
}
