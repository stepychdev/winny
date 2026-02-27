import {
  actionEnvelope,
  actionUrl,
  findLatestClaimableRoundId,
  getConnection,
  maybeHandleOptions,
  parseBody,
  parseOptionalAccountQuery,
  parseOptionalRoundId,
  requireAccount,
  serializeEligibilityError,
  withHandler,
} from "../../lib/api/actions-shared";

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
            mode: "degen-lite",
          };
        } catch (e: any) {
          eligibility = {
            account: account.toBase58(),
            ...(serializeEligibilityError(e, "NO_UNCLAIMED_PRIZE") as any),
            mode: "degen-lite",
          };
        }
      }

      res.status(200).json({
        ...actionEnvelope({
          req,
          title: "roll2roll — Degen Claim (Lite)",
          description:
            "Open roll2roll degen claim flow. Lite degen claim is a 2-step flow in-app (USDC claim + Jupiter swap into a VRF-derived token).",
          label: "Open Degen Claim",
          links: {
            actions: [
              {
                label: "Open Degen Claim",
                href: actionUrl(req, "/api/actions/claim-degen", roundId != null ? { roundId } : { roundId: "{roundId}" }),
                ...(roundId == null ? { parameters: [{ name: "roundId", label: "Round ID" }] } : {}),
              },
            ],
          },
          extra: {
            mode: "launcher",
            ...(eligibility ? { eligibility } : {}),
            note: "This Action launches the existing in-app lite degen claim flow.",
          },
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
    const roundId = queryRoundId != null ? queryRoundId : await findLatestClaimableRoundId(connection, winner);

    const uiUrl = new URL(actionUrl(req, "/", {}));
    uiUrl.searchParams.set("action", "claim-degen");
    uiUrl.searchParams.set("roundId", String(roundId));

    res.status(200).json({
      type: "external-link",
      externalLink: uiUrl.toString(),
      message: `Open lite degen claim flow for round #${roundId}`,
    });
  });
}

