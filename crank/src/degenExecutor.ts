import fs from "fs";
import { createHash } from "crypto";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  DegenClaimStatus,
  PROGRAM_ID,
  RoundStatus,
  USDC_MINT,
} from "./constants.js";
import {
  buildBeginDegenExecution,
  buildAutoClaimDegenFallback,
  buildFinalizeDegenSuccess,
  createProgram,
} from "./instructions.js";
import { DEGEN_POOL, DEGEN_POOL_VERSION } from "./generated/degenPool.js";

const DISC = 8;
const ROUND_STATUS_OFFSET = DISC + 8;
const ROUND_VRF_PAYER_OFFSET = DISC + 8176;
const ROUND_DEGEN_STATUS_OFFSET = DISC + 8209;

const POLL_MS = Number(process.env.DEGEN_EXECUTOR_POLL_MS || 5000);
const SLIPPAGE_BPS = Number(process.env.DEGEN_EXECUTOR_SLIPPAGE_BPS || 100);
const JUPITER_API_BASE = "https://api.jup.ag";
const JUPITER_API_KEY = (process.env.JUPITER_API_KEY || "").trim();
const COMPUTE_BUDGET_PROGRAM = new PublicKey("ComputeBudget111111111111111111111111111111");
const DEFAULT_TIMEOUT_MS = 10_000;
const ONE_SHOT = process.argv.includes("--once");

interface DegenClaimAccount {
  publicKey: PublicKey;
  account: {
    round: PublicKey;
    winner: PublicKey;
    roundId: BN;
    status: number;
    tokenIndex: number;
    poolVersion: number;
    candidateWindow: number;
    randomness: Uint8Array;
    payoutRaw: BN;
    fallbackAfterTs: BN;
  };
}

interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  routePlan: Array<unknown>;
}

interface SerializedInstruction {
  programId: string;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: string;
}

interface JupiterSwapInstructions {
  computeBudgetInstructions: SerializedInstruction[];
  setupInstructions: SerializedInstruction[];
  swapInstruction: SerializedInstruction;
  cleanupInstruction?: SerializedInstruction;
  addressLookupTableAddresses: string[];
}

function envRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8")))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeU32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function decodeU32LE(value: Uint8Array): number {
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true);
}

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const payload = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    payload.set(part, offset);
    offset += part.length;
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  return new Uint8Array(digest);
}

async function deriveCandidates(
  randomness: Uint8Array,
  poolVersion: number,
  count: number,
): Promise<Array<{ rank: number; index: number; mint: string }>> {
  const limit = Math.min(count, DEGEN_POOL.length);
  const used = new Set<number>();
  const out: Array<{ rank: number; index: number; mint: string }> = [];

  for (let rank = 0; rank < limit; rank += 1) {
    let nonce = 0;
    while (true) {
      const digest = await sha256([
        randomness,
        encodeU32LE(poolVersion),
        encodeU32LE(rank),
        encodeU32LE(nonce),
      ]);
      const index = decodeU32LE(digest.subarray(0, 4)) % DEGEN_POOL.length;
      if (!used.has(index)) {
        used.add(index);
        out.push({ rank, index, mint: DEGEN_POOL[index] });
        break;
      }
      nonce += 1;
    }
  }

  return out;
}

async function jupiterFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  if (!JUPITER_API_KEY) throw new Error("Missing JUPITER_API_KEY");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${JUPITER_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": JUPITER_API_KEY,
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Jupiter ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getQuote(outputMint: string, amount: string): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: USDC_MINT.toBase58(),
    outputMint,
    amount,
    slippageBps: String(SLIPPAGE_BPS),
    swapMode: "ExactIn",
    restrictIntermediateTokens: "true",
  });
  return jupiterFetch<JupiterQuote>(`/swap/v1/quote?${params.toString()}`);
}

async function getSwapInstructions(
  userPublicKey: string,
  quote: JupiterQuote,
  destinationTokenAccount: string,
): Promise<JupiterSwapInstructions> {
  return jupiterFetch<JupiterSwapInstructions>("/swap/v1/swap-instructions", {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      destinationTokenAccount,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
}

function deserializeInstruction(ix: SerializedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

async function resolveLookupTables(
  connection: Connection,
  addresses: string[]
): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];
  const accounts = await connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)));
  return accounts.flatMap((account, idx) => {
    if (!account) return [];
    return [
      new AddressLookupTableAccount({
        key: new PublicKey(addresses[idx]),
        state: AddressLookupTableAccount.deserialize(account.data),
      }),
    ];
  });
}

function routeHashFromQuote(quote: JupiterQuote): number[] {
  return Array.from(createHash("sha256").update(JSON.stringify(quote.routePlan)).digest());
}

function parseRoundMeta(data: Buffer): {
  status: number;
  degenModeStatus: number;
  vrfPayer: PublicKey;
} {
  return {
    status: data[ROUND_STATUS_OFFSET],
    degenModeStatus: data[ROUND_DEGEN_STATUS_OFFSET],
    vrfPayer: new PublicKey(data.subarray(ROUND_VRF_PAYER_OFFSET, ROUND_VRF_PAYER_OFFSET + 32)),
  };
}

async function buildExecutionTx(
  connection: Connection,
  program: any,
  executor: Keypair,
  claim: DegenClaimAccount,
  candidate: { rank: number; index: number; mint: string },
  vrfPayer: PublicKey,
  payoutRaw: bigint,
): Promise<VersionedTransaction> {
  const winner = claim.account.winner;
  const selectedMint = new PublicKey(candidate.mint);
  const receiverAta = await getAssociatedTokenAddress(selectedMint, winner);
  const prefixIxs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      executor.publicKey,
      receiverAta,
      winner,
      selectedMint,
    ),
  ];

  if (!vrfPayer.equals(PublicKey.default)) {
    const vrfAta = await getAssociatedTokenAddress(USDC_MINT, vrfPayer);
    prefixIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        executor.publicKey,
        vrfAta,
        vrfPayer,
        USDC_MINT,
      )
    );
  }

  const routeHash = candidate.mint === USDC_MINT.toBase58()
    ? Array.from(createHash("sha256").update("direct-usdc").digest())
    : undefined;

  const minOutRaw = new BN(payoutRaw.toString());
  const beginIx = await buildBeginDegenExecution(
    program,
    executor.publicKey,
    winner,
    claim.account.roundId.toNumber(),
    candidate.rank,
    candidate.index,
    minOutRaw,
    routeHash ?? new Array(32).fill(0),
    selectedMint,
    receiverAta,
    vrfPayer.equals(PublicKey.default) ? undefined : vrfPayer,
  );
  const finalizeIx = await buildFinalizeDegenSuccess(
    program,
    executor.publicKey,
    winner,
    claim.account.roundId.toNumber(),
    receiverAta,
  );

  let allIxs = [...prefixIxs, beginIx];
  let alts: AddressLookupTableAccount[] = [];

  if (candidate.mint === USDC_MINT.toBase58()) {
    const executorUsdcAta = await getAssociatedTokenAddress(USDC_MINT, executor.publicKey);
    allIxs.push(
      createTransferInstruction(
        executorUsdcAta,
        receiverAta,
        executor.publicKey,
        BigInt(payoutRaw.toString()),
        [],
        TOKEN_PROGRAM_ID,
      )
    );
  } else {
    const quote = await getQuote(candidate.mint, payoutRaw.toString());
    const swapIxs = await getSwapInstructions(
      executor.publicKey.toBase58(),
      quote,
      receiverAta.toBase58(),
    );
    const computeBudgetIxs = swapIxs.computeBudgetInstructions
      .map(deserializeInstruction)
      .filter((ix) => ix.programId.equals(COMPUTE_BUDGET_PROGRAM));
    const bodyIxs = [
      ...swapIxs.setupInstructions.map(deserializeInstruction),
      deserializeInstruction(swapIxs.swapInstruction),
      ...(swapIxs.cleanupInstruction ? [deserializeInstruction(swapIxs.cleanupInstruction)] : []),
    ];
    allIxs = [
      ...prefixIxs,
      ...computeBudgetIxs,
      await buildBeginDegenExecution(
        program,
        executor.publicKey,
        winner,
        claim.account.roundId.toNumber(),
        candidate.rank,
        candidate.index,
        new BN(quote.outAmount),
        routeHashFromQuote(quote),
        selectedMint,
        receiverAta,
        vrfPayer.equals(PublicKey.default) ? undefined : vrfPayer,
      ),
      ...bodyIxs,
    ];
    alts = await resolveLookupTables(connection, swapIxs.addressLookupTableAddresses);
  }

  allIxs.push(finalizeIx);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: executor.publicKey,
    recentBlockhash: blockhash,
    instructions: allIxs,
  }).compileToV0Message(alts);
  return new VersionedTransaction(msg);
}

async function simulateAndSend(
  connection: Connection,
  tx: VersionedTransaction,
  signer: Keypair,
): Promise<string> {
  tx.sign([signer]);
  const simulation = await connection.simulateTransaction(tx, {
    sigVerify: false,
    commitment: "processed",
  });
  if (simulation.value.err) {
    throw new Error(`simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  const sig = await connection.sendTransaction(tx, {
    skipPreflight: true,
    maxRetries: 3,
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function processReadyClaim(connection: Connection, executor: Keypair, claim: DegenClaimAccount): Promise<void> {
  const program = createProgram(connection, executor);
  const roundInfo = await connection.getAccountInfo(claim.account.round);
  if (!roundInfo) return;
  const round = parseRoundMeta(roundInfo.data);
  if (round.status !== RoundStatus.Settled || round.degenModeStatus !== 2) return;
  if (claim.account.status !== DegenClaimStatus.VrfReady) return;
  if (claim.account.poolVersion !== DEGEN_POOL_VERSION) {
    console.warn(`[degen-executor] skip round ${claim.account.roundId.toString()} due to pool version mismatch`);
    return;
  }

  const candidates = await deriveCandidates(
    claim.account.randomness,
    claim.account.poolVersion,
    claim.account.candidateWindow || 10,
  );

  for (const candidate of candidates) {
    try {
      const tx = await buildExecutionTx(
        connection,
        program,
        executor,
        claim,
        candidate,
        round.vrfPayer,
        BigInt(claim.account.payoutRaw.toString()),
      );
      const sig = await simulateAndSend(connection, tx, executor);
      console.log(`[degen-executor] round #${claim.account.roundId.toString()} executed via rank=${candidate.rank} mint=${candidate.mint} sig=${sig}`);
      return;
    } catch (error) {
      console.warn(`[degen-executor] candidate rank=${candidate.rank} failed for round #${claim.account.roundId.toString()}:`, error instanceof Error ? error.message : error);
    }
  }

  const fallbackAt = Number(claim.account.fallbackAfterTs.toString());
  const nowSec = Math.floor(Date.now() / 1000);

  if (nowSec >= fallbackAt) {
    console.log(`[degen-executor] all candidates failed & fallback window reached for round #${claim.account.roundId.toString()}, triggering auto_claim_degen_fallback`);
    try {
      const fallbackReason = 3; // NO_ROUTES_FOUND / all candidates exhausted
      const winner = claim.account.winner;
      const vrfPayer = round.vrfPayer.equals(PublicKey.default) ? undefined : round.vrfPayer;

      const winnerAta = await getAssociatedTokenAddress(USDC_MINT, winner);
      const createWinnerAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        executor.publicKey,
        winnerAta,
        winner,
        USDC_MINT,
      );

      const prefixIxs: TransactionInstruction[] = [createWinnerAtaIx];
      if (vrfPayer) {
        const vrfAta = await getAssociatedTokenAddress(USDC_MINT, vrfPayer);
        prefixIxs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            executor.publicKey,
            vrfAta,
            vrfPayer,
            USDC_MINT,
          )
        );
      }

      const fallbackIx = await buildAutoClaimDegenFallback(
        program,
        executor.publicKey,
        winner,
        claim.account.roundId.toNumber(),
        fallbackReason,
        vrfPayer,
      );

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: executor.publicKey,
        recentBlockhash: blockhash,
        instructions: [...prefixIxs, fallbackIx],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      const sig = await simulateAndSend(connection, tx, executor);
      console.log(`[degen-executor] round #${claim.account.roundId.toString()} auto_claim_degen_fallback sig=${sig}`);
      return;
    } catch (error) {
      console.error(`[degen-executor] auto_claim_degen_fallback failed for round #${claim.account.roundId.toString()}:`, error instanceof Error ? error.message : error);
    }
  } else {
    console.warn(`[degen-executor] no viable route for round #${claim.account.roundId.toString()}, fallback_at=${fallbackAt} (in ${fallbackAt - nowSec}s)`);
  }
}

async function fetchReadyClaims(program: any): Promise<DegenClaimAccount[]> {
  const accounts = await (program.account as any).degenClaim.all();
  return accounts.filter((entry: DegenClaimAccount) => entry.account.status === DegenClaimStatus.VrfReady);
}

async function main(): Promise<void> {
  const rpcUrl = envRequired("RPC_URL");
  const executor = loadKeypair(envRequired("DEGEN_EXECUTOR_KEYPAIR_PATH"));
  const connection = new Connection(rpcUrl, "confirmed");
  const program = createProgram(connection, executor);

  console.log(`[degen-executor] executor=${executor.publicKey.toBase58()} poll_ms=${POLL_MS} one_shot=${ONE_SHOT}`);

  do {
    try {
      const claims = await fetchReadyClaims(program);
      for (const claim of claims) {
        await processReadyClaim(connection, executor, claim);
      }
    } catch (error) {
      console.error("[degen-executor] loop failed:", error);
    }

    if (!ONE_SHOT) {
      await sleep(POLL_MS);
    }
  } while (!ONE_SHOT);
}

main().catch((error) => {
  console.error("[degen-executor] fatal:", error);
  process.exit(1);
});
