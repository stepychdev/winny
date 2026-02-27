import React from 'react';
import { Clock, Loader2, CheckCircle, Timer, XCircle } from 'lucide-react';
import { GamePhase } from '../types';

interface RoundInfoProps {
  phase: GamePhase;
  timeLeft: number;
  totalUsdc: number;
  playerCount: number;
}

const PHASE_CONFIG: Record<GamePhase, { label: string; color: string; icon: React.ElementType }> = {
  waiting: { label: 'WAITING', color: 'text-slate-400', icon: Clock },
  open: { label: 'OPEN', color: 'text-green-600', icon: Timer },
  countdown: { label: 'CLOSING', color: 'text-amber-600', icon: Clock },
  spinning: { label: 'DRAWING', color: 'text-primary', icon: Loader2 },
  settled: { label: 'SETTLED', color: 'text-emerald-600', icon: CheckCircle },
  claimed: { label: 'CLAIMED', color: 'text-slate-400', icon: CheckCircle },
  cancelled: { label: 'CANCELLED', color: 'text-red-500', icon: XCircle },
};

export function RoundInfo({ phase, playerCount }: RoundInfoProps) {
  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const isSpinning = phase === 'spinning';

  return (
    <div className="space-y-2">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${config.color} ${isSpinning ? 'animate-spin' : ''}`} />
        <span className={`font-bold text-xs tracking-wider ${config.color}`}>
          {config.label}
        </span>
      </div>

      {/* Game status text */}
      <div className="text-slate-500 dark:text-slate-400 text-xs">
        {phase === 'waiting' && 'Waiting for players...'}
        {phase === 'open' && `${playerCount} player${playerCount !== 1 ? 's' : ''} in round`}
        {phase === 'countdown' && 'Round closing soon!'}
        {phase === 'spinning' && 'Selecting winner via VRF...'}
        {phase === 'settled' && 'Winner selected!'}
        {phase === 'claimed' && 'Prize claimed'}
        {phase === 'cancelled' && 'Round cancelled'}
      </div>
    </div>
  );
}
