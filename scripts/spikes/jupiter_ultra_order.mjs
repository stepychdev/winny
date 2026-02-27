import {
  PublicKey,
  sendAndConfirmRawTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  MAINNET_JUP_MINT,
  MAINNET_USDC_MINT,
  collectInstructionAccounts,
  connectionFromEnv,
  decompileVersionedTransaction,
  describeAccountMatches,
  executeUltraOrder,
  getUltraOrder,
  loadKeypairFromEnv,
  optionalBoolEnv,
  optionalNumberEnv,
  printUsage,
  publicKeyFromEnv,
  requiredSignerPubkeys,
  resolveInputAmountRaw,
  routeLabels,
  simulateVersionedTx,
} from "../lib/jupiter_spike_utils.mjs";

function usage() {
  printUsage([
    "Usage:",
    "  RPC_URL=... JUPITER_API_KEY=... TAKER_KEYPAIR_PATH=... \\",
    "  node scripts/spikes/jupiter_ultra_order.mjs",
    "",
    "Optional env:",
    "  INPUT_MINT=<mint>               default: mainnet USDC",
    "  OUTPUT_MINT=<mint>              default: mainnet JUP",
    "  INPUT_AMOUNT_RAW=<integer>      default: 1000000",
    "  INPUT_AMOUNT_UI=<number>        alternative to raw amount",
    "  RECEIVER_PUBLIC_KEY=<pubkey>    default: taker",
    "  PAYER_KEYPAIR_PATH=<path>       optional separate fee payer signer",
    "  SLIPPAGE_BPS=<bps>              optional",
    "  EXECUTE=1                       send via ultra /execute after inspection",
    "",
    "What it checks:",
    "  - whether Ultra order uses taker source ATA",
    "  - whether receiver affects destination only",
    "  - whether payer can be separate from taker",
  ]);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const connection = connectionFromEnv();
  const taker = loadKeypairFromEnv("TAKER_KEYPAIR_PATH");
  const payer = process.env.PAYER_KEYPAIR_PATH
    ? loadKeypairFromEnv("PAYER_KEYPAIR_PATH")
    : null;
  const receiver = publicKeyFromEnv("RECEIVER_PUBLIC_KEY", taker.publicKey);
  const inputMint = publicKeyFromEnv("INPUT_MINT", MAINNET_USDC_MINT);
  const outputMint = publicKeyFromEnv("OUTPUT_MINT", MAINNET_JUP_MINT);
  const slippageBps = process.env.SLIPPAGE_BPS
    ? optionalNumberEnv("SLIPPAGE_BPS", 0)
    : undefined;
  const execute = optionalBoolEnv("EXECUTE", false);

  const amount = await resolveInputAmountRaw(connection, inputMint);
  const takerInputAta = await getAssociatedTokenAddress(inputMint, taker.publicKey);
  const payerInputAta = payer
    ? await getAssociatedTokenAddress(inputMint, payer.publicKey)
    : null;
  const takerOutputAta = await getAssociatedTokenAddress(outputMint, taker.publicKey);
  const receiverOutputAta = await getAssociatedTokenAddress(outputMint, receiver);

  const order = await getUltraOrder({
    inputMint,
    outputMint,
    amount,
    taker: taker.publicKey,
    receiver,
    payer: payer?.publicKey || null,
    slippageBps,
  });

  if (!order?.transaction) {
    throw new Error(`Ultra order response missing transaction: ${JSON.stringify(order)}`);
  }

  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  const decompiled = await decompileVersionedTransaction(connection, tx);
  const accounts = collectInstructionAccounts(decompiled.instructions);
  const requiredSigners = requiredSignerPubkeys(tx).map((key) => key.toBase58());

  console.log("=== Jupiter Ultra Order Spike ===");
  console.log(`RPC: ${process.env.RPC_URL}`);
  console.log(`Taker: ${taker.publicKey.toBase58()}`);
  console.log(`Receiver: ${receiver.toBase58()}`);
  console.log(`Payer: ${(payer?.publicKey || taker.publicKey).toBase58()}`);
  console.log(`Input mint: ${inputMint.toBase58()}`);
  console.log(`Output mint: ${outputMint.toBase58()}`);
  console.log(`Input raw: ${amount}`);
  console.log(`Route: ${routeLabels(order) || "unknown"}`);
  console.log(`Request ID: ${order.requestId || "n/a"}`);
  if (order.router) console.log(`Router: ${order.router}`);
  if (order.mode) console.log(`Mode: ${order.mode}`);
  console.log(`Required signers: ${requiredSigners.join(", ") || "none"}`);
  console.log(`Taker input ATA: ${takerInputAta.toBase58()}`);
  console.log(`  present: ${accounts.has(takerInputAta.toBase58())}`);
  console.log(`  ${describeAccountMatches(accounts, takerInputAta.toBase58())}`);
  if (payerInputAta) {
    console.log(`Payer input ATA: ${payerInputAta.toBase58()}`);
    console.log(`  present: ${accounts.has(payerInputAta.toBase58())}`);
    console.log(`  ${describeAccountMatches(accounts, payerInputAta.toBase58())}`);
  }
  console.log(`Taker output ATA: ${takerOutputAta.toBase58()}`);
  console.log(`  present: ${accounts.has(takerOutputAta.toBase58())}`);
  console.log(`  ${describeAccountMatches(accounts, takerOutputAta.toBase58())}`);
  console.log(`Receiver output ATA: ${receiverOutputAta.toBase58()}`);
  console.log(`  present: ${accounts.has(receiverOutputAta.toBase58())}`);
  console.log(`  ${describeAccountMatches(accounts, receiverOutputAta.toBase58())}`);

  const signers = [taker];
  if (payer && !payer.publicKey.equals(taker.publicKey)) {
    signers.push(payer);
  }
  tx.sign(signers);

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
    console.log("Inspect-only mode. Set EXECUTE=1 to send via Ultra execute.");
    return;
  }

  const signedTransaction = Buffer.from(tx.serialize()).toString("base64");
  const executeResult = await executeUltraOrder({
    signedTransaction,
    requestId: order.requestId,
  });
  console.log("Ultra execute response:");
  console.log(JSON.stringify(executeResult, null, 2));

  if (executeResult?.signature) {
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      {
        signature: executeResult.signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
    console.log(`Confirmed signature: ${executeResult.signature}`);
  } else if (executeResult?.transaction) {
    const executeTx = VersionedTransaction.deserialize(
      Buffer.from(executeResult.transaction, "base64")
    );
    const sig = await sendAndConfirmRawTransaction(connection, executeTx.serialize(), {
      skipPreflight: false,
      commitment: "confirmed",
    });
    console.log(`Fallback raw send signature: ${sig}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
