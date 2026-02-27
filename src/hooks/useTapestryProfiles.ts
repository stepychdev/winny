import { useEffect, useMemo, useState } from "react";
import { ENABLE_TAPESTRY_SOCIAL } from "../lib/constants";
import { fetchTapestryProfiles } from "../lib/tapestry/api";
import type { Roll2RollSocialProfile } from "../lib/tapestry/types";

const PROFILE_CACHE_TTL_MS = 60_000;
const profileCache = new Map<string, { ts: number; profile: Roll2RollSocialProfile | null }>();

function getCached(wallet: string): Roll2RollSocialProfile | null | undefined {
  const hit = profileCache.get(wallet);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > PROFILE_CACHE_TTL_MS) return undefined;
  return hit.profile;
}

export function useTapestryProfiles(wallets: string[]) {
  const uniqueWallets = useMemo(
    () => Array.from(new Set(wallets.filter(Boolean))),
    [wallets]
  );
  const walletsKey = uniqueWallets.join("|");

  const [profilesByWallet, setProfilesByWallet] = useState<Record<string, Roll2RollSocialProfile | null>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!ENABLE_TAPESTRY_SOCIAL || uniqueWallets.length === 0) {
      setProfilesByWallet({});
      setLoading(false);
      return;
    }

    const seeded: Record<string, Roll2RollSocialProfile | null> = {};
    const missing: string[] = [];
    for (const wallet of uniqueWallets) {
      const cached = getCached(wallet);
      if (cached !== undefined) {
        seeded[wallet] = cached;
      } else {
        missing.push(wallet);
      }
    }

    setProfilesByWallet(seeded);
    if (missing.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);

    fetchTapestryProfiles(missing)
      .then((fetched) => {
        if (cancelled) return;
        const merged = { ...seeded, ...fetched };
        for (const [wallet, profile] of Object.entries(fetched)) {
          profileCache.set(wallet, { ts: Date.now(), profile });
        }
        setProfilesByWallet(merged);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletsKey]);

  return { profilesByWallet, loading };
}

