import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { HistoryRound } from '../hooks/useRoundHistory';
import { fetchRecentWinnersFromFirebase } from '../lib/roundArchive';
import { useNavigation } from '../contexts/NavigationContext';
import { shortenAddr } from '../lib/addressUtils';
import { timeAgo } from '../lib/timeUtils';

function avatarUrl(addr: string): string {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(addr)}`;
}

function avatarFallback(addr: string): string {
  return addr.slice(0, 2).toUpperCase();
}

export function RecentWinners() {
  const [winners, setWinners] = useState<HistoryRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const recent = await fetchRecentWinnersFromFirebase(5);
        if (!cancelled) setWinners(recent);
      } catch (e) {
        console.warn('Failed to fetch recent winners:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading && winners.length === 0) {
    return (
      <div className="bento-card p-4 shadow-soft bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Recent Winners</h3>
        </div>
        <p className="text-sm text-slate-400 animate-pulse">Loading history...</p>
      </div>
    );
  }

  if (winners.length === 0) return null;

  return (
    <div className="bento-card p-4 shadow-soft bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="w-5 h-5 text-yellow-500" />
        <h3 className="font-bold text-slate-900 dark:text-white text-base">Recent Winners</h3>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {winners.map((r) => (
          <WinnerCard key={r.roundId} round={r} />
        ))}
      </div>
    </div>
  );
}

function WinnerCard({ round }: { round: HistoryRound }) {
  const { navigateToPlayer } = useNavigation();

  const winnerDeposit = round.participantDeposits?.find(
    (d) => d.address === round.winner
  );
  const winnerBet = winnerDeposit?.usdc ?? 0;
  const winChance = round.totalUsdc > 0 && winnerBet > 0
    ? (winnerBet / round.totalUsdc) * 100
    : 0;
  const multiplier = winnerBet > 0 ? round.totalUsdc / winnerBet : 0;

  return (
    <div
      className="flex-shrink-0 w-44 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-600 p-3 cursor-pointer hover:ring-2 hover:ring-primary/40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
      onClick={() => navigateToPlayer(round.winner)}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-bold text-slate-500 dark:text-slate-400">#{round.roundId}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{timeAgo(round.endTs)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-7 h-7 rounded-full overflow-hidden ring-1 ring-slate-200 dark:ring-slate-600 bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-700 dark:text-slate-200">
          <img
            src={avatarUrl(round.winner)}
            alt={`Avatar ${shortenAddr(round.winner)}`}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <span>{avatarFallback(round.winner)}</span>
        </div>
        <div className="text-base font-mono font-medium text-slate-900 dark:text-white truncate">
          {shortenAddr(round.winner)}
        </div>
      </div>
      <div className="text-lg font-bold text-green-500 mt-1">
        ${round.totalUsdc.toFixed(2)}
      </div>
      {winnerBet > 0 && (
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-600">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {winChance.toFixed(1)}% chance
          </span>
          <span className={`text-xs font-bold ${multiplier >= 2 ? 'text-amber-500' : 'text-slate-500 dark:text-slate-400'}`}>
            {multiplier.toFixed(1)}x
          </span>
        </div>
      )}
    </div>
  );
}
