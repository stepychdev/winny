import type { GamePhase } from "../types";

export function shouldShowCancelRefundCard(args: {
  connected: boolean;
  hasMyDeposit: boolean;
  phase: GamePhase;
  timeLeft: number;
}): boolean {
  if (!args.connected) return false;
  if (!args.hasMyDeposit) return false;
  if (args.phase !== "open") return false;

  // Once a round countdown has started (timeLeft > 0), hide the cancel action in UI.
  return args.timeLeft <= 0;
}

