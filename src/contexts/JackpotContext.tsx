import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useJackpot, type JackpotState } from '../hooks/useJackpot';
import { useWalletTokens, type WalletToken } from '../hooks/useWalletTokens';
import { useMissions } from '../hooks/useMissions';
import { pushNotification } from '../hooks/useNotifications';
import { WHEEL_RESULT_REVEAL_DELAY_MS } from '../lib/constants';

const FEE_RATE = 0.0025;

interface MissionsApi {
  missions: ReturnType<typeof useMissions>['missions'];
  level: number;
  totalJup: number;
  jupToNext: number;
  streak: number;
  claimableCount: number;
  stats: ReturnType<typeof useMissions>['stats'];
  trackDeposit: (amount: number, isJupiterSwap: boolean) => void;
  trackRoundPlayed: () => void;
  trackWin: () => void;
  claimMission: (id: string) => void;
}

interface JackpotContextType extends JackpotState {
  tokens: WalletToken[];
  tokensLoading: boolean;
  refetchTokens: () => void;
  missionsApi: MissionsApi;
}

const JackpotContext = createContext<JackpotContextType | null>(null);

export function JackpotProvider({ children }: { children: React.ReactNode }) {
  const { publicKey } = useWallet();
  const jackpot = useJackpot();
  const { tokens, loading: tokensLoading, refetch: refetchTokens } = useWalletTokens();
  const walletAddress = publicKey?.toBase58() ?? '';
  const missionsHook = useMissions(walletAddress || null);

  // ── Push notifications when round settles (works regardless of active tab) ──
  const settledNotifiedRef = useRef<number | null>(null);
  const settledNotificationScheduledRef = useRef<number | null>(null);
  const settledNotifyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (jackpot.phase !== 'settled' || !jackpot.winner) return;
    if (settledNotifiedRef.current === jackpot.roundId) return;
    if (!walletAddress) return;
    if (settledNotificationScheduledRef.current === jackpot.roundId) return;
    const winner = jackpot.winner;
    const roundId = jackpot.roundId;
    const totalUsdc = jackpot.totalUsdc;
    const participants = jackpot.participants;

    if (settledNotifyTimerRef.current !== null) {
      clearTimeout(settledNotifyTimerRef.current);
      settledNotifyTimerRef.current = null;
    }
    settledNotificationScheduledRef.current = roundId;

    settledNotifyTimerRef.current = window.setTimeout(() => {
      const isMe = winner.address === walletAddress;
      const wasParticipant = participants.some((p) => p.address === walletAddress);

      // Track round participation for missions
      if (wasParticipant) missionsHook.trackRoundPlayed();

      if (isMe) {
        missionsHook.trackWin();
        pushNotification({
          type: 'win',
          title: `You won Round #${roundId}!`,
          detail: `$${(totalUsdc * (1 - FEE_RATE)).toFixed(2)} USDC`,
        });
      } else if (wasParticipant) {
        pushNotification({
          type: 'loss',
          title: `You lost Round #${roundId}`,
          detail: `Winner: ${winner.displayName}`,
        });
      }
      settledNotifiedRef.current = roundId;
      settledNotificationScheduledRef.current = null;
      settledNotifyTimerRef.current = null;
    }, WHEEL_RESULT_REVEAL_DELAY_MS);

    return () => {
      if (settledNotifyTimerRef.current !== null && settledNotificationScheduledRef.current !== roundId) {
        clearTimeout(settledNotifyTimerRef.current);
        settledNotifyTimerRef.current = null;
        settledNotificationScheduledRef.current = null;
      }
    };
  }, [jackpot.phase, jackpot.roundId, jackpot.winner, jackpot.totalUsdc, jackpot.participants, walletAddress]);

  // Cleanup on unmount only.
  useEffect(() => {
    return () => {
      if (settledNotifyTimerRef.current !== null) {
        clearTimeout(settledNotifyTimerRef.current);
        settledNotifyTimerRef.current = null;
      }
      settledNotificationScheduledRef.current = null;
    };
  }, []);

  // ── Push notifications for unclaimed prizes found on startup ──
  const unclaimedNotifiedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!walletAddress || jackpot.unclaimedPrizes.length === 0) return;
    for (const prize of jackpot.unclaimedPrizes) {
      if (unclaimedNotifiedRef.current.has(prize.roundId)) continue;
      // Don't double-notify if we just pushed a settled notification for this round
      if (settledNotifiedRef.current === prize.roundId) {
        unclaimedNotifiedRef.current.add(prize.roundId);
        continue;
      }
      unclaimedNotifiedRef.current.add(prize.roundId);
      pushNotification({
        type: 'win',
        title: `You won Round #${prize.roundId}!`,
        detail: `$${prize.payout.toFixed(2)} USDC unclaimed`,
      });
    }
  }, [jackpot.unclaimedPrizes, walletAddress]);

  const missionsApi: MissionsApi = {
    missions: missionsHook.missions,
    level: missionsHook.level,
    totalJup: missionsHook.totalJup,
    jupToNext: missionsHook.jupToNext,
    streak: missionsHook.streak,
    claimableCount: missionsHook.claimableCount,
    stats: missionsHook.stats,
    trackDeposit: missionsHook.trackDeposit,
    trackRoundPlayed: missionsHook.trackRoundPlayed,
    trackWin: missionsHook.trackWin,
    claimMission: missionsHook.claimMission,
  };

  const value: JackpotContextType = {
    ...jackpot,
    tokens,
    tokensLoading,
    refetchTokens,
    missionsApi,
  };

  return (
    <JackpotContext.Provider value={value}>
      {children}
    </JackpotContext.Provider>
  );
}

export function useJackpotContext(): JackpotContextType {
  const ctx = useContext(JackpotContext);
  if (!ctx) throw new Error('useJackpotContext must be used within JackpotProvider');
  return ctx;
}
