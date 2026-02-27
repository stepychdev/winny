import {
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createApproveInstruction,
  createRevokeInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
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
    "  RPC_URL=... JUPITER_API_KEY=... OWNER_KEYPAIR_PATH=... EXECUTOR_KEYPAIR_PATH=... \\",
    "  node scripts/spikes/jupiter_delegate_swap.mjs",
    "",
    "Optional env:",
    "  INPUT_MINT=<mint>               default: mainnet USDC",
    "  OUTPUT_MINT=<mint>              default: mainnet JUP",
    "  INPUT_AMOUNT_RAW=<integer>      default: 1000000",
    "  INPUT_AMOUNT_UI=<number>        alternative to raw amount",
    "  DESTINATION_OWNER=<pubkey>      default: owner wallet",
    "  DESTINATION_TOKEN_ACCOUNT=<ata> explicit destination ATA override",
    "  SLIPPAGE_BPS=<bps>              default: 100",
    "  EXECUTE=1                       send approve + swap instead of inspect/simulate only",
    "  REVOKE_AFTER=1                  revoke delegate after EXECUTE=1 attempt",
    "",
    "What it checks:",
    "  - whether Jupiter uses owner source ATA or executor ATA in swap accounts",
    "  - whether explicit destination ATA is honored",
    "  - whether delegated-source swap can simulate or execute",
  ]);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const connection = connectionFromEnv();
  const owner = loadKeypairFromEnv("OWNER_KEYPAIR_PATH");
  const executor = loadKeypairFromEnv("EXECUTOR_KEYPAIR_PATH");
  const inputMint = publicKeyFromEnv("INPUT_MINT", MAINNET_USDC_MINT);
  const outputMint = publicKeyFromEnv("OUTPUT_MINT", MAINNET_JUP_MINT);
  const destinationOwner = publicKeyFromEnv("DESTINATION_OWNER", owner.publicKey);
  const slippageBps = optionalNumberEnv("SLIPPAGE_BPS", 100);
  const execute = optionalBoolEnv("EXECUTE", false);
  const revokeAfter = optionalBoolEnv("REVOKE_AFTER", false);

  if (inputMint.equals(PublicKey.default)) {
    throw new Error("INPUT_MINT must be a valid SPL token mint");
  }

  const inputAmountRaw = await resolveInputAmountRaw(connection, inputMint);
  const ownerInputAta = await getAssociatedTokenAddress(inputMint, owner.publicKey);
  const executorInputAta = await getAssociatedTokenAddress(inputMint, executor.publicKey);
  const destinationOverride = publicKeyFromEnv("DESTINATION_TOKEN_ACCOUNT", null);
  const destinationSetup = destinationOverride
    ? { ata: destinationOverride, instruction: null }
    : await ensureAtaInstruction({
        connection,
        payer: executor.publicKey,
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
    userPublicKey: executor.publicKey,
    quoteResponse,
    destinationTokenAccount: destinationSetup.ata,
  });

  const instructions = [
    ...(destinationSetup.instruction ? [destinationSetup.instruction] : []),
    ...flattenSwapInstructions(swapIxs),
  ];
  const accounts = collectInstructionAccounts(instructions);
  const ownerInputAtaBase58 = ownerInputAta.toBase58();
  const executorInputAtaBase58 = executorInputAta.toBase58();
  const destinationAtaBase58 = destinationSetup.ata.toBase58();

  console.log("=== Jupiter Delegate Swap Spike ===");
  console.log(`RPC: ${process.env.RPC_URL}`);
  console.log(`Owner: ${owner.publicKey.toBase58()}`);
  console.log(`Executor: ${executor.publicKey.toBase58()}`);
  console.log(`Input mint: ${inputMint.toBase58()}`);
  console.log(`Output mint: ${outputMint.toBase58()}`);
  console.log(`Input raw: ${inputAmountRaw}`);
  console.log(`Route: ${routeLabels(quoteResponse) || "unknown"}`);
  console.log(`Owner input ATA: ${ownerInputAtaBase58}`);
  console.log(`Executor input ATA: ${executorInputAtaBase58}`);
  console.log(`Destination ATA: ${destinationAtaBase58}`);
  console.log(`Owner input ATA present in Jupiter tx: ${accounts.has(ownerInputAtaBase58)}`);
  console.log(`  ${describeAccountMatches(accounts, ownerInputAtaBase58)}`);
  console.log(`Executor input ATA present in Jupiter tx: ${accounts.has(executorInputAtaBase58)}`);
  console.log(`  ${describeAccountMatches(accounts, executorInputAtaBase58)}`);
  console.log(`Destination ATA present in Jupiter tx: ${accounts.has(destinationAtaBase58)}`);
  console.log(`  ${describeAccountMatches(accounts, destinationAtaBase58)}`);
  console.log(`Lookup tables: ${swapIxs.addressLookupTableAddresses.length}`);

  const { tx, latest } = await buildVersionedTx({
    connection,
    payer: executor.publicKey,
    instructions,
    altAddresses: swapIxs.addressLookupTableAddresses,
  });
  tx.sign([executor]);

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
    console.log("Inspect-only mode. Set EXECUTE=1 to send approve + swap.");
    return;
  }

  const approveIx = createApproveInstruction(
    ownerInputAta,
    executor.publicKey,
    owner.publicKey,
    BigInt(inputAmountRaw)
  );
  const approveTx = new Transaction().add(approveIx);
  const approveSig = await sendAndConfirmTransaction(connection, approveTx, [owner], {
    commitment: "confirmed",
  });
  console.log(`Approve sig: ${approveSig}`);

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

  if (revokeAfter) {
    const revokeIx = createRevokeInstruction(ownerInputAta, owner.publicKey);
    const revokeTx = new Transaction().add(revokeIx);
    const revokeSig = await sendAndConfirmTransaction(connection, revokeTx, [owner], {
      commitment: "confirmed",
    });
    console.log(`Revoke sig: ${revokeSig}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
