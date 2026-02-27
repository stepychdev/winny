import { useEffect, useRef, useState } from 'react';
import { useJackpotContext } from '../contexts/JackpotContext';
import { fetchRecentWinnersFromFirebase } from '../lib/roundArchive';
import { shortenAddr } from '../lib/addressUtils';
import type { HistoryRound } from '../hooks/useRoundHistory';
import type { Participant } from '../types';

type TickerTag = 'POT' | 'LIVE' | 'SPIN' | 'IN' | 'WHALE' | 'WIN';

interface TickerItem {
  id: string;
  tag: TickerTag;
  text: string;
  highlight?: boolean;
}

const TAG_STYLES: Record<TickerTag, string> = {
  POT:   'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30',
  LIVE:  'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-500/20 dark:text-sky-400 dark:border-sky-500/30',
  SPIN:  'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30',
  IN:    'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30',
  WHALE: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30',
  WIN:   'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-500/20 dark:text-yellow-300 dark:border-yellow-500/30',
};

function buildLiveItems(
  participants: Participant[],
  totalUsdc: number,
  roundId: number,
  phase: string,
): TickerItem[] {
  const items: TickerItem[] = [];

  if (participants.length > 0 && totalUsdc > 0) {
    items.push({
      id: `pot-${roundId}`,
      tag: 'POT',
      text: `Round #${roundId} — $${totalUsdc.toFixed(2)}`,
    });
    items.push({
      id: `players-${roundId}`,
      tag: 'LIVE',
      text: `${participants.length} player${participants.length > 1 ? 's' : ''} in the game`,
    });
  }

  if (phase === 'spinning') {
    items.push({ id: `spin-${roundId}`, tag: 'SPIN', text: 'Wheel is spinning', highlight: true });
  }

  const sorted = [...participants].sort((a, b) => b.usdcAmount - a.usdcAmount);
  sorted.slice(0, 3).forEach((p) => {
    const isWhale = p.usdcAmount >= 100;
    items.push({
      id: `dep-${roundId}-${p.address}`,
      tag: isWhale ? 'WHALE' : 'IN',
      text: `${shortenAddr(p.address)} — $${p.usdcAmount.toFixed(2)}`,
      highlight: isWhale,
    });
  });

  return items;
}

function buildHistoryItems(winners: HistoryRound[]): TickerItem[] {
  return winners.map((r) => {
    const multiplier = (() => {
      const dep = r.participantDeposits?.find((d) => d.address === r.winner);
      return dep && dep.usdc > 0 ? r.totalUsdc / dep.usdc : 0;
    })();
    return {
      id: `win-${r.roundId}`,
      tag: 'WIN' as TickerTag,
      text: `${shortenAddr(r.winner)} won $${r.totalUsdc.toFixed(2)}${multiplier >= 2 ? ` ${multiplier.toFixed(1)}x` : ''}`,
      highlight: r.totalUsdc >= 200 || multiplier >= 5,
    };
  });
}

export function LiveTicker() {
  const { participants, totalUsdc, roundId, phase } = useJackpotContext();
  const [historyItems, setHistoryItems] = useState<TickerItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecentWinnersFromFirebase(5)
      .then((winners) => {
        if (!cancelled) setHistoryItems(buildHistoryItems(winners));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roundId]); // re-fetch when round advances

  const liveItems = buildLiveItems(participants, totalUsdc, roundId, phase);
  const allItems = [...liveItems, ...historyItems];

  // Need at least a few items for the ticker to look good
  if (allItems.length < 2) return null;

  // Duplicate items for seamless loop
  const doubled = [...allItems, ...allItems];

  return (
    <div className="live-ticker-wrap overflow-hidden bg-white/80 dark:bg-transparent border-b border-slate-200/60 dark:border-transparent">
      <div ref={scrollRef} className="live-ticker-track flex items-center gap- whitespace-nowrap">
        {doubled.map((item, idx) => (
          <span
            key={`${item.id}-${idx}`}
            className={`inline-flex items-center gap-2 text-sm font-medium ${
              item.highlight
                ? 'text-amber-600 dark:text-amber-300'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <span
              className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border uppercase ${TAG_STYLES[item.tag]}`}
            >
              {item.tag}
            </span>
            <span>{item.text}</span>
            <span className="text-slate-300 dark:text-slate-700 mx-1 select-none">/</span>
          </span>
        ))}
      </div>
    </div>
  );
}
