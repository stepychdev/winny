import { readFileSync } from "fs";
import path from "path";
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
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";

export const MAINNET_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const MAINNET_JUP_MINT = new PublicKey(
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"
);
export const JUPITER_API_BASE = "https://api.jup.ag";

function requiredEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function optionalBoolEnv(name, defaultValue = false) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function optionalNumberEnv(name, defaultValue) {
  const raw = (process.env[name] || "").trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env ${name}: ${raw}`);
  }
  return parsed;
}

export function loadKeypairFromEnv(envName) {
  const rawPath = requiredEnv(envName);
  const fullPath = path.resolve(process.cwd(), rawPath);
  const secret = JSON.parse(readFileSync(fullPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function connectionFromEnv() {
  const rpcUrl = requiredEnv("RPC_URL");
  return new Connection(rpcUrl, "confirmed");
}

export function publicKeyFromEnv(name, fallback = null) {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  return new PublicKey(raw);
}

export async function resolveInputAmountRaw(connection, inputMint) {
  const raw = (process.env.INPUT_AMOUNT_RAW || "").trim();
  if (raw) return raw;

  const uiRaw = (process.env.INPUT_AMOUNT_UI || "").trim();
  if (!uiRaw) {
    return "1000000";
  }

  const uiAmount = Number(uiRaw.replace(",", "."));
  if (!Number.isFinite(uiAmount) || uiAmount <= 0) {
    throw new Error(`Invalid INPUT_AMOUNT_UI: ${uiRaw}`);
  }

  const mintInfo = await getMint(connection, inputMint);
  const rawAmount = BigInt(Math.round(uiAmount * 10 ** mintInfo.decimals));
  return rawAmount.toString();
}

export async function jupiterFetchJson(pathname, options = {}) {
  const apiKey = requiredEnv("JUPITER_API_KEY");
  const response = await fetch(`${JUPITER_API_BASE}${pathname}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jupiter HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

export async function getQuote({
  inputMint,
  outputMint,
  amount,
  slippageBps,
}) {
  const params = new URLSearchParams({
    inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(),
    amount,
    slippageBps: String(slippageBps),
    swapMode: "ExactIn",
    restrictIntermediateTokens: "true",
  });

  return jupiterFetchJson(`/swap/v1/quote?${params.toString()}`);
}

export async function getSwapInstructions({
  userPublicKey,
  quoteResponse,
  destinationTokenAccount,
}) {
  const body = {
    userPublicKey: userPublicKey.toBase58(),
    quoteResponse,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  };

  if (destinationTokenAccount) {
    body.destinationTokenAccount = destinationTokenAccount.toBase58();
  }

  return jupiterFetchJson("/swap/v1/swap-instructions", {
    method: "POST",
    body,
  });
}

export async function getUltraOrder({
  inputMint,
  outputMint,
  amount,
  taker,
  receiver,
  payer,
  slippageBps,
}) {
  const params = new URLSearchParams({
    inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(),
    amount,
    taker: taker.toBase58(),
  });
  if (receiver) params.set("receiver", receiver.toBase58());
  if (payer) params.set("payer", payer.toBase58());
  if (slippageBps !== undefined && slippageBps !== null) {
    params.set("slippageBps", String(slippageBps));
  }
  return jupiterFetchJson(`/ultra/v1/order?${params.toString()}`);
}

export async function executeUltraOrder({
  signedTransaction,
  requestId,
}) {
  return jupiterFetchJson("/ultra/v1/execute", {
    method: "POST",
    body: {
      signedTransaction,
      requestId,
    },
  });
}

function deserializeInstruction(ix) {
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

export function flattenSwapInstructions(swapIxs) {
  const out = [];
  for (const ix of swapIxs.computeBudgetInstructions || []) {
    out.push(deserializeInstruction(ix));
  }
  for (const ix of swapIxs.setupInstructions || []) {
    out.push(deserializeInstruction(ix));
  }
  out.push(deserializeInstruction(swapIxs.swapInstruction));
  if (swapIxs.cleanupInstruction) {
    out.push(deserializeInstruction(swapIxs.cleanupInstruction));
  }
  return out;
}

export async function resolveAddressLookupTables(connection, addresses) {
  if (!addresses?.length) return [];

  const accounts = await connection.getMultipleAccountsInfo(
    addresses.map((address) => new PublicKey(address))
  );

  return accounts
    .map((account, index) => {
      if (!account) return null;
      return new AddressLookupTableAccount({
        key: new PublicKey(addresses[index]),
        state: AddressLookupTableAccount.deserialize(account.data),
      });
    })
    .filter(Boolean);
}

export async function resolveVersionedTxAddressLookupTables(connection, tx) {
  const lookups = tx.message.addressTableLookups || [];
  if (!lookups.length) return [];
  return resolveAddressLookupTables(
    connection,
    lookups.map((lookup) => lookup.accountKey.toBase58())
  );
}

export async function decompileVersionedTransaction(connection, tx) {
  const alts = await resolveVersionedTxAddressLookupTables(connection, tx);
  return TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: alts,
  });
}

export function requiredSignerPubkeys(tx) {
  const required = tx.message.header.numRequiredSignatures;
  return tx.message.staticAccountKeys.slice(0, required);
}

export function collectInstructionAccounts(instructions) {
  const out = new Map();
  instructions.forEach((instruction, instructionIndex) => {
    instruction.keys.forEach((key, keyIndex) => {
      const pubkey = key.pubkey.toBase58();
      if (!out.has(pubkey)) {
        out.set(pubkey, []);
      }
      out.get(pubkey).push({
        instructionIndex,
        keyIndex,
        isSigner: key.isSigner,
        isWritable: key.isWritable,
        programId: instruction.programId.toBase58(),
      });
    });
  });
  return out;
}

export async function ensureAtaInstruction({
  connection,
  payer,
  owner,
  mint,
}) {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const info = await connection.getAccountInfo(ata);
  if (info) {
    return { ata, instruction: null };
  }
  return {
    ata,
    instruction: createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      owner,
      mint
    ),
  };
}

export async function buildVersionedTx({
  connection,
  payer,
  instructions,
  altAddresses,
}) {
  const alts = await resolveAddressLookupTables(connection, altAddresses || []);
  const latest = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message(alts);

  return {
    tx: new VersionedTransaction(message),
    latest,
  };
}

export async function simulateVersionedTx(connection, tx) {
  const serializedLength = tx.serialize().length;
  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  return {
    serializedLength,
    value: sim.value,
  };
}

export function routeLabels(quoteResponse) {
  return (quoteResponse.routePlan || [])
    .map((route) => route.swapInfo?.label || "unknown")
    .join(" -> ");
}

export function describeAccountMatches(accounts, pubkey) {
  const matches = accounts.get(pubkey) || [];
  if (!matches.length) return "none";
  return matches
    .map(
      (match) =>
        `ix#${match.instructionIndex}/key#${match.keyIndex}` +
        ` signer=${match.isSigner ? "y" : "n"}` +
        ` writable=${match.isWritable ? "y" : "n"}` +
        ` program=${match.programId}`
    )
    .join(" | ");
}

export function printUsage(lines) {
  console.log(lines.join("\n"));
}
