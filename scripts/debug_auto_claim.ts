import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import fs from 'fs';
import BN from 'bn.js';

// Force mainnet
process.env.NETWORK = 'mainnet';

import { createProgram, buildAutoClaimDegenFallback } from '../crank/src/instructions.js';
import { USDC_MINT, getDegenClaimPda, getRoundPda, getConfigPda, PROGRAM_ID } from '../crank/src/constants.js';

const conn = new Connection('https://mainnet.helius-rpc.com/?api-key=0e2371ae-b591-4662-b358-d47ccdb77906', 'confirmed');
const executor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./crank/degen-executor-keypair.json', 'utf8'))));
const program = createProgram(conn, executor);

const roundId = 126;
const winner = new PublicKey('Am3GWpaK5jGqNeRh3LwYgMkQtUES5BsRtrNj4Z5XSyo9');

const ix = await buildAutoClaimDegenFallback(
  program,
  executor.publicKey,
  winner,
  roundId,
  3,
  undefined,
);

console.log('ix data first 8 bytes:', Array.from(ix.data.slice(0, 8)));
console.log('expected discriminator:', [124, 50, 165, 11, 90, 249, 189, 166]);
console.log('ix data length:', ix.data.length);
console.log('accounts count:', ix.keys.length);
ix.keys.forEach((k: any, i: number) => {
  console.log(`  account[${i}]`, k.pubkey.toBase58(), k.isSigner ? 'signer' : '', k.isWritable ? 'writable' : '');
});

// Build and simulate
const winnerAta = await getAssociatedTokenAddress(USDC_MINT, winner);
const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
  executor.publicKey,
  winnerAta,
  winner,
  USDC_MINT,
);

const { blockhash } = await conn.getLatestBlockhash('confirmed');
const msg = new TransactionMessage({
  payerKey: executor.publicKey,
  recentBlockhash: blockhash,
  instructions: [createAtaIx, ix],
}).compileToV0Message();
const tx = new VersionedTransaction(msg);
tx.sign([executor]);

const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: 'processed' });
console.log('\nSimulation result:', JSON.stringify(sim.value.err));
if (sim.value.logs) {
  sim.value.logs.forEach(l => console.log('  ', l));
}
