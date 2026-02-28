import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { SoarProgram } from "@magicblock-labs/soar-sdk";
import BN from "bn.js";

const RPC_URL = process.env.ACTIONS_RPC_URL || process.env.SOLANA_RPC_UPSTREAM;
const SOAR_GAME_PK_STR = process.env.SOAR_GAME_PK || "";
const SOAR_LEADERBOARD_PK_STR = process.env.SOAR_LEADERBOARD_PK || "";

function loadAuthorityKeypair(): Keypair {
  const raw = process.env.SOAR_AUTHORITY_KEYPAIR;
  if (!raw) throw new Error("SOAR_AUTHORITY_KEYPAIR env var is required");
  const secret = JSON.parse(raw);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function getConnection(): Connection {
  if (!RPC_URL) throw new Error("RPC URL env var is required");
  return new Connection(RPC_URL, "confirmed");
}

export default async function handler(req: any, res: any) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const playerStr = body?.player;
    const totalVolumeCents = body?.totalVolumeCents;

    if (!playerStr || typeof playerStr !== "string") {
      res.status(400).json({ error: "player is required" });
      return;
    }
    if (typeof totalVolumeCents !== "number" || totalVolumeCents <= 0) {
      res.status(400).json({ error: "totalVolumeCents must be a positive number" });
      return;
    }

    const connection = getConnection();
    const authority = loadAuthorityKeypair();
    const playerPk = new PublicKey(playerStr);
    const gamePk = new PublicKey(SOAR_GAME_PK_STR);
    const leaderboardPk = new PublicKey(SOAR_LEADERBOARD_PK_STR);

    const provider = new AnchorProvider(
      connection,
      new Wallet(authority),
      { commitment: "confirmed" }
    );
    const soar = SoarProgram.get(provider);

    const instructions: any[] = [];

    // Check if player account exists, if not — add initPlayer ix
    const [playerAccountPda] = soar.utils.derivePlayerAddress(playerPk);
    const playerAccountInfo = await connection.getAccountInfo(playerAccountPda);
    if (!playerAccountInfo) {
      const initResult = await soar.initializePlayerAccount(
        playerPk,
        playerStr.slice(0, 16),
        PublicKey.default
      );
      instructions.push(...initResult.transaction.instructions);
    }

    // Check if player is registered for this leaderboard, if not — add register ix
    const [playerScoresPda] = soar.utils.derivePlayerScoresListAddress(
      playerPk,
      leaderboardPk
    );
    const scoresInfo = await connection.getAccountInfo(playerScoresPda);
    if (!scoresInfo) {
      const regResult = await soar.registerPlayerEntryForLeaderBoard(
        playerPk,
        leaderboardPk
      );
      instructions.push(...regResult.transaction.instructions);
    }

    // Submit score
    const submitResult = await soar.submitScoreToLeaderBoard(
      playerPk,
      authority.publicKey,
      leaderboardPk,
      new BN(totalVolumeCents)
    );
    instructions.push(...submitResult.transaction.instructions);

    // Build and sign transaction
    const tx = new Transaction().add(...instructions);
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    res.status(200).json({ ok: true, signature });
  } catch (e: any) {
    console.error("SOAR submit error:", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
}
