import { useCallback, useEffect, useState } from "react";
import { ENABLE_TAPESTRY_SOCIAL } from "../lib/constants";
import { fetchTapestryActivityFeed } from "../lib/tapestry/api";
import { onFeedRefresh } from "../lib/tapestry/events";
import type { Roll2RollSocialActivity } from "../lib/tapestry/types";

const ACTIVITY_POLL_INTERVAL_MS = 30_000;

export function useTapestryActivityFeed(wallet: string | null | undefined, limit = 5) {
  const cleanWallet = typeof wallet === "string" ? wallet.trim() : "";
  const [activities, setActivities] = useState<Roll2RollSocialActivity[]>([]);
  const [loading, setLoading] = useState(false);

  const doFetch = useCallback(() => {
    if (!ENABLE_TAPESTRY_SOCIAL || !cleanWallet) return;
    fetchTapestryActivityFeed(cleanWallet, limit)
      .then(setActivities)
      .catch(() => {/* soft fail */});
  }, [cleanWallet, limit]);

  useEffect(() => {
    let cancelled = false;

    if (!ENABLE_TAPESTRY_SOCIAL || !cleanWallet) {
      setActivities([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchTapestryActivityFeed(cleanWallet, limit)
      .then((next) => {
        if (cancelled) return;
        setActivities(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Poll for new activity periodically
    const interval = setInterval(() => {
      if (!cancelled) doFetch();
    }, ACTIVITY_POLL_INTERVAL_MS);

    // Refresh feed immediately when a deposit/claim event is published
    const unsub = onFeedRefresh(() => {
      setTimeout(() => { if (!cancelled) doFetch(); }, 2000);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsub();
    };
  }, [cleanWallet, limit, doFetch]);

  return { activities, loading, refresh: doFetch };
}
