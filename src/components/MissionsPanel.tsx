import { useState, useEffect, useRef } from 'react';
import { X, Zap, Flame } from 'lucide-react';
import type { Mission } from '../hooks/useMissions';

interface MissionsPanelProps {
  missions: Mission[];
  level: number;
  totalJup: number;
  jupToNext: number;
  streak: number;
  claimableCount: number;
  onClaim: (id: string) => void;
}

function MissionRow({ mission, onClaim }: { mission: Mission; onClaim: (id: string) => void }) {
  const pct = Math.min((mission.progress / mission.requirement) * 100, 100);
  const canClaim = mission.completed && !mission.claimed;

  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-colors ${
      mission.claimed ? 'opacity-50' : canClaim ? 'bg-amber-50 dark:bg-amber-900/20' : ''
    }`}>
      <span className="text-2xl flex-shrink-0">{mission.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{mission.title}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
            mission.type === 'daily' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
            : mission.type === 'weekly' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400'
            : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
          }`}>{mission.type}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                mission.completed ? 'bg-green-500' : 'bg-primary'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex-shrink-0">
            {mission.progress}/{mission.requirement}
          </span>
        </div>
      </div>
      <div className="flex-shrink-0">
        {canClaim ? (
          <button
            onClick={() => onClaim(mission.id)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-all animate-pulse"
          >
            +{mission.xp} JUP
          </button>
        ) : mission.claimed ? (
          <span className="text-xs text-green-500 font-bold">✓</span>
        ) : (
          <span className="text-xs text-slate-400 font-mono">+{mission.xp}</span>
        )}
      </div>
    </div>
  );
}

export function MissionsPanel({ missions, level, totalJup, jupToNext, streak, claimableCount, onClaim }: MissionsPanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const dailies = missions.filter(m => m.type === 'daily');
  const weeklies = missions.filter(m => m.type === 'weekly');
  const achievements = missions.filter(m => m.type === 'achievement');
  const jupPct = Math.min((totalJup / jupToNext) * 100, 100);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={panelRef} className="fixed bottom-16 sm:bottom-20 left-3 sm:left-5 z-50">
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="relative flex items-center gap-4 px-7 py-4 bg-slate-900/90 dark:bg-slate-800/95 backdrop-blur-md text-white rounded-full shadow-2xl border border-slate-700/50 hover:bg-slate-800 dark:hover:bg-slate-700 transition-all active:scale-95"
        >
          <div className="size-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-black text-xl shadow-md">
            {level}
          </div>
          <span className="text-lg font-bold">Missions</span>
          <Zap className="w-6 h-6 text-amber-400" />
          {claimableCount > 0 && (
            <span className="absolute -top-2 -left-2 size-7 flex items-center justify-center text-sm font-bold bg-amber-500 text-white rounded-full animate-bounce shadow">
              {claimableCount}
            </span>
          )}
        </button>
      )}

      {/* Expanded overlay panel */}
      {open && (
        <div className="w-[380px] sm:w-[420px] max-h-[70vh] flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-black text-base shadow-md">
                {level}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-slate-900 dark:text-white">Missions</span>
                  {streak > 0 && (
                    <span className="flex items-center gap-0.5 text-xs text-orange-500 font-bold">
                      <Flame className="w-3.5 h-3.5" />{streak}d
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-20 h-2 bg-slate-100 dark:bg-slate-600 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${jupPct}%` }} />
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{totalJup}/{jupToNext} JUP</span>
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Scrollable mission list */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
            {dailies.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-blue-500 mb-2 px-1">Daily</h4>
                <div className="space-y-1">
                  {dailies.map(m => <MissionRow key={m.id} mission={m} onClaim={onClaim} />)}
                </div>
              </div>
            )}
            {weeklies.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-500 mb-2 px-1">Weekly</h4>
                <div className="space-y-1">
                  {weeklies.map(m => <MissionRow key={m.id} mission={m} onClaim={onClaim} />)}
                </div>
              </div>
            )}
            {achievements.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-500 mb-2 px-1">Achievements</h4>
                <div className="space-y-1">
                  {achievements.map(m => <MissionRow key={m.id} mission={m} onClaim={onClaim} />)}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-1.5 px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
            <span className="text-xs text-slate-400">Swaps powered by</span>
            <a href="https://jup.ag/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-primary transition-colors underline">Jupiter</a>
            <span className="text-sm">🪐</span>
          </div>
        </div>
      )}
    </div>
  );
}
