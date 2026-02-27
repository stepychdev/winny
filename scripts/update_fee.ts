/**
 * Update fee_bps via update_config.
 * Usage: npx tsx scripts/update_fee.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import IDL from "../src/idl/jackpot.json";
import { PROGRAM_ID, SEED_CFG } from "../src/lib/constants";

const RPC = process.env.RPC_URL || "http://ash.rpc.gadflynode.com:80";

async function main() {
  const keypairPath = resolve(__dirname, "../../keypar.json");
  const secret = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log("Admin:", admin.publicKey.toBase58());

  const connection = new Connection(RPC, "confirmed");
  const [configPda] = PublicKey.findProgramAddressSync([SEED_CFG], PROGRAM_ID);

  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );
  const program = new Program(IDL as any, provider);

  // Show current config
  const cfgBefore = await (program.account as any).config.fetch(configPda);
  console.log("Current fee_bps:", cfgBefore.feeBps);

  // Update fee to 0.25% (25 bps)
  const tx = await program.methods
    .updateConfig({
      feeBps: 25,
      ticketUnit: null,
      roundDurationSec: null,
      minParticipants: null,
      minTotalTickets: null,
      paused: null,
      maxDepositPerUser: null,
    })
    .accounts({
      admin: admin.publicKey,
      config: configPda,
    })
    .signers([admin])
    .rpc({ skipPreflight: true });

  console.log("update_config tx:", tx);

  // Verify
  const cfgAfter = await (program.account as any).config.fetch(configPda);
  console.log("New fee_bps:", cfgAfter.feeBps, `(${cfgAfter.feeBps / 100}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
