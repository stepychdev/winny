import { RoundStatus } from "./constants";
import type { GamePhase } from "../types";

export function phaseFromStatus(status: number, endTs: bigint, nowSec: number): GamePhase {
  if (status === RoundStatus.Cancelled) return "cancelled";
  if (status === RoundStatus.Claimed) return "claimed";
  if (status === RoundStatus.Settled) return "settled";
  if (status === RoundStatus.VrfRequested || status === RoundStatus.Locked) return "spinning";
  if (status === RoundStatus.Open) {
    const end = Number(endTs);
    if (end > 0 && nowSec >= end) return "countdown";
    if (end > 0 && end - nowSec <= 6) return "countdown";
    return "open";
  }
  return "waiting";
}

