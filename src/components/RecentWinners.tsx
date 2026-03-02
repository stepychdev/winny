import { useEffect, useRef, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { HistoryRound } from '../hooks/useRoundHistory';
import { fetchRecentWinnersFromFirebase } from '../lib/roundArchive';
import { useNavigation } from '../contexts/NavigationContext';
import { useJackpotContext } from '../contexts/JackpotContext';
import { shortenAddr } from '../lib/addressUtils';

export function RecentWinners() {
  const [winners, setWinners] = useState<HistoryRound[]>([]);
  const { roundId } = useJackpotContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecentWinnersFromFirebase(10)
      .then((recent) => {
        if (!cancelled) setWinners(recent);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roundId]);

  if (winners.length === 0) return null;

  // Double items for seamless infinite scroll
  const doubled = [...winners, ...winners];

  return (
    <div className="live-ticker-wrap overflow-hidden rounded-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200/60 dark:border-slate-800/50 py-2.5 px-2">
      <div
        ref={scrollRef}
        className="live-ticker-track flex items-center gap-5 whitespace-nowrap"
      >
        {doubled.map((r, idx) => (
          <WinnerTickerItem key={`${r.roundId}-${idx}`} round={r} />
        ))}
      </div>
    </div>
  );
}

function WinnerTickerItem({ round }: { round: HistoryRound }) {
  const { navigateToPlayer, navigateToRound } = useNavigation();

  const winnerDeposit = round.participantDeposits?.find(
    (d) => d.address === round.winner
  );
  const winnerBet = winnerDeposit?.usdc ?? 0;
  const multiplier = winnerBet > 0 ? round.totalUsdc / winnerBet : 0;

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {/* Trophy icon */}
      <Trophy className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />

      {/* Round number — clickable */}
      <button
        onClick={() => navigateToRound(round.roundId)}
        className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600 hover:bg-primary/10 hover:text-primary hover:border-primary/30 dark:hover:bg-primary/20 dark:hover:text-primary transition-colors cursor-pointer"
      >
        #{round.roundId}
      </button>

      {/* Wallet — clickable */}
      <button
        onClick={() => navigateToPlayer(round.winner)}
        className="font-medium text-slate-700 dark:text-slate-300 hover:text-primary dark:hover:text-primary hover:underline transition-colors cursor-pointer"
      >
        {shortenAddr(round.winner)}
      </button>

      {/* Amount */}
      <span className="font-bold text-emerald-600 dark:text-emerald-400">
        ${round.totalUsdc.toFixed(2)}
      </span>

      {/* Multiplier badge */}
      {multiplier >= 2 && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          {multiplier.toFixed(1)}x
        </span>
      )}

      {/* Separator */}
      <span className="text-slate-300 dark:text-slate-700 mx-1 select-none">/</span>
    </span>
  );
}
