/**
 * Mint test USDC to a user wallet on devnet.
 *
 * Usage:
 *   npx tsx scripts/mint_test_usdc.ts <wallet_address> [amount_usdc]
 *
 * Example:
 *   npx tsx scripts/mint_test_usdc.ts 5Xyz...abc 100
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC = process.env.RPC_URL || "http://ash.rpc.gadflynode.com:80";
const USDC_MINT = new PublicKey("CujEFhFho2VeLBLmjvvwD4nUSNhXvSLx8QiziBBrWHYW");

async function main() {
  const wallet = process.argv[2];
  const amount = Number(process.argv[3] || "100");

  if (!wallet) {
    console.log("Usage: npx tsx scripts/mint_test_usdc.ts <wallet_address> [amount_usdc]");
    process.exit(1);
  }

  const userPubkey = new PublicKey(wallet);
  const keypairPath = resolve(__dirname, "../keypar.json");
  const secret = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));

  const connection = new Connection(RPC, "confirmed");

  console.log(`Minting ${amount} test USDC to ${userPubkey.toBase58()}...`);

  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    USDC_MINT,
    userPubkey
  );

  await mintTo(
    connection,
    admin,
    USDC_MINT,
    ata.address,
    admin,
    amount * 1e6
  );

  console.log(`Done! ATA: ${ata.address.toBase58()}, balance: ${amount} USDC`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
