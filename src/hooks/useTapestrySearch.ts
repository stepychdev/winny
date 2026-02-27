import { useEffect, useState } from "react";
import { ENABLE_TAPESTRY_SOCIAL } from "../lib/constants";
import { searchProfiles } from "../lib/tapestry/api";
import type { Roll2RollSocialProfile } from "../lib/tapestry/types";

const DEBOUNCE_MS = 300;

export function useTapestrySearch(query: string) {
  const clean = query.trim();
  const [results, setResults] = useState<Roll2RollSocialProfile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ENABLE_TAPESTRY_SOCIAL || !clean) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      searchProfiles(clean)
        .then((next) => { if (!cancelled) setResults(next); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clean]);

  return { results, loading };
}
