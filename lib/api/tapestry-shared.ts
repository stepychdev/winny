import {
  SocialFi,
  type ActivityItemSchema,
  type GetProfilesItemSchema,
  type FindOrCreateResponseSchema,
} from "socialfi";
import { normalizeTapestryProfile } from "../../src/lib/tapestry/normalize.js";
import type { Roll2RollSocialActivity, Roll2RollSocialProfile, GameEventProperties } from "../../src/lib/tapestry/types.js";

const DEFAULT_TAPESTRY_API_URL = "https://api.usetapestry.dev/api/v1";
const TAPESTRY_TIMEOUT_MS = 8_000;
const PROFILE_CACHE_TTL_MS = 60_000;
const ACTIVITY_FEED_CACHE_TTL_MS = 15_000;
const PROFILE_CACHE_MAX_ENTRIES = 1_000;
const ACTIVITY_FEED_CACHE_MAX_ENTRIES = 500;

// Helper: whether a TAPESTRY API key is available in the environment.
export function tapestryKeyPresent(): boolean {
  return Boolean(process.env.TAPESTRY_API_KEY && process.env.TAPESTRY_API_KEY.trim());
}

type TimedProfileEntry = { ts: number; profile: Roll2RollSocialProfile | null };
type TimedActivityFeedEntry = {
  ts: number;
  payload: { activities: Roll2RollSocialActivity[]; page: number; pageSize: number };
};

// Best-effort in-memory cache for server route handlers. On serverless cold starts or across
// instances this may be empty, which is fine — it still reduces repeated calls during hot sessions.
const profileCacheByWallet = new Map<string, TimedProfileEntry>();
const activityFeedCacheByKey = new Map<string, TimedActivityFeedEntry>();

function evictOldestEntries<T extends { ts: number }>(map: Map<string, T>, maxEntries: number) {
  if (map.size <= maxEntries) return;
  const overflow = map.size - maxEntries;
  const oldest = [...map.entries()]
    .sort((a, b) => a[1].ts - b[1].ts)
    .slice(0, overflow);
  for (const [key] of oldest) {
    map.delete(key);
  }
}

function getFreshProfileFromCache(wallet: string): Roll2RollSocialProfile | null | undefined {
  const hit = profileCacheByWallet.get(wallet);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > PROFILE_CACHE_TTL_MS) {
    profileCacheByWallet.delete(wallet);
    return undefined;
  }
  return hit.profile;
}

function getFreshActivityFeedFromCache(
  cacheKey: string
): { activities: Roll2RollSocialActivity[]; page: number; pageSize: number } | undefined {
  const hit = activityFeedCacheByKey.get(cacheKey);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > ACTIVITY_FEED_CACHE_TTL_MS) {
    activityFeedCacheByKey.delete(cacheKey);
    return undefined;
  }
  return hit.payload;
}

export function cacheTapestryProfile(wallet: string, profile: Roll2RollSocialProfile | null) {
  profileCacheByWallet.set(wallet, { ts: Date.now(), profile });
  evictOldestEntries(profileCacheByWallet, PROFILE_CACHE_MAX_ENTRIES);
}

export function invalidateActivityFeed(wallet: string) {
  const prefix = `${wallet}:`;
  for (const key of activityFeedCacheByKey.keys()) {
    if (key.startsWith(prefix)) {
      activityFeedCacheByKey.delete(key);
    }
  }
}

export function getTapestryConfig() {
  const apiKey = process.env.TAPESTRY_API_KEY?.trim();
  const baseURL = process.env.TAPESTRY_API_URL || DEFAULT_TAPESTRY_API_URL;
  if (!apiKey) {
    // Do not throw here to avoid function-import-time crashes on platforms
    // where env may be missing (prod). Callers should handle missing key
    // and return safe fallbacks.
    return { apiKey: "", baseURL };
  }
  return { apiKey, baseURL };
}

export function getTapestryClient() {
  const { apiKey, baseURL } = getTapestryConfig();
  const client = new SocialFi({ baseURL, timeout: TAPESTRY_TIMEOUT_MS });
  return { client, apiKey, baseURL };
}

export function setTapestryHeaders(res: any) {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

export function maybeHandleOptions(req: any, res: any): boolean {
  if (req.method === "OPTIONS") {
    setTapestryHeaders(res);
    res.status(204).end();
    return true;
  }
  return false;
}

export function parseBody(req: any) {
  if (req.body == null) return {};
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body;
}

export function jsonOk(res: any, payload: unknown, status = 200) {
  setTapestryHeaders(res);
  res.status(status).json(payload);
}

export function jsonError(res: any, status: number, code: string, message: string, details?: unknown) {
  setTapestryHeaders(res);
  res.status(status).json({
    ok: false,
    error: { code, message, details: details ?? null },
  });
}

export async function withHandler(_req: any, res: any, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    const status = Number.isFinite(e?.status) ? e.status : 500;
    const code = e?.code || "INTERNAL_ERROR";
    const message = e?.message || "Internal error";
    return jsonError(res, status, code, message);
  }
}

export function parseWalletQuery(req: any): string {
  const raw = req.query?.wallet;
  if (!raw || typeof raw !== "string") {
    throw Object.assign(new Error("wallet query param is required"), {
      code: "INVALID_WALLET",
      status: 400,
    });
  }
  return raw.trim();
}

export function parseLimitQuery(req: any, defaultLimit = 5): number {
  const raw = req.query?.limit;
  if (raw == null || raw === "") return defaultLimit;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(20, Math.floor(n));
}

export function normalizeProfileItem(
  item: GetProfilesItemSchema | FindOrCreateResponseSchema | null | undefined
): Roll2RollSocialProfile | null {
  return normalizeTapestryProfile(item as any);
}

export async function getProfilesByWallets(wallets: string[]): Promise<Record<string, Roll2RollSocialProfile | null>> {
  // If TAPESTRY_API_KEY is not present in the environment, return empty
  // results rather than attempting network calls which would cause
  // function failures on production platforms.
  if (!tapestryKeyPresent()) {
    const result: Record<string, Roll2RollSocialProfile | null> = {};
    for (const w of Array.from(new Set(wallets.filter(Boolean)))) result[w] = null;
    return result;
  }

  const { client, apiKey } = getTapestryClient();
  const deduped = Array.from(new Set(wallets.filter(Boolean)));
  const result: Record<string, Roll2RollSocialProfile | null> = {};
  const missing: string[] = [];

  for (const wallet of deduped) {
    const cached = getFreshProfileFromCache(wallet);
    if (cached !== undefined) {
      result[wallet] = cached;
    } else {
      missing.push(wallet);
    }
  }

  if (missing.length === 0) {
    return result;
  }

  await Promise.all(
    missing.map(async (wallet) => {
      try {
        const data = await client.profiles.profilesList({
          apiKey,
          walletAddress: wallet,
          pageSize: "10",
          sortBy: "created_at",
          sortDirection: "DESC",
        });
        // Prefer the profile that has social connections (following+followers).
        // Wallets may have duplicate profiles due to earlier namespace naming,
        // and the newest profile is often empty.
        const candidates = (data.profiles || []).filter(
          (p) => p.wallet?.address === wallet
        );
        const first = candidates.sort((a, b) => {
          const scoreA = (a.socialCounts?.following || 0) + (a.socialCounts?.followers || 0);
          const scoreB = (b.socialCounts?.following || 0) + (b.socialCounts?.followers || 0);
          return scoreB - scoreA;
        })[0] || data.profiles?.[0];
        const normalized = normalizeProfileItem(first);
        result[wallet] = normalized;
        cacheTapestryProfile(wallet, normalized);
      } catch {
        result[wallet] = null;
        cacheTapestryProfile(wallet, null);
      }
    })
  );

  return result;
}

export async function findOrCreateProfileByWallet(wallet: string): Promise<Roll2RollSocialProfile | null> {
  const cached = getFreshProfileFromCache(wallet);
  if (cached !== undefined && cached?.profileId) return cached;

  const { client, apiKey } = getTapestryClient();
  const created = await client.profiles.findOrCreateCreate(
    { apiKey },
    {
      walletAddress: wallet,
      blockchain: "SOLANA",
      username: `winny-${wallet.slice(0, 6).toLowerCase()}`,
    }
  );
  const normalized = normalizeProfileItem(created);
  cacheTapestryProfile(wallet, normalized);
  return normalized;
}

export async function getFollowState(startId: string, endId: string): Promise<boolean> {
  const { client, apiKey } = getTapestryClient();
  const data = await client.followers.stateList({ apiKey, startId, endId });
  return !!data?.isFollowing;
}

export async function followProfiles(startId: string, endId: string): Promise<void> {
  const { client, apiKey } = getTapestryClient();
  await client.followers.postFollowers({ apiKey }, { startId, endId });
}

export async function unfollowProfiles(startId: string, endId: string): Promise<void> {
  const { client, apiKey } = getTapestryClient();
  await client.followers.removeCreate({ apiKey }, { startId, endId });
}

function normalizeActivityItem(item: ActivityItemSchema): Roll2RollSocialActivity {
  return {
    id: [item.type, item.actor_id, item.target_id || "", item.comment_id || "", item.timestamp].join(":"),
    type: item.type,
    actorProfileId: item.actor_id,
    actorUsername: item.actor_username,
    targetProfileId: item.target_id,
    targetUsername: item.target_username,
    commentId: item.comment_id,
    timestamp: item.timestamp,
    activity: item.activity,
  };
}

export async function getActivityFeed(
  wallet: string,
  limit: number,
  page = 1
): Promise<{ activities: Roll2RollSocialActivity[]; page: number; pageSize: number }> {
  const cacheKey = `${wallet}:${limit}:${page}`;
  const cached = getFreshActivityFeedFromCache(cacheKey);
  if (cached) return cached;

  // If Tapestry is not configured in this environment, return a safe empty
  // feed instead of attempting network calls that will fail on prod.
  if (!tapestryKeyPresent()) {
    const empty = { activities: [], page, pageSize: limit };
    activityFeedCacheByKey.set(cacheKey, { ts: Date.now(), payload: empty });
    evictOldestEntries(activityFeedCacheByKey, ACTIVITY_FEED_CACHE_MAX_ENTRIES);
    return empty;
  }

  let selfProfile: Roll2RollSocialProfile | null = null;
  try {
    selfProfile = await findOrCreateProfileByWallet(wallet);
  } catch {
    const empty = { activities: [], page, pageSize: limit };
    activityFeedCacheByKey.set(cacheKey, { ts: Date.now(), payload: empty });
    evictOldestEntries(activityFeedCacheByKey, ACTIVITY_FEED_CACHE_MAX_ENTRIES);
    return empty;
  }

  const username = selfProfile?.username?.trim();
  if (!username) {
    const empty = { activities: [], page, pageSize: limit };
    activityFeedCacheByKey.set(cacheKey, { ts: Date.now(), payload: empty });
    evictOldestEntries(activityFeedCacheByKey, ACTIVITY_FEED_CACHE_MAX_ENTRIES);
    return empty;
  }

  const { client, apiKey } = getTapestryClient();
  try {
    // Tapestry has a pagination bug where small pageSize values silently
    // drop activities.  Always request a generous page and trim locally.
    const TAPESTRY_PAGE_SIZE = 50;
    const data = await client.activity.feedList({
      apiKey,
      username,
      page: String(Math.max(1, page)),
      pageSize: String(TAPESTRY_PAGE_SIZE),
    });
    let activities = (data.activities || []).map(normalizeActivityItem)
      .slice(0, Math.max(1, limit));

    // Enrich new_content activities with game-event properties (batch fetch).
    activities = await enrichContentActivities(client, apiKey, activities);

    const payload = {
      activities,
      page: Number(data.page || page) || page,
      pageSize: Number(data.pageSize || limit) || limit,
    };
    activityFeedCacheByKey.set(cacheKey, { ts: Date.now(), payload });
    evictOldestEntries(activityFeedCacheByKey, ACTIVITY_FEED_CACHE_MAX_ENTRIES);
    return payload;
  } catch (e: any) {
    const status = e?.response?.status;
    const code = e?.code;
    if (status === 404 || code === "ERR_BAD_REQUEST") {
      const empty = { activities: [], page, pageSize: limit };
      activityFeedCacheByKey.set(cacheKey, { ts: Date.now(), payload: empty });
      evictOldestEntries(activityFeedCacheByKey, ACTIVITY_FEED_CACHE_MAX_ENTRIES);
      return empty;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function getComments(
  contentId: string,
  requestingProfileId?: string,
  page?: number,
  pageSize?: number,
) {
  if (!tapestryKeyPresent()) return { comments: [], page: 1, pageSize: pageSize || 20 };

  const { client, apiKey } = getTapestryClient();
  const data = await client.comments.commentsList({
    apiKey,
    contentId,
    ...(requestingProfileId ? { requestingProfileId } : {}),
    ...(page ? { page: String(page) } : {}),
    ...(pageSize ? { pageSize: String(pageSize) } : {}),
  });

  return {
    comments: (data.comments || []).map((c) => ({
      id: c.comment.id,
      text: c.comment.text,
      createdAt: c.comment.created_at,
      author: c.author
        ? {
            profileId: c.author.id,
            username: c.author.username,
            image: c.author.image ?? null,
          }
        : null,
      likeCount: c.socialCounts?.likeCount ?? 0,
      hasLiked: c.requestingProfileSocialInfo?.hasLiked ?? false,
    })),
    page: data.page,
    pageSize: data.pageSize,
  };
}

export async function createComment(
  wallet: string,
  contentId: string,
  text: string,
  commentId?: string,
) {
  const profile = await findOrCreateProfileByWallet(wallet);
  if (!profile?.profileId) {
    throw Object.assign(new Error("Unable to resolve profile"), { code: "PROFILE_RESOLUTION_FAILED", status: 400 });
  }

  const { client, apiKey } = getTapestryClient();
  const created = await client.comments.commentsCreate(
    { apiKey },
    {
      profileId: profile.profileId,
      contentId,
      text,
      ...(commentId ? { commentId } : {}),
    },
  );

  return { id: created.id, text: created.text, createdAt: created.created_at };
}

export async function deleteComment(commentId: string) {
  const { client, apiKey } = getTapestryClient();
  await client.comments.commentsDelete({ id: commentId, apiKey });
}

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

export async function likeNode(wallet: string, nodeId: string) {
  const profile = await findOrCreateProfileByWallet(wallet);
  if (!profile?.profileId) {
    throw Object.assign(new Error("Unable to resolve profile"), { code: "PROFILE_RESOLUTION_FAILED", status: 400 });
  }
  const { client, apiKey } = getTapestryClient();
  await client.likes.likesCreate({ nodeId, apiKey }, { startId: profile.profileId });
}

export async function unlikeNode(wallet: string, nodeId: string) {
  const profile = await findOrCreateProfileByWallet(wallet);
  if (!profile?.profileId) {
    throw Object.assign(new Error("Unable to resolve profile"), { code: "PROFILE_RESOLUTION_FAILED", status: 400 });
  }
  const { client, apiKey } = getTapestryClient();
  await client.likes.likesDelete({ nodeId, apiKey }, { startId: profile.profileId });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchProfiles(query: string, page?: number, pageSize?: number) {
  if (!tapestryKeyPresent()) return { profiles: [], page: 1, pageSize: pageSize || 20 };

  const { client, apiKey } = getTapestryClient();
  const data = await client.search.profilesList({
    apiKey,
    query,
    ...(page ? { page: String(page) } : {}),
    ...(pageSize ? { pageSize: String(pageSize) } : {}),
  });

  return {
    profiles: (data.profiles || []).map((p) => normalizeProfileItem(p as any)).filter(Boolean),
    page: data.page,
    pageSize: data.pageSize,
  };
}

// ---------------------------------------------------------------------------
// Content enrichment — batch-fetch Tapestry content details for new_content
// activities so we can attach game-event properties (eventType, amount, etc.).
// ---------------------------------------------------------------------------
const GAME_EVENT_KEYS: (keyof GameEventProperties)[] = [
  "eventType", "amount", "currency", "round", "totalPot", "mint", "sig", "winner", "participants",
];

async function enrichContentActivities(
  client: SocialFi<unknown>,
  apiKey: string,
  activities: Roll2RollSocialActivity[],
): Promise<Roll2RollSocialActivity[]> {
  const contentIds = activities
    .filter((a) => a.type === "new_content" && a.targetProfileId)
    .map((a) => a.targetProfileId!);

  if (contentIds.length === 0) return activities;

  let contentMap: Record<string, Record<string, string>> = {};
  try {
    const batch = await client.contents.batchReadCreate(
      { apiKey },
      contentIds as any,       // SDK expects string[] body
    );
    const items = (batch as any)?.successful || [];
    for (const item of items) {
      const c = item?.content;
      if (!c?.id) continue;
      const props: Record<string, string> = {};
      for (const key of GAME_EVENT_KEYS) {
        if (c[key] != null) props[key] = String(c[key]);
      }
      // Also check for 'type' field used by older content format.
      if (!props.eventType && c.type) props.eventType = String(c.type);
      if (Object.keys(props).length > 0) contentMap[c.id] = props;
    }
  } catch {
    // If batch fetch fails, return activities without enrichment — non-critical.
    return activities;
  }

  return activities.map((a) => {
    if (a.type !== "new_content" || !a.targetProfileId) return a;
    const props = contentMap[a.targetProfileId];
    if (!props) return a;
    return { ...a, gameEvent: props as GameEventProperties };
  });
}
