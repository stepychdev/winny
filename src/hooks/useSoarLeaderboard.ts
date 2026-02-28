import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { fetchLeaderboard, type LeaderboardEntry } from '../lib/soar';
import { ENABLE_SOAR_LEADERBOARD } from '../lib/constants';

const POLL_INTERVAL_MS = 60_000;

export function useSoarLeaderboard() {
  const { connection } = useConnection();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const refresh = useCallback(async () => {
    if (!ENABLE_SOAR_LEADERBOARD) {
      setLoading(false);
      return;
    }
    try {
      const data = await fetchLeaderboard(connection);
      setEntries(data);
    } catch (e) {
      console.warn('SOAR leaderboard fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    if (!ENABLE_SOAR_LEADERBOARD) {
      setLoading(false);
      return;
    }

    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  return { entries, loading, refresh };
}
