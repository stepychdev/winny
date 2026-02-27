const { PublicKey, Connection } = require('@solana/web3.js');
const BN = require('bn.js');
require('dotenv').config({ path: '../../.env' });

async function main() {
  const conn = new Connection(process.env.RPC_URL || 'http://ash.rpc.gadflynode.com:80');
  const programId = new PublicKey('4PhNzNQ7XZAPrFmwcBFMe2ZY8ZaQWos8nJjcsjv1CHyh');

  for (const id of [51, 52, 53]) {
    const roundId = new BN(id);
    const [roundPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('round'), roundId.toArrayLike(Buffer, 'le', 8)], programId
    );
    const info = await conn.getAccountInfo(roundPda);
    if (!info) {
      console.log('Round #' + id + ': NULL');
      continue;
    }
    console.log('Round #' + id + ': ' + info.data.length + ' bytes, owner: ' + info.owner.toBase58().substring(0, 12) + ', lamports: ' + info.lamports);
    console.log('  first 20 bytes: ' + Buffer.from(info.data.slice(0, 20)).toString('hex'));
    // status byte at offset 16
    console.log('  status byte: ' + info.data[16]);
  }
}
main().catch(console.error);
