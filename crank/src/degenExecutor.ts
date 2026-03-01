import fs from "fs";
import { createHash } from "crypto";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
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
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  DegenClaimStatus,
  getConfigPda,
  getDegenClaimPda,
  PROGRAM_ID,
  RoundStatus,
  TREASURY_USDC_ATA,
  USDC_MINT,
} from "./constants.js";
import {
  buildBeginDegenExecution,
  buildAutoClaimDegenFallback,
  buildFinalizeDegenSuccess,
  createProgram,
} from "./instructions.js";
import { DEGEN_POOL, DEGEN_POOL_VERSION } from "./generated/degenPool.js";
import {
  deriveCandidates,
  isTxTooLargeError,
  isSlippageError,
  parseMaxAccountsSequence,
  parseRoundMeta,
  parseConfigFeeBps,
  computeBeginDegenPayout,
  routeHashFromQuote,
  type JupiterQuote,
} from "./degenLogic.js";

const POLL_MS = Number(process.env.DEGEN_EXECUTOR_POLL_MS || 5000);

/** Escalating slippage sequence: start tight, widen on failure. Jupiter anti-MEV
 *  means higher slippage doesn't worsen execution — only lowers the revert threshold. */
const SLIPPAGE_SEQUENCE = (process.env.DEGEN_EXECUTOR_SLIPPAGE_SEQUENCE || "300,400,500,600")
  .split(",").map(Number).filter(n => Number.isFinite(n) && n > 0);
const JUPITER_API_BASE = "https://api.jup.ag";
const JUPITER_API_KEY = (process.env.JUPITER_API_KEY || "").trim();
const COMPUTE_BUDGET_PROGRAM = new PublicKey("ComputeBudget111111111111111111111111111111");
const FALLBACK_CU_LIMIT = Number(process.env.CRANK_COMPUTE_UNIT_LIMIT || 600_000);
const FALLBACK_PRIORITY_FEE = Number(process.env.CRANK_PRIORITY_FEE_MICROLAMPORTS || 20_000);
const DEFAULT_TIMEOUT_MS = 10_000;
const ONE_SHOT = process.argv.includes("--once");
const MAX_TX_RAW_BYTES = 1232;
const JACKPOT_ALT_ADDRESS = (process.env.JACKPOT_ALT || "").trim();

const QUOTE_MAX_ACCOUNTS_SEQUENCE = parseMaxAccountsSequence(
  process.env.DEGEN_EXECUTOR_MAX_ACCOUNTS_SEQUENCE
);
const mintOwnerCache = new Map<string, PublicKey | null>();

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

async function getQuoteWithMaxAccounts(
  outputMint: string,
  amount: string,
  maxAccounts?: number,
  onlyDirectRoutes?: boolean,
  slippageBps?: number,
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: USDC_MINT.toBase58(),
    outputMint,
    amount,
    slippageBps: String(slippageBps ?? SLIPPAGE_SEQUENCE[0] ?? 300),
    swapMode: "ExactIn",
    restrictIntermediateTokens: "true",
  });
  if (maxAccounts && Number.isFinite(maxAccounts)) {
    params.set("maxAccounts", String(maxAccounts));
  }
  if (onlyDirectRoutes) {
    params.set("onlyDirectRoutes", "true");
  }
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

async function getMintOwner(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey | null> {
  const key = mint.toBase58();
  if (mintOwnerCache.has(key)) {
    return mintOwnerCache.get(key) ?? null;
  }
  const info = await connection.getAccountInfo(mint, "confirmed");
  const owner = info?.owner ?? null;
  mintOwnerCache.set(key, owner);
  return owner;
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

async function buildExecutionTx(
  connection: Connection,
  program: any,
  executor: Keypair,
  claim: DegenClaimAccount,
  candidate: { rank: number; index: number; mint: string },
  payoutRaw: bigint,
  maxAccounts?: number,
  onlyDirectRoutes?: boolean,
  slippageBps?: number,
  jackpotAlt?: AddressLookupTableAccount | null,
): Promise<VersionedTransaction> {
  const winner = claim.account.winner;
  const selectedMint = new PublicKey(candidate.mint);
  const selectedMintOwner = await getMintOwner(connection, selectedMint);
  if (!selectedMintOwner) {
    throw new Error(`selected mint account not found: ${selectedMint.toBase58()}`);
  }
  if (!selectedMintOwner.equals(TOKEN_PROGRAM_ID) && !selectedMintOwner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `unsupported selected mint program for v3 degen execution: ${selectedMint.toBase58()} owner=${selectedMintOwner.toBase58()}`
    );
  }
  const receiverAta = await getAssociatedTokenAddress(selectedMint, winner, true, selectedMintOwner);
  const executorUsdcAta = await getAssociatedTokenAddress(USDC_MINT, executor.publicKey);

  // Drain executor ATA if it has a stale balance (prevents InvalidDegenExecutorAta / 6043)
  // Executor ATA is created once at startup — no need to create it in every tx
  const drainIxs: TransactionInstruction[] = [];
  try {
    const ataBalance = await connection.getTokenAccountBalance(executorUsdcAta, "confirmed");
    const staleAmount = BigInt(ataBalance.value.amount);
    if (staleAmount > 0n) {
      console.warn(`[degen-executor] draining stale ${staleAmount} USDC lamports from executor ATA`);
      drainIxs.push(
        createTransferInstruction(
          executorUsdcAta,
          TREASURY_USDC_ATA,
          executor.publicKey,
          staleAmount,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );
    }
  } catch {
    // ATA doesn't exist — will be ensured at startup via ensureExecutorAta()
  }

  const prefixIxs: TransactionInstruction[] = [
    ...drainIxs,
    createAssociatedTokenAccountIdempotentInstruction(
      executor.publicKey,
      receiverAta,
      winner,
      selectedMint,
      selectedMintOwner,
    ),
  ];

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
    const quote = await getQuoteWithMaxAccounts(candidate.mint, payoutRaw.toString(), maxAccounts, onlyDirectRoutes, slippageBps);
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
        new BN(quote.otherAmountThreshold),
        routeHashFromQuote(quote),
        selectedMint,
        receiverAta,
      ),
      ...bodyIxs,
    ];
    alts = await resolveLookupTables(connection, swapIxs.addressLookupTableAddresses);
  }

  allIxs.push(finalizeIx);
  // Merge Jackpot ALT (our stable accounts) with Jupiter ALTs
  const mergedAlts = jackpotAlt ? [jackpotAlt, ...alts] : alts;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: executor.publicKey,
    recentBlockhash: blockhash,
    instructions: allIxs,
  }).compileToV0Message(mergedAlts);
  return new VersionedTransaction(msg);
}

/** Error subclass to signal that the tx may have landed despite confirm timeout. */
class TxTimeoutError extends Error {
  readonly cause?: Error;
  constructor(public readonly signature: string, cause?: Error) {
    super(`tx timeout (may have landed): ${signature}`);
    this.name = "TxTimeoutError";
    if (cause) this.cause = cause;
  }
}

function isConfirmTimeoutError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("was not confirmed in") ||
    msg.includes("TransactionExpiredTimeoutError") ||
    msg.includes("TransactionExpiredBlockheightExceededError")
  );
}

async function simulateAndSend(
  connection: Connection,
  tx: VersionedTransaction,
  signer: Keypair,
): Promise<string> {
  tx.sign([signer]);
  try {
    const serialized = tx.serialize();
    if (serialized.length > MAX_TX_RAW_BYTES) {
      throw new Error(`transaction too large: ${serialized.length} bytes (max ${MAX_TX_RAW_BYTES})`);
    }
  } catch (error) {
    if (isTxTooLargeError(error)) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
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
  try {
    await connection.confirmTransaction(sig, "confirmed");
  } catch (confirmErr) {
    if (isConfirmTimeoutError(confirmErr)) {
      // Poll signature status a few times before giving up — the tx may have landed
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const { value } = await connection.getSignatureStatuses([sig]);
        const status = value?.[0];
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
          if (!status.err) {
            console.log(`[degen-executor] tx ${sig} confirmed after timeout (attempt ${attempt + 1})`);
            return sig;
          }
          // Tx landed but failed on-chain — treat as real error
          throw new Error(`tx landed with error: ${JSON.stringify(status.err)}`);
        }
      }
      // Still unknown — throw TxTimeoutError so caller can check on-chain state
      throw new TxTimeoutError(sig, confirmErr instanceof Error ? confirmErr : undefined);
    }
    throw confirmErr;
  }
  return sig;
}

async function processReadyClaim(
  connection: Connection,
  executor: Keypair,
  claim: DegenClaimAccount,
  jackpotAlt?: AddressLookupTableAccount | null,
): Promise<void> {
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

  // Compute the actual payout that begin_degen_execution will transfer.
  // The on-chain handler uses reimburse_vrf=false, so we must match that —
  // NOT claim.account.payoutRaw which was set by VRF callback with reimburse_vrf=true.
  const configInfo = await connection.getAccountInfo(getConfigPda());
  if (!configInfo) { console.warn("[degen-executor] config account not found"); return; }
  const feeBps = parseConfigFeeBps(configInfo.data);
  const actualPayoutRaw = computeBeginDegenPayout(round.totalUsdc, feeBps);
  if (actualPayoutRaw <= 0n) { console.warn("[degen-executor] computed payout is zero"); return; }
  const vrfPayout = BigInt(claim.account.payoutRaw.toString());
  if (actualPayoutRaw !== vrfPayout) {
    console.log(`[degen-executor] round #${claim.account.roundId.toString()} payout correction: VRF=${vrfPayout} → actual=${actualPayoutRaw} (delta=${actualPayoutRaw - vrfPayout})`);
  }

  const candidates = await deriveCandidates(
    claim.account.randomness,
    claim.account.poolVersion,
    claim.account.candidateWindow || 10,
  );

  for (const candidate of candidates) {
    try {
      const directUsdc = candidate.mint === USDC_MINT.toBase58();

      // Early filter: reject mints with unknown token program (before ATA creation or Jupiter calls)
      if (!directUsdc) {
        const selectedMint = new PublicKey(candidate.mint);
        const mintOwner = await getMintOwner(connection, selectedMint);
        if (!mintOwner || (!mintOwner.equals(TOKEN_PROGRAM_ID) && !mintOwner.equals(TOKEN_2022_PROGRAM_ID))) {
          const ownerLabel = mintOwner?.toBase58() ?? "unknown";
          throw new Error(`unsupported mint program: ${ownerLabel}`);
        }
      }

      const maxAccountsAttempts = directUsdc ? [undefined] : QUOTE_MAX_ACCOUNTS_SEQUENCE.map((value) => value);
      let lastSizedError: Error | null = null;
      let lastSlippageError: Error | null = null;

      // Outer loop: escalating slippage. Inner loop: shrinking maxAccounts.
      const slippageSteps = directUsdc ? [undefined] : SLIPPAGE_SEQUENCE;

      for (const slipBps of slippageSteps) {
        lastSizedError = null;

      for (const maxAccounts of maxAccountsAttempts) {
        try {
          const tx = await buildExecutionTx(
            connection,
            program,
            executor,
            claim,
            candidate,
            actualPayoutRaw,
            maxAccounts,
            false,
            slipBps,
            jackpotAlt,
          );
          const sig = await simulateAndSend(connection, tx, executor);
          console.log(
            `[degen-executor] round #${claim.account.roundId.toString()} executed via rank=${candidate.rank} mint=${candidate.mint} sig=${sig}` +
              (maxAccounts ? ` maxAccounts=${maxAccounts}` : "") +
              (slipBps ? ` slippage=${slipBps}bps` : "")
          );
          return;
        } catch (error) {
          if (isTxTooLargeError(error) && !directUsdc) {
            lastSizedError = error instanceof Error
              ? new Error(`${error.message}${maxAccounts ? ` (maxAccounts=${maxAccounts})` : ""}`)
              : new Error(String(error));
            continue; // try smaller maxAccounts
          }
          // Slippage / output threshold error → try next slippage level
          const msg = error instanceof Error ? error.message : String(error);
          if (isSlippageError(msg)) {
            lastSlippageError = error instanceof Error ? error : new Error(msg);
            break; // break maxAccounts loop, try next slippage
          }
          throw error; // unexpected error → bubble up to candidate loop
        }
      }

      // Last resort: try single-hop route with aggressive maxAccounts
      if (lastSizedError && !directUsdc) {
        try {
          const tx = await buildExecutionTx(
            connection,
            program,
            executor,
            claim,
            candidate,
            actualPayoutRaw,
            20,
            true,
            slipBps,
          );
          const sig = await simulateAndSend(connection, tx, executor);
          console.log(
            `[degen-executor] round #${claim.account.roundId.toString()} executed via rank=${candidate.rank} mint=${candidate.mint} sig=${sig} (directRoute)` +
              (slipBps ? ` slippage=${slipBps}bps` : "")
          );
          return;
        } catch (directError) {
          if (isTxTooLargeError(directError)) {
            lastSizedError = new Error(`${(directError as Error).message} (directRoute maxAccounts=20)`);
          } else {
            const msg = directError instanceof Error ? directError.message : String(directError);
            if (isSlippageError(msg)) {
              lastSlippageError = directError instanceof Error ? directError : new Error(msg);
            } else {
              throw directError;
            }
          }
        }
      }

      // If it was a slippage error, continue to next slippage step
      if (lastSlippageError) {
        console.warn(
          `[degen-executor] slippage ${slipBps ?? "default"}bps too tight for rank=${candidate.rank}, escalating...`
        );
        continue;
      }

      } // end slippage loop

      if (lastSizedError) {
        throw lastSizedError;
      }
      if (lastSlippageError) {
        throw lastSlippageError;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[degen-executor] candidate rank=${candidate.rank} failed for round #${claim.account.roundId.toString()}:`, errMsg);

      // After a timeout error, the tx may have landed and changed DegenClaim state.
      // Check the on-chain claim status — if it moved past VrfReady, stop iterating.
      if (error instanceof TxTimeoutError || isConfirmTimeoutError(error)) {
        try {
          const dcPda = getDegenClaimPda(claim.account.roundId.toNumber(), claim.account.winner);
          const dcInfo = await connection.getAccountInfo(dcPda, "confirmed");
          if (dcInfo) {
            const DISC = 8;
            const onChainStatus = dcInfo.data[DISC + 72];
            if (onChainStatus >= DegenClaimStatus.Executing) {
              console.log(
                `[degen-executor] DegenClaim status is now ${onChainStatus} (>= Executing) — a previous tx likely landed, stopping candidate iteration`
              );
              return;
            }
          }
        } catch (checkErr) {
          console.warn("[degen-executor] failed to check DegenClaim status after timeout:", checkErr instanceof Error ? checkErr.message : checkErr);
        }
      }
    }
  }

  const fallbackAt = Number(claim.account.fallbackAfterTs.toString());
  const nowSec = Math.floor(Date.now() / 1000);

  if (nowSec >= fallbackAt) {
    console.log(`[degen-executor] all candidates failed & fallback window reached for round #${claim.account.roundId.toString()}, triggering auto_claim_degen_fallback`);
    try {
      const fallbackReason = 3; // NO_ROUTES_FOUND / all candidates exhausted
      const winner = claim.account.winner;

      const winnerAta = await getAssociatedTokenAddress(USDC_MINT, winner);
      const createWinnerAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        executor.publicKey,
        winnerAta,
        winner,
        USDC_MINT,
      );

      const prefixIxs: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: FALLBACK_CU_LIMIT }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: FALLBACK_PRIORITY_FEE }),
        createWinnerAtaIx,
      ];

      const fallbackIx = await buildAutoClaimDegenFallback(
        program,
        executor.publicKey,
        winner,
        claim.account.roundId.toNumber(),
        fallbackReason,
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

async function ensureExecutorAta(connection: Connection, executor: Keypair): Promise<void> {
  const executorUsdcAta = await getAssociatedTokenAddress(USDC_MINT, executor.publicKey);
  const info = await connection.getAccountInfo(executorUsdcAta, "confirmed");
  if (info) {
    console.log(`[degen-executor] executor USDC ATA exists: ${executorUsdcAta.toBase58()}`);
    return;
  }
  console.log(`[degen-executor] creating executor USDC ATA: ${executorUsdcAta.toBase58()}`);
  const ix = createAssociatedTokenAccountIdempotentInstruction(
    executor.publicKey,
    executorUsdcAta,
    executor.publicKey,
    USDC_MINT,
    TOKEN_PROGRAM_ID,
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: executor.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([executor]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`[degen-executor] executor USDC ATA created: ${sig}`);
}

async function main(): Promise<void> {
  const rpcUrl = envRequired("RPC_URL");
  const executor = loadKeypair(envRequired("DEGEN_EXECUTOR_KEYPAIR_PATH"));
  const connection = new Connection(rpcUrl, "confirmed");
  const program = createProgram(connection, executor);

  console.log(`[degen-executor] executor=${executor.publicKey.toBase58()} poll_ms=${POLL_MS} one_shot=${ONE_SHOT}`);

  // Load Jackpot ALT (optional — tx works without it but may be too large for complex routes)
  let jackpotAlt: AddressLookupTableAccount | null = null;
  if (JACKPOT_ALT_ADDRESS) {
    try {
      const altPubkey = new PublicKey(JACKPOT_ALT_ADDRESS);
      const result = await connection.getAddressLookupTable(altPubkey);
      if (result.value) {
        jackpotAlt = result.value;
        console.log(`[degen-executor] loaded Jackpot ALT: ${altPubkey.toBase58()} (${jackpotAlt.state.addresses.length} addresses)`);
      } else {
        console.warn(`[degen-executor] JACKPOT_ALT account not found: ${JACKPOT_ALT_ADDRESS}`);
      }
    } catch (err) {
      console.warn(`[degen-executor] failed to load JACKPOT_ALT: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log("[degen-executor] JACKPOT_ALT not set — using static keys (larger tx size)");
  }

  await ensureExecutorAta(connection, executor);

  do {
    try {
      const claims = await fetchReadyClaims(program);
      for (const claim of claims) {
        await processReadyClaim(connection, executor, claim, jackpotAlt);
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
