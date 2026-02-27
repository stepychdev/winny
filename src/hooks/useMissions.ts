import { useCallback, useEffect, useMemo, useState } from 'react';

const MISSIONS_KEY = 'roll2roll_missions';

export interface Mission {
  id: string;
  title: string;
  description: string;
  icon: string;             // emoji
  type: 'daily' | 'weekly' | 'achievement';
  requirement: number;      // target count
  progress: number;         // current count
  xp: number;               // JUP reward
  completed: boolean;
  claimed: boolean;
}

export interface MissionsData {
  walletAddress: string;
  missions: Mission[];
  totalJup: number;
  level: number;
  streak: number;           // consecutive days played
  lastPlayDate: string;     // YYYY-MM-DD
  jupiterSwapCount: number;
  totalDeposits: number;
  totalVolume: number;
  roundsPlayed: number;
  wins: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function jupForLevel(level: number): number {
  return level * 100;
}

function getDefaultMissions(): Mission[] {
  return [
    {
      id: 'daily_deposit',
      title: 'Daily Deposit',
      description: 'Make a deposit today',
      icon: '💰',
      type: 'daily',
      requirement: 1,
      progress: 0,
      xp: 25,
      completed: false,
      claimed: false,
    },
    {
      id: 'daily_3rounds',
      title: 'Active Player',
      description: 'Participate in 3 rounds today',
      icon: '🎮',
      type: 'daily',
      requirement: 3,
      progress: 0,
      xp: 50,
      completed: false,
      claimed: false,
    },
    {
      id: 'daily_jupiter_swap',
      title: 'Jupiter Swapper',
      description: 'Deposit a non-USDC token (uses Jupiter swap)',
      icon: '🪐',
      type: 'daily',
      requirement: 1,
      progress: 0,
      xp: 40,
      completed: false,
      claimed: false,
    },
    {
      id: 'weekly_volume',
      title: 'High Roller',
      description: 'Deposit 100+ USDC total this week',
      icon: '🎰',
      type: 'weekly',
      requirement: 100,
      progress: 0,
      xp: 200,
      completed: false,
      claimed: false,
    },
    {
      id: 'weekly_5_rounds',
      title: 'Round Runner',
      description: 'Play 5 rounds this week',
      icon: '🏃',
      type: 'weekly',
      requirement: 5,
      progress: 0,
      xp: 150,
      completed: false,
      claimed: false,
    },
    {
      id: 'achievement_first_win',
      title: 'First Blood',
      description: 'Win your first round',
      icon: '🏆',
      type: 'achievement',
      requirement: 1,
      progress: 0,
      xp: 100,
      completed: false,
      claimed: false,
    },
    {
      id: 'achievement_3day_streak',
      title: 'Streak Master',
      description: 'Play 3 consecutive days',
      icon: '🔥',
      type: 'achievement',
      requirement: 3,
      progress: 0,
      xp: 150,
      completed: false,
      claimed: false,
    },
    {
      id: 'achievement_10_swaps',
      title: 'Jupiter Explorer',
      description: 'Make 10 Jupiter-powered deposits',
      icon: '🚀',
      type: 'achievement',
      requirement: 10,
      progress: 0,
      xp: 300,
      completed: false,
      claimed: false,
    },
  ];
}

function loadMissionsData(walletAddress: string): MissionsData {
  try {
    const raw = localStorage.getItem(`${MISSIONS_KEY}_${walletAddress}`);
    if (raw) {
      const data: MissionsData = JSON.parse(raw);
      // Reset dailies if date changed
      const t = today();
      if (data.lastPlayDate !== t) {
        data.missions = data.missions.map(m => {
          if (m.type === 'daily') return { ...m, progress: 0, completed: false, claimed: false };
          return m;
        });
        // Check/update streak
        const lastDate = new Date(data.lastPlayDate);
        const todayDate = new Date(t);
        const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000);
        if (diffDays === 1) {
          data.streak += 1;
        } else if (diffDays > 1) {
          data.streak = 0;
        }
      }
      // Reset weeklies if > 7 days
      const monday = getMonday(new Date());
      const lastMonday = getMonday(new Date(data.lastPlayDate));
      if (monday.getTime() !== lastMonday.getTime()) {
        data.missions = data.missions.map(m => {
          if (m.type === 'weekly') return { ...m, progress: 0, completed: false, claimed: false };
          return m;
        });
      }
      // Merge new missions that may have been added
      const defaultIds = new Set(getDefaultMissions().map(m => m.id));
      const existingIds = new Set(data.missions.map(m => m.id));
      for (const dm of getDefaultMissions()) {
        if (!existingIds.has(dm.id)) data.missions.push(dm);
      }
      // Remove missions that no longer exist
      data.missions = data.missions.filter(m => defaultIds.has(m.id));
      return data;
    }
  } catch { /* ignore */ }

  return {
    walletAddress,
    missions: getDefaultMissions(),
    totalJup: 0,
    level: 1,
    streak: 0,
    lastPlayDate: '',
    jupiterSwapCount: 0,
    totalDeposits: 0,
    totalVolume: 0,
    roundsPlayed: 0,
    wins: 0,
  };
}

function getMonday(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function saveMissionsData(data: MissionsData) {
  try {
    localStorage.setItem(`${MISSIONS_KEY}_${data.walletAddress}`, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function useMissions(walletAddress: string | null) {
  const [data, setData] = useState<MissionsData | null>(null);

  useEffect(() => {
    if (!walletAddress) { setData(null); return; }
    setData(loadMissionsData(walletAddress));
  }, [walletAddress]);

  const updateAndSave = useCallback((updater: (d: MissionsData) => MissionsData) => {
    setData(prev => {
      if (!prev) return prev;
      const next = updater({ ...prev, missions: prev.missions.map(m => ({ ...m })) });
      // Recalculate completed
      next.missions = next.missions.map(m => ({
        ...m,
        completed: m.progress >= m.requirement,
      }));
      saveMissionsData(next);
      return next;
    });
  }, []);

  /** Track a deposit event. Call after successful deposit. */
  const trackDeposit = useCallback((amount: number, isJupiterSwap: boolean) => {
    updateAndSave(d => {
      d.lastPlayDate = today();
      d.totalDeposits += 1;
      d.totalVolume += amount;

      // Daily deposit
      const dd = d.missions.find(m => m.id === 'daily_deposit');
      if (dd && !dd.completed) dd.progress = Math.min(dd.progress + 1, dd.requirement);

      // Weekly volume
      const wv = d.missions.find(m => m.id === 'weekly_volume');
      if (wv && !wv.completed) wv.progress = Math.min(wv.progress + amount, wv.requirement);

      if (isJupiterSwap) {
        d.jupiterSwapCount += 1;
        // Daily Jupiter swap
        const dj = d.missions.find(m => m.id === 'daily_jupiter_swap');
        if (dj && !dj.completed) dj.progress = Math.min(dj.progress + 1, dj.requirement);
        // Achievement: 10 Jupiter swaps
        const aj = d.missions.find(m => m.id === 'achievement_10_swaps');
        if (aj && !aj.completed) aj.progress = Math.min(d.jupiterSwapCount, aj.requirement);
      }

      return d;
    });
  }, [updateAndSave]);

  /** Track round participation */
  const trackRoundPlayed = useCallback(() => {
    updateAndSave(d => {
      d.lastPlayDate = today();
      d.roundsPlayed += 1;

      // Daily 3 rounds
      const dr = d.missions.find(m => m.id === 'daily_3rounds');
      if (dr && !dr.completed) dr.progress = Math.min(dr.progress + 1, dr.requirement);

      // Weekly 5 rounds
      const wr = d.missions.find(m => m.id === 'weekly_5_rounds');
      if (wr && !wr.completed) wr.progress = Math.min(wr.progress + 1, wr.requirement);

      // Streak
      const sm = d.missions.find(m => m.id === 'achievement_3day_streak');
      if (sm && !sm.completed) sm.progress = Math.min(d.streak + 1, sm.requirement);

      return d;
    });
  }, [updateAndSave]);

  /** Track a win */
  const trackWin = useCallback(() => {
    updateAndSave(d => {
      d.wins += 1;
      const fw = d.missions.find(m => m.id === 'achievement_first_win');
      if (fw && !fw.completed) fw.progress = Math.min(d.wins, fw.requirement);
      return d;
    });
  }, [updateAndSave]);

  /** Claim JUP for a completed mission */
  const claimMission = useCallback((missionId: string) => {
    updateAndSave(d => {
      const m = d.missions.find(mi => mi.id === missionId);
      if (!m || !m.completed || m.claimed) return d;
      m.claimed = true;
      d.totalJup += m.xp;
      // Level up check
      while (d.totalJup >= jupForLevel(d.level)) {
        d.totalJup -= jupForLevel(d.level);
        d.level += 1;
      }
      return d;
    });
  }, [updateAndSave]);

  const missions = data?.missions ?? [];
  const level = data?.level ?? 1;
  const totalJup = data?.totalJup ?? 0;
  const jupToNext = jupForLevel(level);
  const streak = data?.streak ?? 0;
  const completedCount = missions.filter(m => m.completed).length;
  const claimableCount = missions.filter(m => m.completed && !m.claimed).length;

  const stats = useMemo(() => ({
    totalDeposits: data?.totalDeposits ?? 0,
    totalVolume: data?.totalVolume ?? 0,
    roundsPlayed: data?.roundsPlayed ?? 0,
    wins: data?.wins ?? 0,
    jupiterSwapCount: data?.jupiterSwapCount ?? 0,
  }), [data]);

  return {
    missions,
    level,
    totalJup,
    jupToNext,
    streak,
    completedCount,
    claimableCount,
    stats,
    trackDeposit,
    trackRoundPlayed,
    trackWin,
    claimMission,
  };
}
