// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
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

  // Read current config
  const before = await program.account.config.fetch(configPda);
  console.log("Current config:", {
    feeBps: before.feeBps,
    ticketUnit: before.ticketUnit.toString(),
    roundDurationSec: before.roundDurationSec,
    minParticipants: before.minParticipants,
    minTotalTickets: before.minTotalTickets.toString(),
  });

  // Update: round_duration_sec = 10
  console.log("\nUpdating round_duration_sec to 10...");
  const tx = await program.methods
    .updateConfig({
      feeBps: null,
      ticketUnit: null,
      roundDurationSec: 10,
      minParticipants: null,
      minTotalTickets: null,
      paused: null,
      maxDepositPerUser: null,
    })
    .rpc();

  console.log("TX:", tx);

  const after = await program.account.config.fetch(configPda);
  console.log("\nUpdated config:", {
    roundDurationSec: after.roundDurationSec,
  });
}

main().catch(console.error);
