import {
  actionEnvelope,
  actionUrl,
  buildActionTxResponse,
  findLatestRefundableRoundId,
  getConfigPda,
  getConnection,
  getParticipantPda,
  getReadOnlyProgram,
  getRoundPda,
  fetchParsedConfig,
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

export default async function handler(req: any, res: any) {
  if (maybeHandleOptions(req, res)) return;

  if (req.method === "GET") {
    return withHandler(req, res, async () => {
      const account = parseOptionalAccountQuery(req);
      let roundId = parseOptionalRoundId(req);
      let eligibility: any = null;
      if (account) {
        try {
          const discovered = await findLatestRefundableRoundId(getConnection(), account);
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
            ...(serializeEligibilityError(e, "NO_REFUND_AVAILABLE") as any),
          };
        }
      }
      res.status(200).json({
        ...actionEnvelope({
          req,
          title: "roll2roll — Claim Refund",
          description: "Claim a refund from a cancelled round.",
          label: "Claim Refund",
          links: {
            actions: [
              {
                label: "Claim Refund",
                href: actionUrl(req, "/api/actions/claim-refund", roundId != null ? { roundId } : { roundId: "{roundId}" }),
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
    const user = requireAccount(body);

    const connection = getConnection();
    const queryRoundId = parseOptionalRoundId(req);
    const roundId =
      queryRoundId != null ? queryRoundId : await findLatestRefundableRoundId(connection, user);
    const program = getReadOnlyProgram(connection);
    const rawConfig = await fetchParsedConfig(connection);
    const roundPda = getRoundPda(roundId);
    const vaultAta = await getAssociatedTokenAddress(rawConfig.usdcMint, roundPda, true);
    const userUsdcAta = await getAssociatedTokenAddress(rawConfig.usdcMint, user);
    const ix = await (program.methods as any)
      .claimRefund(new BN(roundId))
      .accounts({
        config: getConfigPda(),
        round: roundPda,
        user,
        participant: getParticipantPda(roundPda, user),
        vaultUsdcAta: vaultAta,
        userUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const response = await buildActionTxResponse({
      connection,
      payer: user,
      instructions: [ix],
      message: `Claim refund for round #${roundId}`,
    });

    res.status(200).json(response);
  });
}
