import { PublicKey } from '@solana/web3.js';
import { getConfigPda, getRoundPda, getDegenClaimPda, PROGRAM_ID } from '../crank/src/constants.js';

console.log('PROGRAM_ID:', PROGRAM_ID.toBase58());
console.log('getConfigPda():', getConfigPda().toBase58());
console.log('getRoundPda(126):', getRoundPda(126).toBase58());

const winner = new PublicKey('Am3GWpaK5jGqNeRh3LwYgMkQtUES5BsRtrNj4Z5XSyo9');
console.log('getDegenClaimPda(126, winner):', getDegenClaimPda(126, winner).toBase58());

// Verify what should be expected on-chain
console.log('\nExpected from addresses.mainnet.json:');
console.log('  config_pda = AiSAQcaTTDop85B6vYjv8yYn3rkA9qwWZfiRPRJjhPi4');
console.log('  degen_claim = BhuEEBGrFiEjhxUxZKTV7BYoxKE1vqj6FxpofWv6M4yX');
