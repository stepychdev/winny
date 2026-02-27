import {
  actionEnvelope,
  actionUrl,
  buildActionTxResponse,
  fetchParsedConfig,
  findLatestClaimableRoundId,
  getConfigPda,
  getConnection,
  getReadOnlyProgram,
  getRoundPda,
  maybeHandleOptions,
  parseOptionalAccountQuery,
  parseOptionalRoundId,
  parseBody,
  requireAccount,
  serializeEligibilityError,
  withHandler,
} from "../../lib/api/actions-shared";
import BN from "bn.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { parseRound } from "../../crank/src/parser.ts";

export default async function handler(req: any, res: any) {
  if (maybeHandleOptions(req, res)) return;

  if (req.method === "GET") {
    return withHandler(req, res, async () => {
      const account = parseOptionalAccountQuery(req);
      let roundId = parseOptionalRoundId(req);
      let eligibility: any = null;
      if (account) {
        try {
          const discovered = await findLatestClaimableRoundId(getConnection(), account);
          if (roundId == null) roundId = discovered;
          eligibility = {
            eligible: true,
            account: account.toBase58(),
            roundId: discovered,
            source: roundId === discovered ? "wallet-auto" : "query",
          };
        } catch (e: any) {
          eligibility = {
            account: account.toBase58(),
            ...(serializeEligibilityError(e, "NO_UNCLAIMED_PRIZE") as any),
          };
        }
      }
      res.status(200).json({
        ...actionEnvelope({
          req,
          title: "roll2roll — Claim Prize (USDC)",
          description: "Claim your roll2roll prize in classic USDC mode.",
          label: "Claim Prize",
          links: {
            actions: [
              {
                label: "Claim Prize",
                href: actionUrl(req, "/api/actions/claim", roundId != null ? { roundId } : { roundId: "{roundId}" }),
                ...(roundId == null ? { parameters: [{ name: "roundId", label: "Round ID" }] } : {}),
              },
            ],
          },
          extra: eligibility ? { eligibility } : undefined,
        }),
      });
    });
  }

  if (req.method !== "POST") {
    return withHandler(req, res, async () => {
      res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST" } });
    });
  }

  await withHandler(req, res, async () => {
    const body = parseBody(req);
    const winner = requireAccount(body);

    const connection = getConnection();
    const queryRoundId = parseOptionalRoundId(req);
    const roundId =
      queryRoundId != null ? queryRoundId : await findLatestClaimableRoundId(connection, winner);
    const program = getReadOnlyProgram(connection);
    const [rawConfig, roundInfo] = await Promise.all([
      fetchParsedConfig(connection),
      connection.getAccountInfo(getRoundPda(roundId), "confirmed"),
    ]);
    if (!roundInfo) {
      const err: any = new Error("Round not found");
      err.status = 404;
      err.code = "ROUND_NOT_FOUND";
      throw err;
    }
    const round = parseRound(Buffer.from(roundInfo.data));
    const usdcMint = rawConfig.usdcMint as any;
    const treasuryUsdcAta = rawConfig.treasuryUsdcAta as any;

    const roundPda = getRoundPda(roundId);
    const vaultUsdcAta = await getAssociatedTokenAddress(usdcMint, roundPda, true);
    const winnerUsdcAta = await getAssociatedTokenAddress(usdcMint, winner);
    let vrfPayerUsdcAta: any = null;
    if (round.vrfPayer && !round.vrfPayer.equals(PublicKey.default)) {
      vrfPayerUsdcAta = await getAssociatedTokenAddress(usdcMint, round.vrfPayer);
    }

    const claimIx = await (program.methods as any)
      .claim(new BN(roundId))
      .accounts({
        winner,
        config: getConfigPda(),
        round: roundPda,
        vaultUsdcAta,
        winnerUsdcAta,
        treasuryUsdcAta,
        vrfPayerUsdcAta: vrfPayerUsdcAta as any,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const response = await buildActionTxResponse({
      connection,
      payer: winner,
      instructions: [claimIx],
      message: `Claim roll2roll prize for round #${roundId} (USDC)`,
    });

    res.status(200).json(response);
  });
}
