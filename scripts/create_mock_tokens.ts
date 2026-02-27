/**
 * Create 10 mock SPL tokens with Metaplex metadata on devnet.
 *
 * Usage:
 *   npx tsx scripts/create_mock_tokens.ts
 *
 * Requires: keypair at ../keypar.json (admin + mint authority + payer)
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createMetadataAccountV3,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  publicKey as umiPublicKey,
  signerIdentity,
  createSignerFromKeypair as umiCreateSigner,
  none,
} from "@metaplex-foundation/umi";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC = process.env.RPC_URL || "http://ash.rpc.gadflynode.com:80";
const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// GitHub raw URL base for metadata JSON
const METADATA_BASE_URL =
  "https://raw.githubusercontent.com/stepychdev/xyzcasino/master/public/metadata";

// Wallets to receive minted tokens
const WALLET_1 = new PublicKey("B4RSFCHfHGspoXRu4FnfYXM6s7GEYkQfsJeDm9ABMzjJ");
const WALLET_2 = new PublicKey("5mjKaFPXX6J4vmcyS1W7u8ostx5Rt1A9knigbpjnQof5");

const MINT_AMOUNT = 10_000; // 10,000 tokens per wallet

interface MockToken {
  name: string;
  symbol: string;
  decimals: number;
}

const MOCK_TOKENS: MockToken[] = [
  { name: "Gold Token", symbol: "GOLD", decimals: 6 },
  { name: "Silver Token", symbol: "SLVR", decimals: 6 },
  { name: "Diamond Token", symbol: "DIAM", decimals: 6 },
  { name: "Ruby Token", symbol: "RUBY", decimals: 6 },
  { name: "Jade Token", symbol: "JADE", decimals: 6 },
  { name: "Onyx Token", symbol: "ONYX", decimals: 6 },
  { name: "Opal Token", symbol: "OPAL", decimals: 6 },
  { name: "Amethyst Token", symbol: "AMTH", decimals: 6 },
  { name: "Sapphire Token", symbol: "SAPH", decimals: 6 },
  { name: "Emerald Token", symbol: "EMRL", decimals: 6 },
];

function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  return pda;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build createMetadataAccountV3 instruction manually using borsh serialization.
 * This avoids Umi compatibility issues with @solana/web3.js v1.
 */
function buildCreateMetadataV3Ix(
  metadataPda: PublicKey,
  mint: PublicKey,
  authority: PublicKey,
  name: string,
  symbol: string,
  uri: string
): TransactionInstruction {
  // Discriminator for CreateMetadataAccountV3 = 33
  const discriminator = Buffer.from([33]);

  // Serialize DataV2
  const nameBytes = Buffer.from(name);
  const symbolBytes = Buffer.from(symbol);
  const uriBytes = Buffer.from(uri);

  const parts: Buffer[] = [];

  // discriminator
  parts.push(discriminator);

  // name (string: u32 len + bytes)
  const nameLenBuf = Buffer.alloc(4);
  nameLenBuf.writeUInt32LE(nameBytes.length);
  parts.push(nameLenBuf, nameBytes);

  // symbol (string: u32 len + bytes)
  const symbolLenBuf = Buffer.alloc(4);
  symbolLenBuf.writeUInt32LE(symbolBytes.length);
  parts.push(symbolLenBuf, symbolBytes);

  // uri (string: u32 len + bytes)
  const uriLenBuf = Buffer.alloc(4);
  uriLenBuf.writeUInt32LE(uriBytes.length);
  parts.push(uriLenBuf, uriBytes);

  // sellerFeeBasisPoints (u16)
  const feeBuf = Buffer.alloc(2);
  feeBuf.writeUInt16LE(0);
  parts.push(feeBuf);

  // creators: Option<Vec<Creator>> = None (0)
  parts.push(Buffer.from([0]));

  // collection: Option<Collection> = None (0)
  parts.push(Buffer.from([0]));

  // uses: Option<Uses> = None (0)
  parts.push(Buffer.from([0]));

  // isMutable (bool)
  parts.push(Buffer.from([1]));

  // collectionDetails: Option<CollectionDetails> = None (0)
  parts.push(Buffer.from([0]));

  const data = Buffer.concat(parts);

  const keys = [
    { pubkey: metadataPda, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: false }, // mint authority
    { pubkey: authority, isSigner: true, isWritable: true },  // payer
    { pubkey: authority, isSigner: false, isWritable: false }, // update authority
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // rent sysvar (optional, but some versions require it)
  ];

  return new TransactionInstruction({
    programId: METADATA_PROGRAM_ID,
    keys,
    data,
  });
}

async function main() {
  const keypairPath = resolve(__dirname, "../keypar.json");
  const secret = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection(RPC, "confirmed");

  console.log("Admin:", admin.publicKey.toBase58());
  const balance = await connection.getBalance(admin.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  const results: { mint: string; name: string; symbol: string }[] = [];

  for (const token of MOCK_TOKENS) {
    console.log(`\n--- Creating ${token.symbol} (${token.name}) ---`);

    // 1. Create mint
    const mint = await createMint(
      connection,
      admin,
      admin.publicKey, // mint authority
      null, // freeze authority
      token.decimals
    );
    console.log(`  Mint: ${mint.toBase58()}`);

    // 2. Create Metaplex metadata
    const metadataPda = getMetadataPda(mint);
    const metadataUri = `${METADATA_BASE_URL}/${token.symbol}.json`;

    const createMetadataIx = buildCreateMetadataV3Ix(
      metadataPda,
      mint,
      admin.publicKey,
      token.name,
      token.symbol,
      metadataUri
    );

    const tx = new Transaction().add(createMetadataIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [admin], {
      skipPreflight: true,
    });
    console.log(`  Metadata tx: ${sig}`);

    // 3. Mint to both wallets
    for (const wallet of [WALLET_1, WALLET_2]) {
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        mint,
        wallet
      );
      await mintTo(
        connection,
        admin,
        mint,
        ata.address,
        admin,
        MINT_AMOUNT * 10 ** token.decimals
      );
      console.log(
        `  Minted ${MINT_AMOUNT} ${token.symbol} to ${wallet.toBase58().slice(0, 8)}...`
      );
    }

    results.push({
      mint: mint.toBase58(),
      name: token.name,
      symbol: token.symbol,
    });

    // Rate limit: devnet has low rate limits
    await sleep(1000);
  }

  console.log("\n\n=== CREATED TOKENS ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
