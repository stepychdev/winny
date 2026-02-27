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
  const adminUsdcAta = getAssociatedTokenAddressSync(usdcMint, provider.wallet.publicKey);

  console.log("Round PDA:", roundPda.toBase58());
  console.log("Vault ATA:", vaultUsdcAta.toBase58());
  console.log("Admin ATA:", adminUsdcAta.toBase58());
  console.log("Admin:", provider.wallet.publicKey.toBase58());

  const tx = await program.methods
    .adminForceCancel(roundId)
    .accounts({
      admin: provider.wallet.publicKey,
      config: configPda,
      round: roundPda,
      vaultUsdcAta,
      adminUsdcAta,
    })
    .rpc();

  console.log("Force cancel TX:", tx);
}

main().catch(console.error);
