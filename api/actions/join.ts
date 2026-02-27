import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  actionEnvelope,
  actionUrl,
  buildActionTxResponse,
  fetchParsedConfig,
  fetchParsedRound,
  formatUsdcRaw,
  getConfigPda,
  getConnection,
  getParticipantPda,
  getReadOnlyProgram,
  getRoundPda,
  maybeHandleOptions,
  parseOptionalRoundId,
  parseBody,
  parseUsdcAmountRaw,
  requireAccount,
  resolveRoundId,
  withHandler,
} from "../../lib/api/actions-shared";
import { SystemProgram } from "@solana/web3.js";

async function getUserUsdcBalanceRaw(connection: any, ata: any): Promise<bigint> {
  try {
    const bal = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

export default async function handler(req: any, res: any) {
  if (maybeHandleOptions(req, res)) return;

  if (req.method === "GET") {
    return withHandler(req, res, async () => {
      const connection = getConnection();
      const queryRoundId = parseOptionalRoundId(req);
      const resolved = queryRoundId != null ? { roundId: queryRoundId, source: "query" as const } : await resolveRoundId(req, connection, "joinable");
      const round = await fetchParsedRound(connection, resolved.roundId);
      const base = "/api/actions/join";
      res.status(200).json(
        actionEnvelope({
          req,
          title: "roll2roll — Join Round (USDC)",
          description:
            "Fair, open, on-chain SocialFi jackpot on Solana. Join the latest open round with USDC.",
          label: "Join Round",
          links: {
            actions: [
              { label: "Join with 1 USDC", href: actionUrl(req, base, { roundId: resolved.roundId, amount: 1 }) },
              { label: "Join with 5 USDC", href: actionUrl(req, base, { roundId: resolved.roundId, amount: 5 }) },
              {
                label: "Custom amount",
                href: actionUrl(req, base, { roundId: resolved.roundId, amount: "{amount}" }),
                parameters: [{ name: "amount", label: "USDC amount" }],
              },
            ],
          },
          extra: {
            round: round
              ? {
                  id: resolved.roundId,
                  status: round.status,
                  potUsdc: Number(round.totalUsdc) / 1_000_000,
                  players: round.participantsCount,
                  endTs: Number(round.endTs),
                  source: resolved.source,
                }
              : { id: resolved.roundId, source: resolved.source },
          },
        })
      );
    });
  }

  if (req.method !== "POST") {
    return withHandler(req, res, async () => {
      res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST" } });
    });
  }

  await withHandler(req, res, async () => {
    const body = parseBody(req);
    const user = requireAccount(body);
    const amountRaw = parseUsdcAmountRaw(req);

    const connection = getConnection();
    const { roundId } = await resolveRoundId(req, connection, "joinable");
    const program = getReadOnlyProgram(connection);
    const rawConfig = await fetchParsedConfig(connection);
    const usdcMint = rawConfig.usdcMint as any;

    const userUsdcAta = await getAssociatedTokenAddress(usdcMint, user);
    const balanceBeforeRaw = await getUserUsdcBalanceRaw(connection, userUsdcAta);

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      user, // payer
      userUsdcAta,
      user,
      usdcMint
    );

    const roundPda = getRoundPda(roundId);
    const vaultUsdcAta = await getAssociatedTokenAddress(usdcMint, roundPda, true);
    const participantPda = getParticipantPda(roundPda, user);

    const depositIx = await (program.methods as any)
      .depositAny(new BN(roundId), new BN(balanceBeforeRaw.toString()), new BN(amountRaw.toString()))
      .accounts({
        user,
        config: getConfigPda(),
        round: roundPda,
        participant: participantPda,
        userUsdcAta,
        vaultUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const response = await buildActionTxResponse({
      connection,
      payer: user,
      instructions: [createAtaIx, depositIx],
      message: `Join round #${roundId} with ${formatUsdcRaw(amountRaw)} USDC`,
    });

    res.status(200).json(response);
  });
}
