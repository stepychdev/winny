import {
  actionEnvelope,
  fetchParsedConfig,
  getConnection,
  getRoundPda,
  maybeHandleOptions,
  resolveRoundId,
  setActionHeaders,
  withHandler,
} from "../../lib/api/actions-shared";
import { parseRound } from "../../crank/src/parser.ts";

export default async function handler(req: any, res: any) {
  if (maybeHandleOptions(req, res)) return;
  if (req.method !== "GET") {
    return withHandler(req, res, async () => {
      setActionHeaders(res);
      res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } });
    });
  }

  await withHandler(req, res, async () => {
    const connection = getConnection();
    const { roundId, source } = await resolveRoundId(req, connection, "active");
    const [roundInfo, rawConfig] = await Promise.all([
      connection.getAccountInfo(getRoundPda(roundId), "confirmed"),
      fetchParsedConfig(connection),
    ]);
    const round = roundInfo ? parseRound(Buffer.from(roundInfo.data)) : null;
    if (!round) {
      res.status(404).json({ error: { code: "ROUND_NOT_FOUND", message: "Round not found" } });
      return;
    }
    const ticketUnit = BigInt(rawConfig.ticketUnit.toString());
    const minTotalTickets = BigInt(rawConfig.minTotalTickets.toString());
    res.status(200).json({
      ...actionEnvelope({
        req,
        title: `roll2roll — Round #${roundId}`,
        description: "Current or requested round details, including provably fair fields.",
        label: "Open Round",
        extra: {},
      }),
      project: "roll2roll",
      roundId,
      roundIdSource: source,
      status: round.status,
      totalUsdcRaw: round.totalUsdc.toString(),
      totalUsdc: Number(round.totalUsdc) / 1_000_000,
      totalTickets: round.totalTickets.toString(),
      participantsCount: round.participantsCount,
      endTs: Number(round.endTs),
      ticketUnitRaw: ticketUnit.toString(),
      minTotalTickets: minTotalTickets.toString(),
      minPotUsdc: Number(ticketUnit * minTotalTickets) / 1_000_000,
      provablyFair: {
        randomnessHex: Buffer.from(round.randomness).toString("hex"),
        winningTicket: round.winningTicket.toString(),
        winner: round.winner.toBase58(),
      },
    });
  });
}
