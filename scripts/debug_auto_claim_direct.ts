/**
 * Direct simulation of auto_claim_degen_fallback for round 126 on mainnet.
 * Bypasses Anchor SDK to manually construct the instruction.
 */
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createHash } from 'crypto';
import fs from 'fs';
import BN from 'bn.js';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=0e2371ae-b591-4662-b358-d47ccdb77906';
const conn = new Connection(RPC, 'confirmed');

const PROGRAM_ID = new PublicKey('3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SEED_CFG = Buffer.from('cfg');
const SEED_ROUND = Buffer.from('round');
const SEED_DEGEN_CLAIM = Buffer.from('degen_claim');

const executor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./crank/degen-executor-keypair.json', 'utf8'))));
const winner = new PublicKey('Am3GWpaK5jGqNeRh3LwYgMkQtUES5BsRtrNj4Z5XSyo9');
const roundId = 126;

// Compute discriminator
const disc = createHash('sha256').update('global:auto_claim_degen_fallback').digest().subarray(0, 8);
console.log('discriminator:', Array.from(disc));

// PDAs
const [configPda] = PublicKey.findProgramAddressSync([SEED_CFG], PROGRAM_ID);
const roundIdBuf = Buffer.alloc(8);
roundIdBuf.writeBigUInt64LE(BigInt(roundId));
const [roundPda] = PublicKey.findProgramAddressSync([SEED_ROUND, roundIdBuf], PROGRAM_ID);
const [degenClaimPda] = PublicKey.findProgramAddressSync(
  [SEED_DEGEN_CLAIM, roundIdBuf, winner.toBuffer()],
  PROGRAM_ID
);

console.log('PROGRAM_ID:', PROGRAM_ID.toBase58());
console.log('configPda:', configPda.toBase58());
console.log('roundPda:', roundPda.toBase58());
console.log('degenClaimPda:', degenClaimPda.toBase58());

// Vault & ATAs
const vaultAta = await getAssociatedTokenAddress(USDC_MINT, roundPda, true);
const winnerAta = await getAssociatedTokenAddress(USDC_MINT, winner);
const treasuryAta = new PublicKey('8dccLsxnj9jwfEeokJrQH2wioJz4sS3mEQGd3miWB5YE');

console.log('vaultAta:', vaultAta.toBase58());
console.log('winnerAta:', winnerAta.toBase58());
console.log('treasuryAta:', treasuryAta.toBase58());

// Check VRF payer from round data
const roundInfo = await conn.getAccountInfo(roundPda);
if (!roundInfo) throw new Error('Round not found');
const vrfPayerBytes = roundInfo.data.subarray(8 + 8176, 8 + 8176 + 32);
const vrfPayer = new PublicKey(vrfPayerBytes);
console.log('vrfPayer:', vrfPayer.toBase58());
const isVrfPayerSet = !vrfPayer.equals(PublicKey.default);
console.log('vrfPayer is set:', isVrfPayerSet);

// Build instruction data: disc(8) + round_id(8, LE) + fallback_reason(1)
const ixData = Buffer.alloc(17);
disc.copy(ixData, 0);
ixData.writeBigUInt64LE(BigInt(roundId), 8);
ixData.writeUInt8(3, 16); // fallback_reason
console.log('ixData hex:', ixData.toString('hex'));
console.log('ixData length:', ixData.length);

// Build accounts (8 or 10 depending on VRF payer)
const keys = [
  { pubkey: executor.publicKey, isSigner: true, isWritable: true }, // payer
  { pubkey: configPda, isSigner: false, isWritable: false },          // config
  { pubkey: roundPda, isSigner: false, isWritable: true },            // round
  { pubkey: degenClaimPda, isSigner: false, isWritable: true },       // degen_claim
  { pubkey: vaultAta, isSigner: false, isWritable: true },            // vault_usdc_ata
  { pubkey: winnerAta, isSigner: false, isWritable: true },           // winner_usdc_ata
  { pubkey: treasuryAta, isSigner: false, isWritable: true },         // treasury_usdc_ata
];

if (isVrfPayerSet) {
  const vrfPayerAta = await getAssociatedTokenAddress(USDC_MINT, vrfPayer);
  keys.push(
    { pubkey: vrfPayer, isSigner: false, isWritable: true },  // vrf_payer_authority
    { pubkey: vrfPayerAta, isSigner: false, isWritable: true }, // vrf_payer_usdc_ata
  );
}

keys.push({ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }); // token_program

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys,
  data: ixData,
});

console.log('\nAccounts:');
ix.keys.forEach((k, i) => {
  console.log(`  [${i}] ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${k.isWritable}`);
});

// Create ATA idempotent instructions
const prefixIxs: TransactionInstruction[] = [
  createAssociatedTokenAccountIdempotentInstruction(executor.publicKey, winnerAta, winner, USDC_MINT),
];
if (isVrfPayerSet) {
  const vrfPayerAta = await getAssociatedTokenAddress(USDC_MINT, vrfPayer);
  prefixIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(executor.publicKey, vrfPayerAta, vrfPayer, USDC_MINT)
  );
}

const { blockhash } = await conn.getLatestBlockhash('confirmed');
const msg = new TransactionMessage({
  payerKey: executor.publicKey,
  recentBlockhash: blockhash,
  instructions: [...prefixIxs, ix],
}).compileToV0Message();
const tx = new VersionedTransaction(msg);
tx.sign([executor]);

const SEND = process.env.SEND === '1';

if (SEND) {
  console.log('\nSending transaction...');
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
  console.log('Signature:', sig);
  const confirmation = await conn.confirmTransaction(sig, 'confirmed');
  console.log('Confirmed:', JSON.stringify(confirmation.value));
} else {
  console.log('\nSimulating (set SEND=1 to send)...');
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: 'processed' });
  console.log('Error:', JSON.stringify(sim.value.err));
  if (sim.value.logs) {
    console.log('Logs:');
    sim.value.logs.forEach(l => console.log('  ', l));
  }
  console.log('Units consumed:', sim.value.unitsConsumed);
}
