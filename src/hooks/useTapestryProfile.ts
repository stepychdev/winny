import { useEffect, useState } from "react";
import { ENABLE_TAPESTRY_SOCIAL } from "../lib/constants";
import { fetchTapestryProfile } from "../lib/tapestry/api";
import type { Roll2RollSocialProfile } from "../lib/tapestry/types";

const PROFILE_CACHE_TTL_MS = 60_000;
const profileCache = new Map<string, { ts: number; profile: Roll2RollSocialProfile | null }>();

function getCached(wallet: string): Roll2RollSocialProfile | null | undefined {
  const hit = profileCache.get(wallet);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > PROFILE_CACHE_TTL_MS) return undefined;
  return hit.profile;
}

export function useTapestryProfile(wallet: string | null | undefined) {
  const cleanWallet = typeof wallet === "string" ? wallet.trim() : "";
  const [profile, setProfile] = useState<Roll2RollSocialProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!ENABLE_TAPESTRY_SOCIAL || !cleanWallet) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const cached = getCached(cleanWallet);
    if (cached !== undefined) {
      setProfile(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchTapestryProfile(cleanWallet)
      .then((next) => {
        if (cancelled) return;
        profileCache.set(cleanWallet, { ts: Date.now(), profile: next });
        setProfile(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cleanWallet]);

  return { profile, loading };
}
