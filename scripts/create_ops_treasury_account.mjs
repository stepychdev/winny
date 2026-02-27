/**
 * Create a treasury SPL token account owned by the Ops Squads vault PDA.
 *
 * This creates a standard SPL token account (not necessarily ATA). That is valid
 * for the current jackpot program checks (`mint` + `owner`), and is often simpler
 * for PDA owners.
 *
 * Defaults are loaded from `../addresses.json` (devnet):
 * - owner -> `devnet.squads.ops.vault_pda_index_0`
 * - mint  -> `devnet.protocol_config.usdc_mint`
 *
 * Recommended runtime:
 *   npx -y node@20 scripts/create_ops_treasury_account.mjs
 *
 * Required env:
 *   PAYER_KEYPAIR_PATH=./keypar.json
 *
 * Optional env:
 *   RPC_URL=https://api.devnet.solana.com
 *   OWNER_PUBKEY=<ops_vault_pda>
 *   MINT=<usdc_mint>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  createInitializeAccountInstruction,
  getAccount,
} from "@solana/spl-token";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function loadKeypair(filePath) {
  return Keypair.fromSecretKey(Uint8Array.from(readJson(filePath)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const addressesPath = path.resolve(REPO_ROOT, "addresses.json");
  const defaults = fs.existsSync(addressesPath) ? readJson(addressesPath) : null;

  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const payerPath = path.resolve(REPO_ROOT, process.env.PAYER_KEYPAIR_PATH || "./keypar.json");
  const ownerPubkey = new PublicKey(
    process.env.OWNER_PUBKEY || defaults?.devnet?.squads?.ops?.vault_pda_index_0
  );
  const mint = new PublicKey(
    process.env.MINT || defaults?.devnet?.protocol_config?.usdc_mint
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const payer = loadKeypair(payerPath);
  const tokenAccountKp = Keypair.generate();

  const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(AccountLayout.span);

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: tokenAccountKp.publicKey,
      lamports: rentExemptLamports,
      space: AccountLayout.span,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      tokenAccountKp.publicKey,
      mint,
      ownerPubkey,
      TOKEN_PROGRAM_ID
    )
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer, tokenAccountKp);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 20,
  });

  // Some RPC providers fail confirmation path under load; verify by state existence.
  let created = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const info = await connection.getAccountInfo(tokenAccountKp.publicKey, "processed");
    if (info) {
      created = true;
      break;
    }
    await sleep(2_000);
  }

  if (!created) {
    throw new Error(`Token account was not observed on-chain in time. tx=${signature}`);
  }

  try {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "processed"
    );
  } catch {
    // Non-fatal when account is already observed.
  }

  const tokenAccount = tokenAccountKp.publicKey;
  const acct = await getAccount(connection, tokenAccount, "confirmed");

  console.log(JSON.stringify({
    rpc: rpcUrl,
    payer: payer.publicKey.toBase58(),
    owner: ownerPubkey.toBase58(),
    mint: mint.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
    signature,
    amountRaw: acct.amount.toString(),
    createdAt: new Date().toISOString(),
    note: "Standard SPL token account owned by Ops vault PDA (works for current jackpot treasury checks).",
  }, null, 2));
}

main().catch((e) => {
  console.error("Failed to create Ops treasury token account:", e);
  process.exit(1);
});
