import { Trophy, RefreshCw } from 'lucide-react';
import { useSoarLeaderboard } from '../hooks/useSoarLeaderboard';
import { shortenAddr } from '../lib/addressUtils';
import { ENABLE_SOAR_LEADERBOARD } from '../lib/constants';

const MEDAL_COLORS: Record<number, string> = {
  1: 'text-amber-500',
  2: 'text-slate-400',
  3: 'text-orange-600',
};

const MEDAL_BG: Record<number, string> = {
  1: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  2: 'bg-slate-50 dark:bg-slate-700/30 border-slate-200 dark:border-slate-600',
  3: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
};

function dicebearUrl(seed: string): string {
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}&size=32`;
}

interface SoarLeaderboardProps {
  compact?: boolean;
}

export function SoarLeaderboard({ compact = false }: SoarLeaderboardProps) {
  if (!ENABLE_SOAR_LEADERBOARD) return null;

  const { entries, loading, refresh } = useSoarLeaderboard();
  const displayCount = compact ? 5 : 20;
  const visible = entries.slice(0, displayCount);

  return (
    <div className="col-span-1 bento-card p-4 sm:p-5 flex flex-col bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-sm">
            <Trophy className="w-3.5 h-3.5" />
          </div>
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Volume Leaderboard</h3>
        </div>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && entries.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: compact ? 5 : 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 animate-pulse">
              <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700" />
              <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
              <div className="h-3 w-14 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
          <Trophy className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No leaderboard data yet.
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            Deposit to start climbing!
          </p>
        </div>
      )}

      {/* Entries */}
      {visible.length > 0 && (
        <div className="space-y-1">
          {visible.map((entry) => {
            const isTop3 = entry.rank <= 3;
            const usdcValue = (entry.score / 100).toFixed(2);
            return (
              <div
                key={entry.player}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors ${
                  isTop3
                    ? `border ${MEDAL_BG[entry.rank]}`
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
                }`}
              >
                {/* Rank */}
                <span
                  className={`text-xs font-bold w-5 text-center ${
                    MEDAL_COLORS[entry.rank] || 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {entry.rank <= 3 ? ['', '1st', '2nd', '3rd'][entry.rank] : `#${entry.rank}`}
                </span>

                {/* Avatar */}
                <img
                  src={dicebearUrl(entry.player)}
                  alt=""
                  className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700"
                />

                {/* Address */}
                <span className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                  {shortenAddr(entry.player)}
                </span>

                {/* Score */}
                <span className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                  ${usdcValue}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
