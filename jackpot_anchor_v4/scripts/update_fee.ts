// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Jackpot } from "../target/types/jackpot";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Jackpot as Program<Jackpot>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("cfg")],
    program.programId
  );

  console.log("Updating fee_bps to 25 (0.25%)...");

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
    .rpc();

  console.log("TX:", tx);

  const config = await program.account.config.fetch(configPda);
  console.log("New fee_bps:", config.feeBps);
}

main().catch(console.error);
