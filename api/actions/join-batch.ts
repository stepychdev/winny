import {
  actionEnvelope,
  actionUrl,
  getConnection,
  maybeHandleOptions,
  parseBody,
  parseOptionalRoundId,
  requireAccount,
  resolveRoundId,
  withHandler,
} from "../../lib/api/actions-shared";

type BatchLegInput = {
  mint: string;
  amount: number;
};

function parseBatchLegs(req: any): BatchLegInput[] | null {
  const raw = req.query?.legs;
  if (raw == null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    const err: any = new Error("Invalid legs JSON");
    err.status = 400;
    err.code = "INVALID_LEGS";
    throw err;
  }
  if (!Array.isArray(parsed)) {
    const err: any = new Error("legs must be an array");
    err.status = 400;
    err.code = "INVALID_LEGS";
    throw err;
  }
  const legs = parsed as any[];
  if (legs.length === 0) {
    const err: any = new Error("legs must not be empty");
    err.status = 400;
    err.code = "INVALID_LEGS";
    throw err;
  }
  if (legs.length > 5) {
    const err: any = new Error("legs length too large (max 5 in action launcher)");
    err.status = 400;
    err.code = "INVALID_LEGS";
    throw err;
  }
  return legs.map((leg, i) => {
    if (!leg || typeof leg !== "object") {
      const err: any = new Error(`legs[${i}] must be object`);
      err.status = 400;
      err.code = "INVALID_LEGS";
      throw err;
    }
    const mint = String((leg as any).mint || "");
    const amount = Number((leg as any).amount);
    if (!mint || !Number.isFinite(amount) || amount <= 0) {
      const err: any = new Error(`legs[${i}] requires mint + amount>0`);
      err.status = 400;
      err.code = "INVALID_LEGS";
      throw err;
    }
    return { mint, amount };
  });
}

export default async function handler(req: any, res: any) {
  if (maybeHandleOptions(req, res)) return;

  if (req.method === "GET") {
    return withHandler(req, res, async () => {
      const connection = getConnection();
      const { roundId, source } = await resolveRoundId(req, connection, "joinable");
      const base = "/api/actions/join-batch";
      res.status(200).json(
        actionEnvelope({
          req,
          title: "roll2roll — Join Round (Batch / Multi-token)",
          description:
            "Open roll2roll in batch deposit mode. Use this for multi-token entry (Jupiter + batch flow handled in-app).",
          label: "Open Batch Deposit",
          links: {
            actions: [
              {
                label: "Open Batch Deposit",
                href: actionUrl(req, base, { roundId }),
              },
              {
                label: "Open with batch legs (JSON)",
                href: actionUrl(req, base, { roundId, legs: "{legs}" }),
                parameters: [{ name: "legs", label: "Batch legs JSON [{\"mint\":\"...\",\"amount\":1.23}]" }],
              },
            ],
          },
          extra: {
            round: { id: roundId, source },
            mode: "launcher",
            note: "Actions launcher opens the in-app batch flow (multi-tx orchestration may be required).",
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
    // Require a wallet for parity with other Actions and future agent flows.
    const body = parseBody(req);
    requireAccount(body);

    const connection = getConnection();
    const queryRoundId = parseOptionalRoundId(req);
    const roundId = queryRoundId != null ? queryRoundId : (await resolveRoundId(req, connection, "joinable")).roundId;
    const legs = parseBatchLegs(req);

    const uiUrl = new URL(actionUrl(req, "/", {}));
    uiUrl.searchParams.set("action", "join-batch");
    uiUrl.searchParams.set("roundId", String(roundId));
    if (legs) uiUrl.searchParams.set("legs", JSON.stringify(legs));

    res.status(200).json({
      type: "external-link",
      externalLink: uiUrl.toString(),
      message: `Open roll2roll batch deposit for round #${roundId}`,
    });
  });
}

