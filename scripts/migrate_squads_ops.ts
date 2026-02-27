/**
 * Migrate protocol admin + treasury ATA to a Squads Ops vault PDA.
 *
 * Executes two admin txs (from current EOA admin):
 *   1) set_treasury_usdc_ata(new_treasury_ata, expected_owner = ops_vault_pda)
 *   2) transfer_admin(ops_vault_pda)
 *
 * Usage (devnet example):
 *   OPS_VAULT_PDA=<squads_vault_pda> \
 *   RPC_URL=https://api.devnet.solana.com \
 *   npx tsx scripts/migrate_squads_ops.ts
 *
 * Optional:
 *   ADMIN_KEYPAIR_PATH=../keypar.json
 *   OPS_TREASURY_USDC_ATA=<precreated_ata>   // otherwise derived from config.usdc_mint + OPS_VAULT_PDA
 *   DRY_RUN=1                                // print actions only, no txs
 */

try {
  // Optional local .env support if `dotenv` is installed in root project.
  await import("dotenv/config");
} catch {
  // Ignore — script also works with plain exported env vars.
}

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import IDL from "../src/idl/jackpot.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC = process.env.RPC_URL || "http://ash.rpc.gadflynode.com:80";
const PROGRAM_ID_STR = process.env.PROGRAM_ID;
const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR_PATH || resolve(__dirname, "../keypar.json");
const OPS_VAULT_PDA_STR = process.env.OPS_VAULT_PDA;
const OPS_TREASURY_USDC_ATA_STR = process.env.OPS_TREASURY_USDC_ATA;
const DRY_RUN =
  process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

const SEED_CFG = Buffer.from("cfg");

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function getProgramId(): PublicKey {
  if (PROGRAM_ID_STR) return new PublicKey(PROGRAM_ID_STR);
  const maybeAddress = (IDL as any).address || (IDL as any)?.metadata?.address;
  if (!maybeAddress) throw new Error("IDL missing program address");
  return new PublicKey(maybeAddress);
}

function short(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}

async function main() {
  if (!OPS_VAULT_PDA_STR) {
    throw new Error("Missing OPS_VAULT_PDA env var (Squads Ops vault PDA)");
  }

  const programId = getProgramId();
  const opsVaultPda = new PublicKey(OPS_VAULT_PDA_STR);
  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);

  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const idl = { ...(IDL as any), address: programId.toBase58() };
  const program = new Program(idl as any, provider);

  const [configPda] = PublicKey.findProgramAddressSync([SEED_CFG], programId);
  const cfg = await (program.account as any).config.fetch(configPda);

  const currentAdmin = new PublicKey(cfg.admin);
  const usdcMint = new PublicKey(cfg.usdcMint);
  const currentTreasury = new PublicKey(cfg.treasuryUsdcAta);

  const opsTreasuryAta = OPS_TREASURY_USDC_ATA_STR
    ? new PublicKey(OPS_TREASURY_USDC_ATA_STR)
    : await getAssociatedTokenAddress(usdcMint, opsVaultPda, true);

  console.log("=== Squads Ops Migration ===");
  console.log("RPC:", RPC);
  console.log("Program:", programId.toBase58());
  console.log("Config PDA:", configPda.toBase58());
  console.log("Signer (current admin EOA):", admin.publicKey.toBase58());
  console.log("Current config.admin:", currentAdmin.toBase58());
  console.log("Current treasury ATA:", currentTreasury.toBase58());
  console.log("USDC mint:", usdcMint.toBase58());
  console.log("Target Ops vault PDA:", opsVaultPda.toBase58());
  console.log("Target Ops treasury ATA:", opsTreasuryAta.toBase58());
  console.log("Dry run:", DRY_RUN ? "yes" : "no");
  console.log();

  if (!currentAdmin.equals(admin.publicKey)) {
    throw new Error(
      `Loaded signer ${short(admin.publicKey)} is not current config.admin ${short(currentAdmin)}`
    );
  }

  if (currentAdmin.equals(opsVaultPda) && currentTreasury.equals(opsTreasuryAta)) {
    console.log("Already migrated: admin and treasury ATA already match Squads Ops.");
    return;
  }

  if (DRY_RUN) {
    console.log("[DRY RUN] Would call set_treasury_usdc_ata(...)");
    console.log("[DRY RUN] Would call transfer_admin(...)");
    return;
  }

  // 1) Update treasury ATA first (while current EOA admin still has authority)
  if (!currentTreasury.equals(opsTreasuryAta)) {
    console.log("1/2 set_treasury_usdc_ata ->", opsTreasuryAta.toBase58());
    const sig1 = await (program.methods as any)
      .setTreasuryUsdcAta()
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        newTreasuryUsdcAta: opsTreasuryAta,
        expectedOwner: opsVaultPda,
      })
      .signers([admin])
      .rpc({ skipPreflight: true });
    console.log("  tx:", sig1);
  } else {
    console.log("1/2 set_treasury_usdc_ata skipped (already set)");
  }

  // 2) Transfer admin to Squads Ops vault PDA
  const cfgMid = await (program.account as any).config.fetch(configPda);
  const adminMid = new PublicKey(cfgMid.admin);
  const treasuryMid = new PublicKey(cfgMid.treasuryUsdcAta);

  if (!treasuryMid.equals(opsTreasuryAta)) {
    throw new Error(
      `Treasury ATA verification failed after step 1: ${treasuryMid.toBase58()} != ${opsTreasuryAta.toBase58()}`
    );
  }

  if (!adminMid.equals(opsVaultPda)) {
    console.log("2/2 transfer_admin ->", opsVaultPda.toBase58());
    const sig2 = await (program.methods as any)
      .transferAdmin(opsVaultPda)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
      })
      .signers([admin])
      .rpc({ skipPreflight: true });
    console.log("  tx:", sig2);
  } else {
    console.log("2/2 transfer_admin skipped (already set)");
  }

  const cfgAfter = await (program.account as any).config.fetch(configPda);
  console.log();
  console.log("=== Post-migration config ===");
  console.log("admin:", new PublicKey(cfgAfter.admin).toBase58());
  console.log("treasuryUsdcAta:", new PublicKey(cfgAfter.treasuryUsdcAta).toBase58());

  console.log();
  console.log("Next step (via Squads proposal):");
  console.log("  Call update_config(paused=true), then update_config(paused=false)");
  console.log("  If both pass, Ops vault PDA is wired correctly as config.admin.");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
