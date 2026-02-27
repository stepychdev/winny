import { Keypair, Connection, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

let _serviceKeypair: Keypair | null = null;

/**
 * Load service wallet keypair from VITE_SERVICE_WALLET_KEY env var.
 * The env var should contain a JSON array of 64 bytes (same format as solana-keygen).
 */
export function getServiceKeypair(): Keypair | null {
  if (_serviceKeypair) return _serviceKeypair;

  const raw = import.meta.env.VITE_SERVICE_WALLET_KEY;
  if (!raw) {
    console.warn("VITE_SERVICE_WALLET_KEY not set — service wallet disabled");
    return null;
  }

  try {
    const bytes = JSON.parse(raw) as number[];
    _serviceKeypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
    console.log("Service wallet loaded:", _serviceKeypair.publicKey.toBase58());
    return _serviceKeypair;
  } catch (e) {
    console.error("Failed to parse VITE_SERVICE_WALLET_KEY:", e);
    return null;
  }
}

/**
 * Sign and send a transaction from the service wallet.
 * By default, preflight simulation is enabled — invalid txs are caught before hitting the chain.
 * Pass skipPreflight=true only for fire-and-forget operations (e.g. close_round after claim).
 */
export async function serviceSignAndSend(
  connection: Connection,
  ixs: TransactionInstruction[],
  opts?: { skipPreflight?: boolean }
): Promise<string> {
  const kp = getServiceKeypair();
  if (!kp) throw new Error("Service wallet not configured");

  const tx = new Transaction().add(...ixs);
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
    skipPreflight: opts?.skipPreflight ?? false,
    commitment: "confirmed",
  });
  return sig;
}
