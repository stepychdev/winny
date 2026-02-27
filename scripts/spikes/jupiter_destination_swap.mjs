import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  MAINNET_JUP_MINT,
  MAINNET_USDC_MINT,
  buildVersionedTx,
  collectInstructionAccounts,
  connectionFromEnv,
  describeAccountMatches,
  ensureAtaInstruction,
  flattenSwapInstructions,
  getQuote,
  getSwapInstructions,
  loadKeypairFromEnv,
  optionalBoolEnv,
  optionalNumberEnv,
  printUsage,
  publicKeyFromEnv,
  resolveInputAmountRaw,
  routeLabels,
  simulateVersionedTx,
} from "../lib/jupiter_spike_utils.mjs";

function usage() {
  printUsage([
    "Usage:",
    "  RPC_URL=... JUPITER_API_KEY=... OWNER_KEYPAIR_PATH=... DESTINATION_OWNER=... \\",
    "  node scripts/spikes/jupiter_destination_swap.mjs",
    "",
    "Optional env:",
    "  INPUT_MINT=<mint>               default: mainnet USDC",
    "  OUTPUT_MINT=<mint>              default: mainnet JUP",
    "  INPUT_AMOUNT_RAW=<integer>      default: 1000000",
    "  INPUT_AMOUNT_UI=<number>        alternative to raw amount",
    "  DESTINATION_TOKEN_ACCOUNT=<ata> explicit destination ATA override",
    "  SLIPPAGE_BPS=<bps>              default: 100",
    "  EXECUTE=1                       send the swap instead of inspect/simulate only",
    "",
    "What it checks:",
    "  - whether Jupiter honors destinationTokenAccount",
    "  - whether the tx targets recipient ATA instead of owner's default output ATA",
  ]);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const connection = connectionFromEnv();
  const owner = loadKeypairFromEnv("OWNER_KEYPAIR_PATH");
  const destinationOwner = publicKeyFromEnv("DESTINATION_OWNER");
  if (!destinationOwner) {
    throw new Error("Missing required env: DESTINATION_OWNER");
  }
  const inputMint = publicKeyFromEnv("INPUT_MINT", MAINNET_USDC_MINT);
  const outputMint = publicKeyFromEnv("OUTPUT_MINT", MAINNET_JUP_MINT);
  const slippageBps = optionalNumberEnv("SLIPPAGE_BPS", 100);
  const execute = optionalBoolEnv("EXECUTE", false);

  const inputAmountRaw = await resolveInputAmountRaw(connection, inputMint);
  const ownerDefaultOutputAta = await getAssociatedTokenAddress(outputMint, owner.publicKey);
  const destinationOverride = publicKeyFromEnv("DESTINATION_TOKEN_ACCOUNT", null);
  const destinationSetup = destinationOverride
    ? { ata: destinationOverride, instruction: null }
    : await ensureAtaInstruction({
        connection,
        payer: owner.publicKey,
        owner: destinationOwner,
        mint: outputMint,
      });

  const quoteResponse = await getQuote({
    inputMint,
    outputMint,
    amount: inputAmountRaw,
    slippageBps,
  });
  const swapIxs = await getSwapInstructions({
    userPublicKey: owner.publicKey,
    quoteResponse,
    destinationTokenAccount: destinationSetup.ata,
  });

  const instructions = [
    ...(destinationSetup.instruction ? [destinationSetup.instruction] : []),
    ...flattenSwapInstructions(swapIxs),
  ];
  const accounts = collectInstructionAccounts(instructions);
  const destinationAtaBase58 = destinationSetup.ata.toBase58();
  const ownerDefaultOutputAtaBase58 = ownerDefaultOutputAta.toBase58();

  console.log("=== Jupiter Destination ATA Spike ===");
  console.log(`RPC: ${process.env.RPC_URL}`);
  console.log(`Owner: ${owner.publicKey.toBase58()}`);
  console.log(`Destination owner: ${destinationOwner.toBase58()}`);
  console.log(`Input mint: ${inputMint.toBase58()}`);
  console.log(`Output mint: ${outputMint.toBase58()}`);
  console.log(`Input raw: ${inputAmountRaw}`);
  console.log(`Route: ${routeLabels(quoteResponse) || "unknown"}`);
  console.log(`Owner default output ATA: ${ownerDefaultOutputAtaBase58}`);
  console.log(`Explicit destination ATA: ${destinationAtaBase58}`);
  console.log(`Explicit destination ATA present in Jupiter tx: ${accounts.has(destinationAtaBase58)}`);
  console.log(`  ${describeAccountMatches(accounts, destinationAtaBase58)}`);
  console.log(`Owner default output ATA present in Jupiter tx: ${accounts.has(ownerDefaultOutputAtaBase58)}`);
  console.log(`  ${describeAccountMatches(accounts, ownerDefaultOutputAtaBase58)}`);
  console.log(`Lookup tables: ${swapIxs.addressLookupTableAddresses.length}`);

  const { tx, latest } = await buildVersionedTx({
    connection,
    payer: owner.publicKey,
    instructions,
    altAddresses: swapIxs.addressLookupTableAddresses,
  });
  tx.sign([owner]);

  const sim = await simulateVersionedTx(connection, tx);
  console.log(`Serialized bytes: ${sim.serializedLength}`);
  console.log(`Simulation error: ${sim.value.err ? JSON.stringify(sim.value.err) : "none"}`);
  if (sim.value.logs?.length) {
    console.log("Simulation logs:");
    for (const line of sim.value.logs) {
      console.log(`  ${line}`);
    }
  }

  if (!execute) {
    console.log("Inspect-only mode. Set EXECUTE=1 to send the swap.");
    return;
  }

  const swapSig = await connection.sendTransaction(tx, {
    skipPreflight: false,
    maxRetries: 3,
  });
  const confirmation = await connection.confirmTransaction(
    {
      signature: swapSig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error(`Swap failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  console.log(`Swap sig: ${swapSig}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
