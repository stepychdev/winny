import {
  cacheTapestryProfile,
  createComment,
  deleteComment,
  findOrCreateProfileByWallet,
  followProfiles,
  getActivityFeed,
  getComments,
  getIdentityForWallet,
  getProfilesByWallets,
  getTapestryClient,
  invalidateActivityFeed,
  jsonError,
  jsonOk,
  likeNode,
  maybeHandleOptions,
  normalizeProfileItem,
  parseBody,
  parseLimitQuery,
  parseWalletQuery,
  searchProfiles,
  setTapestryHeaders,
  unfollowProfiles,
  unlikeNode,
  withHandler,
} from "../../lib/api/tapestry-shared.js";

function parsePageQuery(req: any, defaultPage = 1): number {
  const raw = req.query?.page;
  if (raw == null || raw === "") return defaultPage;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultPage;
  return Math.max(1, Math.floor(n));
}

// ---------------------------------------------------------------------------
// Individual action handlers
// ---------------------------------------------------------------------------

async function handleProfile(req: any, res: any) {
  if (req.method === "GET") {
    return withHandler(req, res, async () => {
      const wallet = parseWalletQuery(req);
      const profiles = await getProfilesByWallets([wallet]);
      jsonOk(res, { ok: true, profile: profiles[wallet] ?? null });
    });
  }
  if (req.method === "POST") {
    return withHandler(req, res, async () => {
      const body = parseBody(req);
      const wallets = Array.isArray(body?.wallets)
        ? body.wallets.filter((w: unknown) => typeof w === "string").map((w: string) => w.trim()).filter(Boolean)
        : [];
      if (wallets.length === 0) {
        throw Object.assign(new Error("wallets[] is required"), { code: "INVALID_WALLETS", status: 400 });
      }
      const profiles = await getProfilesByWallets(wallets);
      jsonOk(res, { ok: true, profiles });
    });
  }
  return withHandler(req, res, async () => {
    jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use GET or POST");
  });
}

async function handleProfileImport(req: any, res: any) {
  if (req.method !== "POST") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST"); });
  }
  return withHandler(req, res, async () => {
    const body = parseBody(req);
    const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
    if (!wallet) throw Object.assign(new Error("wallet is required"), { code: "INVALID_WALLET", status: 400 });

    const username =
      (typeof body?.username === "string" && body.username.trim()) ||
      `winny-${wallet.slice(0, 6).toLowerCase()}`;
    const bio = typeof body?.bio === "string" ? body.bio.trim() : undefined;

    const { client, apiKey } = getTapestryClient();
    const created = await client.profiles.findOrCreateCreate(
      { apiKey },
      { walletAddress: wallet, blockchain: "SOLANA", username, ...(bio ? { bio } : {}) },
    );

    const normalized = normalizeProfileItem(created);
    if (normalized) {
      cacheTapestryProfile(wallet, normalized);
      invalidateActivityFeed(wallet);
    }
    jsonOk(res, { ok: true, profile: normalized, raw: created });
  });
}

async function handleActivityFeed(req: any, res: any) {
  if (req.method !== "GET") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use GET"); });
  }
  return withHandler(req, res, async () => {
    const wallet = parseWalletQuery(req);
    const limit = parseLimitQuery(req, 5);
    const page = parsePageQuery(req, 1);
    const payload = await getActivityFeed(wallet, limit, page);
    jsonOk(res, { ok: true, activities: payload.activities, page: payload.page, pageSize: payload.pageSize, limit });
  });
}

async function handleFollow(req: any, res: any) {
  if (req.method !== "POST") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST"); });
  }
  return withHandler(req, res, async () => {
    const body = parseBody(req);
    const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
    if (!wallet) throw Object.assign(new Error("wallet is required"), { code: "INVALID_WALLET", status: 400 });

    const action = typeof body?.action === "string" ? body.action.trim() : "follow";
    if (action !== "follow" && action !== "unfollow") {
      throw Object.assign(new Error("action must be 'follow' or 'unfollow'"), { code: "INVALID_ACTION", status: 400 });
    }

    const targetWallet = typeof body?.targetWallet === "string" ? body.targetWallet.trim() : "";
    const rawTargetProfileId = typeof body?.targetProfileId === "string" ? body.targetProfileId.trim() : "";
    if (!targetWallet && !rawTargetProfileId) {
      throw Object.assign(new Error("targetWallet or targetProfileId is required"), { code: "INVALID_TARGET", status: 400 });
    }

    const source = await findOrCreateProfileByWallet(wallet);
    if (!source?.profileId) {
      throw Object.assign(new Error("Unable to resolve requester profile"), { code: "PROFILE_RESOLUTION_FAILED", status: 400 });
    }

    let targetProfileId = rawTargetProfileId;
    if (!targetProfileId && targetWallet) {
      const profiles = await getProfilesByWallets([targetWallet]);
      targetProfileId = profiles[targetWallet]?.profileId || "";
    }
    if (!targetProfileId) {
      throw Object.assign(new Error("Unable to resolve target profile"), { code: "TARGET_PROFILE_NOT_FOUND", status: 404 });
    }
    if (targetProfileId === source.profileId) {
      throw Object.assign(new Error(`Cannot ${action} yourself`), { code: `SELF_${action.toUpperCase()}_NOT_ALLOWED`, status: 400 });
    }

    if (action === "follow") {
      await followProfiles(source.profileId, targetProfileId);
    } else {
      await unfollowProfiles(source.profileId, targetProfileId);
    }
    invalidateActivityFeed(wallet);

    jsonOk(res, { ok: true, action, wallet, targetWallet: targetWallet || undefined, targetProfileId });
  });
}

async function handlePublishEvent(req: any, res: any) {
  if (req.method !== "POST") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST"); });
  }
  return withHandler(req, res, async () => {
    const body = parseBody(req);
    const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
    if (!wallet) throw Object.assign(new Error("wallet is required"), { code: "INVALID_WALLET", status: 400 });

    const eventType = typeof body?.eventType === "string" ? body.eventType.trim() : "";
    if (!eventType) throw Object.assign(new Error("eventType is required"), { code: "INVALID_EVENT_TYPE", status: 400 });

    const rawProps: Record<string, unknown> = body?.properties || {};

    const profile = await findOrCreateProfileByWallet(wallet);
    if (!profile?.profileId) {
      throw Object.assign(new Error("Unable to resolve profile"), { code: "PROFILE_RESOLUTION_FAILED", status: 400 });
    }

    const round = typeof rawProps.round === "string" || typeof rawProps.round === "number"
      ? String(rawProps.round) : "";
    const contentId = `${profile.profileId}:${eventType}:${round || Date.now()}`;

    const properties = Object.entries(rawProps)
      .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      .map(([key, value]) => ({ key, value: value as string | number | boolean }));
    properties.push({ key: "eventType", value: eventType });

    const { client, apiKey } = getTapestryClient();
    const contentPayload = { id: contentId, profileId: profile.profileId, properties };

    let content: any;
    try {
      content = await client.contents.findOrCreateCreate({ apiKey }, contentPayload);
    } catch (firstErr: any) {
      const status = firstErr?.response?.status;
      if (status && status < 500) throw firstErr;
      try {
        content = await client.contents.findOrCreateCreate({ apiKey }, contentPayload);
      } catch {
        throw firstErr;
      }
    }

    invalidateActivityFeed(wallet);
    jsonOk(res, { ok: true, contentId: content.id ?? contentId, eventType });
  });
}

async function handleComments(req: any, res: any) {
  if (req.method === "GET") {
    return withHandler(req, res, async () => {
      const contentId = req.query?.contentId;
      if (!contentId) throw Object.assign(new Error("contentId is required"), { code: "INVALID_CONTENT_ID", status: 400 });
      const requestingProfileId = req.query?.requestingProfileId || undefined;
      const page = parsePageQuery(req, 1);
      const pageSize = parseLimitQuery(req, 20);
      const result = await getComments(contentId, requestingProfileId, page, pageSize);
      jsonOk(res, { ok: true, ...result });
    });
  }
  jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use GET for comments list");
}

async function handleComment(req: any, res: any) {
  if (req.method === "POST") {
    return withHandler(req, res, async () => {
      const body = parseBody(req);
      const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
      if (!wallet) throw Object.assign(new Error("wallet is required"), { code: "INVALID_WALLET", status: 400 });
      const contentId = typeof body?.contentId === "string" ? body.contentId.trim() : "";
      if (!contentId) throw Object.assign(new Error("contentId is required"), { code: "INVALID_CONTENT_ID", status: 400 });
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text) throw Object.assign(new Error("text is required"), { code: "INVALID_TEXT", status: 400 });
      const commentId = typeof body?.commentId === "string" ? body.commentId.trim() || undefined : undefined;
      const result = await createComment(wallet, contentId, text, commentId);
      jsonOk(res, { ok: true, comment: result });
    });
  }
  if (req.method === "DELETE") {
    return withHandler(req, res, async () => {
      const body = parseBody(req);
      const commentId = typeof body?.commentId === "string" ? body.commentId.trim() : "";
      if (!commentId) throw Object.assign(new Error("commentId is required"), { code: "INVALID_COMMENT_ID", status: 400 });
      await deleteComment(commentId);
      jsonOk(res, { ok: true });
    });
  }
  jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST or DELETE");
}

async function handleLike(req: any, res: any) {
  if (req.method !== "POST") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST"); });
  }
  return withHandler(req, res, async () => {
    const body = parseBody(req);
    const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
    if (!wallet) throw Object.assign(new Error("wallet is required"), { code: "INVALID_WALLET", status: 400 });
    const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";
    if (!nodeId) throw Object.assign(new Error("nodeId is required"), { code: "INVALID_NODE_ID", status: 400 });
    await likeNode(wallet, nodeId);
    jsonOk(res, { ok: true });
  });
}

async function handleUnlike(req: any, res: any) {
  if (req.method !== "POST") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST"); });
  }
  return withHandler(req, res, async () => {
    const body = parseBody(req);
    const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
    if (!wallet) throw Object.assign(new Error("wallet is required"), { code: "INVALID_WALLET", status: 400 });
    const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";
    if (!nodeId) throw Object.assign(new Error("nodeId is required"), { code: "INVALID_NODE_ID", status: 400 });
    await unlikeNode(wallet, nodeId);
    jsonOk(res, { ok: true });
  });
}

async function handleSearch(req: any, res: any) {
  if (req.method !== "GET") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use GET"); });
  }
  return withHandler(req, res, async () => {
    const q = typeof req.query?.q === "string" ? req.query.q.trim() : "";
    if (!q) throw Object.assign(new Error("q query param is required"), { code: "INVALID_QUERY", status: 400 });
    const page = parsePageQuery(req, 1);
    const pageSize = parseLimitQuery(req, 20);
    const result = await searchProfiles(q, page, pageSize);
    jsonOk(res, { ok: true, ...result });
  });
}

async function handleIdentity(req: any, res: any) {
  if (req.method !== "GET") {
    return withHandler(req, res, async () => { jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use GET"); });
  }
  return withHandler(req, res, async () => {
    const wallet = parseWalletQuery(req);
    const { twitter, raw } = await getIdentityForWallet(wallet);
    jsonOk(res, { ok: true, wallet, twitter, raw });
  });
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

const ACTIONS: Record<string, (req: any, res: any) => Promise<void>> = {
  profile: handleProfile,
  "profile-import": handleProfileImport,
  "activity-feed": handleActivityFeed,
  follow: handleFollow,
  "publish-event": handlePublishEvent,
  comments: handleComments,
  comment: handleComment,
  like: handleLike,
  unlike: handleUnlike,
  search: handleSearch,
  identity: handleIdentity,
};

export default async function handler(req: any, res: any) {
  if (maybeHandleOptions(req, res)) return;

  const action = typeof req.query?.action === "string" ? req.query.action.trim() : "";
  const fn = ACTIONS[action];

  if (!fn) {
    setTapestryHeaders(res);
    return jsonError(res, 400, "INVALID_ACTION", `Unknown action: "${action}". Valid: ${Object.keys(ACTIONS).join(", ")}`);
  }

  return fn(req, res);
}
