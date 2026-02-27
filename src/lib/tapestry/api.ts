import { ENABLE_TAPESTRY_SOCIAL } from "../constants";
import type {
  TapestryFollowMutationResponse,
  TapestryActivityFeedResponse,
  TapestryCommentsResponse,
  TapestryComment,
  TapestrySearchResponse,
  Roll2RollSocialProfile,
  Roll2RollSocialActivity,
  TapestryProfilesResponse,
  TapestryProfileResponse,
} from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Tapestry API proxy error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchTapestryProfiles(wallets: string[]): Promise<Record<string, Roll2RollSocialProfile | null>> {
  if (!ENABLE_TAPESTRY_SOCIAL) return {};

  const deduped = Array.from(new Set(wallets.filter(Boolean)));
  if (deduped.length === 0) return {};

  try {
    const data = await jsonFetch<TapestryProfilesResponse>("/api/tapestry?action=profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallets: deduped }),
    });
    return data.profiles || {};
  } catch {
    return {};
  }
}

export async function fetchTapestryProfile(wallet: string): Promise<Roll2RollSocialProfile | null> {
  if (!ENABLE_TAPESTRY_SOCIAL) return null;
  const clean = wallet.trim();
  if (!clean) return null;

  try {
    const data = await jsonFetch<TapestryProfileResponse>(
      `/api/tapestry?action=profile&wallet=${encodeURIComponent(clean)}`
    );
    return data.profile ?? null;
  } catch {
    return null;
  }
}

export async function importOrCreateTapestryProfile(wallet: string): Promise<Roll2RollSocialProfile | null> {
  if (!ENABLE_TAPESTRY_SOCIAL) return null;
  const clean = wallet.trim();
  if (!clean) return null;

  try {
    const data = await jsonFetch<{ ok: boolean; profile: Roll2RollSocialProfile | null }>(
      "/api/tapestry?action=profile-import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: clean }),
      }
    );
    return data.profile ?? null;
  } catch {
    return null;
  }
}

export async function fetchTapestryActivityFeed(
  wallet: string,
  limit = 5
): Promise<Roll2RollSocialActivity[]> {
  if (!ENABLE_TAPESTRY_SOCIAL) return [];
  const clean = wallet.trim();
  if (!clean) return [];

  try {
    const data = await jsonFetch<TapestryActivityFeedResponse>(
      `/api/tapestry?action=activity-feed&wallet=${encodeURIComponent(clean)}&limit=${encodeURIComponent(
        String(limit)
      )}`
    );
    return Array.isArray(data.activities) ? data.activities : [];
  } catch {
    return [];
  }
}

export async function followTapestryProfile(
  wallet: string,
  target: { wallet?: string; profileId?: string }
): Promise<TapestryFollowMutationResponse> {
  if (!ENABLE_TAPESTRY_SOCIAL) throw new Error("Tapestry social disabled");
  const clean = wallet.trim();
  if (!clean) throw new Error("wallet is required");

  return jsonFetch<TapestryFollowMutationResponse>("/api/tapestry?action=follow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: clean,
      ...(target.wallet ? { targetWallet: target.wallet } : {}),
      ...(target.profileId ? { targetProfileId: target.profileId } : {}),
    }),
  });
}

export async function unfollowTapestryProfile(
  wallet: string,
  target: { wallet?: string; profileId?: string }
): Promise<TapestryFollowMutationResponse> {
  if (!ENABLE_TAPESTRY_SOCIAL) throw new Error("Tapestry social disabled");
  const clean = wallet.trim();
  if (!clean) throw new Error("wallet is required");

  return jsonFetch<TapestryFollowMutationResponse>("/api/tapestry?action=follow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: clean,
      action: "unfollow",
      ...(target.wallet ? { targetWallet: target.wallet } : {}),
      ...(target.profileId ? { targetProfileId: target.profileId } : {}),
    }),
  });
}

/**
 * Publish a game event (deposit, win, claim) to Tapestry.
 * Fire-and-forget — never blocks the UI.
 */
export function publishTapestryEvent(
  wallet: string,
  eventType: "deposit" | "win" | "claim" | "round_join",
  properties: Record<string, string | number | boolean> = {}
): void {
  if (!ENABLE_TAPESTRY_SOCIAL) return;
  const clean = wallet.trim();
  if (!clean) return;

  void jsonFetch<{ ok: boolean }>("/api/tapestry?action=publish-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: clean, eventType, properties }),
  }).catch(() => {/* social layer is optional */});
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function fetchComments(
  contentId: string,
  requestingProfileId?: string,
): Promise<TapestryComment[]> {
  if (!ENABLE_TAPESTRY_SOCIAL) return [];
  try {
    const params = new URLSearchParams({ action: "comments", contentId });
    if (requestingProfileId) params.set("requestingProfileId", requestingProfileId);
    const data = await jsonFetch<TapestryCommentsResponse>(`/api/tapestry?${params}`);
    return data.comments || [];
  } catch {
    return [];
  }
}

export async function createComment(
  wallet: string,
  contentId: string,
  text: string,
  commentId?: string,
): Promise<{ id: string; text: string; createdAt: number }> {
  if (!ENABLE_TAPESTRY_SOCIAL) throw new Error("Tapestry social disabled");
  const data = await jsonFetch<{ ok: boolean; comment: { id: string; text: string; createdAt: number } }>(
    "/api/tapestry?action=comment",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: wallet.trim(), contentId, text, ...(commentId ? { commentId } : {}) }),
    },
  );
  return data.comment;
}

export async function deleteComment(commentId: string): Promise<void> {
  if (!ENABLE_TAPESTRY_SOCIAL) throw new Error("Tapestry social disabled");
  await jsonFetch<{ ok: boolean }>("/api/tapestry?action=comment", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commentId }),
  });
}

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

export async function likeNode(wallet: string, nodeId: string): Promise<void> {
  if (!ENABLE_TAPESTRY_SOCIAL) throw new Error("Tapestry social disabled");
  await jsonFetch<{ ok: boolean }>("/api/tapestry?action=like", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.trim(), nodeId }),
  });
}

export async function unlikeNode(wallet: string, nodeId: string): Promise<void> {
  if (!ENABLE_TAPESTRY_SOCIAL) throw new Error("Tapestry social disabled");
  await jsonFetch<{ ok: boolean }>("/api/tapestry?action=unlike", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.trim(), nodeId }),
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchProfiles(
  query: string,
  page?: number,
  pageSize?: number,
): Promise<Roll2RollSocialProfile[]> {
  if (!ENABLE_TAPESTRY_SOCIAL) return [];
  const clean = query.trim();
  if (!clean) return [];

  try {
    const params = new URLSearchParams({ action: "search", q: clean });
    if (page) params.set("page", String(page));
    if (pageSize) params.set("limit", String(pageSize));
    const data = await jsonFetch<TapestrySearchResponse>(`/api/tapestry?${params}`);
    return data.profiles || [];
  } catch {
    return [];
  }
}
