// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Jackpot } from "../target/types/jackpot";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Jackpot as Program<Jackpot>;
  const roundId = new BN(parseInt(process.argv[2] || "49"));

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("cfg")],
    program.programId
  );

  const [roundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), roundId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  const config = await program.account.config.fetch(configPda);
  const usdcMint = config.usdcMint;
  const vaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, roundPda, true);

  console.log("Round PDA:", roundPda.toBase58());
  console.log("Vault ATA:", vaultUsdcAta.toBase58());
  console.log("Recipient (payer):", provider.wallet.publicKey.toBase58());

  const tx = await program.methods
    .closeRound(roundId)
    .accounts({
      payer: provider.wallet.publicKey,
      recipient: provider.wallet.publicKey,
      round: roundPda,
      vaultUsdcAta,
    })
    .rpc();

  console.log("Close round TX:", tx);
}

main().catch(console.error);
