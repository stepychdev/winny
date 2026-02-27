/**
 * Tapestry social bridge — publishes game events from the crank to Tapestry.
 *
 * The crank is the only component that reliably observes round settlement,
 * so it's responsible for publishing `win` events that appear in followers' feeds.
 *
 * Uses the same /api/tapestry/publish-event endpoint as the frontend, but calls
 * it via the Tapestry REST API directly (no SDK dependency needed).
 *
 * All calls are fire-and-forget with a single retry — Tapestry is non-critical
 * and must never block round advancement.
 */

const TAPESTRY_API_URL =
  process.env.TAPESTRY_API_URL || "https://api.usetapestry.dev/api/v1";
const TAPESTRY_API_KEY = process.env.TAPESTRY_API_KEY || "";
const TAPESTRY_NAMESPACE = process.env.TAPESTRY_NAMESPACE || "winny";
const TAPESTRY_TIMEOUT_MS = 6_000;

/** Whether Tapestry integration is enabled (API key present). */
export function isTapestryEnabled(): boolean {
  return TAPESTRY_API_KEY.length > 0;
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [tapestry] ${msg}`);
}

// ─── Low-level helpers ──────────────────────────────────────

interface TapestryProfile {
  id: string;
  username: string;
}

/**
 * Find-or-create a Tapestry profile for the given wallet.
 * Returns the profile ID or null on failure.
 */
async function resolveProfileId(wallet: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${TAPESTRY_API_URL}/profiles/findOrCreate?apiKey=${TAPESTRY_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: `${TAPESTRY_NAMESPACE}-${wallet.slice(0, 6).toLowerCase()}`,
          walletAddress: wallet,
          blockchain: "SOLANA",
        }),
        signal: AbortSignal.timeout(TAPESTRY_TIMEOUT_MS),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { profile?: TapestryProfile };
    return data.profile?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a Tapestry content item for a game event.
 * Uses `findOrCreate` so the same round+eventType+wallet combo is idempotent.
 */
async function createContent(
  profileId: string,
  contentId: string,
  properties: { key: string; value: string | number | boolean }[]
): Promise<boolean> {
  try {
    const res = await fetch(
      `${TAPESTRY_API_URL}/contents/findOrCreate?apiKey=${TAPESTRY_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: contentId, profileId, properties }),
        signal: AbortSignal.timeout(TAPESTRY_TIMEOUT_MS),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Public API ─────────────────────────────────────────────

export interface RoundSettledEvent {
  roundId: number;
  winnerWallet: string;
  totalUsdc: number; // human-readable (already divided by 10^decimals)
  participantWallets: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publish "win" and "loss" events for a settled round on Tapestry.
 * Called once by the crank when it first observes a Settled round.
 *
 * Fire-and-forget: logs on failure but never throws.
 */
export async function publishRoundSettled(event: RoundSettledEvent): Promise<void> {
  if (!isTapestryEnabled()) return;

  const { roundId, winnerWallet, totalUsdc, participantWallets } = event;

  // 1. Publish "win" for winner
  try {
    const profileId = await resolveProfileId(winnerWallet);
    if (!profileId) {
      log(`⚠ Could not resolve profile for winner ${winnerWallet.slice(0, 8)}… — skipping`);
      return;
    }

    const contentId = `${profileId}:win:${roundId}`;
    const props = [
      { key: "eventType", value: "win" as string | number | boolean },
      { key: "round", value: String(roundId) },
      { key: "totalPot", value: String(totalUsdc) },
      { key: "currency", value: "USDC" },
      { key: "participants", value: String(participantWallets.length) },
    ];

    let ok = await createContent(profileId, contentId, props);
    if (!ok) {
      // Single retry
      ok = await createContent(profileId, contentId, props);
    }

    if (ok) {
      log(`✓ Published win event for Round #${roundId} → ${winnerWallet.slice(0, 8)}… ($${totalUsdc})`);
    } else {
      log(`⚠ Failed to publish win event for Round #${roundId} (after retry)`);
    }
  } catch (e: any) {
    log(`⚠ publishRoundSettled error: ${e.message}`);
  }

  // 2. Publish "loss" for each non-winner participant
  const losers = participantWallets.filter((w) => w !== winnerWallet);
  for (const loserWallet of losers) {
    try {
      const profileId = await resolveProfileId(loserWallet);
      if (!profileId) {
        log(`⚠ Could not resolve profile for loser ${loserWallet.slice(0, 8)}… — skipping`);
        continue;
      }

      const contentId = `${profileId}:loss:${roundId}`;
      const props = [
        { key: "eventType", value: "loss" as string | number | boolean },
        { key: "round", value: String(roundId) },
        { key: "totalPot", value: String(totalUsdc) },
        { key: "currency", value: "USDC" },
        { key: "participants", value: String(participantWallets.length) },
        { key: "winner", value: winnerWallet },
      ];

      let ok = await createContent(profileId, contentId, props);
      if (!ok) {
        ok = await createContent(profileId, contentId, props);
      }

      if (ok) {
        log(`✓ Published loss event for Round #${roundId} → ${loserWallet.slice(0, 8)}…`);
      } else {
        log(`⚠ Failed to publish loss event for Round #${roundId} → ${loserWallet.slice(0, 8)}… (after retry)`);
      }

      // Rate-limit spacing between Tapestry API calls
      if (loserWallet !== losers[losers.length - 1]) {
        await sleep(250);
      }
    } catch (e: any) {
      log(`⚠ publishRoundSettled loss error for ${loserWallet.slice(0, 8)}…: ${e.message}`);
    }
  }
}
