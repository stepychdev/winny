import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Header } from '../components/Header';
import { JackpotWheel } from '../components/JackpotWheel';
import { DepositPanel } from '../components/DepositPanel';
import { ParticipantsList } from '../components/ParticipantsList';
import { RoundInfo } from '../components/RoundInfo';
import { WinnerModal } from '../components/WinnerModal';
import { MissionsPanel } from '../components/MissionsPanel';
import { JupiterMobileBanner } from '../components/JupiterMobileBanner';
import { Button } from '../components/ui/Button';
import { Trophy, XCircle, Shield, ExternalLink, Timer, RefreshCw } from 'lucide-react';
import { Chat } from '../components/Chat';
import { UnclaimedBadge } from '../components/UnclaimedBadge';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { RecentWinners } from '../components/RecentWinners';
import { LiveTicker } from '../components/LiveTicker';
import { SocialActivityCard } from '../components/social/SocialActivityCard';
import { useJackpotContext } from '../contexts/JackpotContext';
import type { DepositLegInput } from '../hooks/useJackpot';
import { getRoundPda } from '../lib/program';
import { ROUND_DURATION_SEC, SOLSCAN_CLUSTER_QUERY, USDC_MINT, WHEEL_RESULT_REVEAL_DELAY_MS, MIN_TOTAL_TICKETS, TICKET_UNIT, USDC_DECIMALS, ENABLE_MULTI_DEPOSIT, ENABLE_TAPESTRY_SOCIAL } from '../lib/constants';
import { formatUsdc, formatUsdcCompact } from '../lib/format';
import { shouldShowCancelRefundCard } from '../lib/roundUi';
import { importOrCreateTapestryProfile, publishTapestryEvent } from '../lib/tapestry/api';
import { emitFeedRefresh } from '../lib/tapestry/events';

const FEE_RATE = 0.0025;

export function Home() {
  const { publicKey, connected } = useWallet();
  const { tokens, tokensLoading, refetchTokens, missionsApi, ...jackpot } = useJackpotContext();
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [dismissedWinnerRound, setDismissedWinnerRound] = useState<number | null>(null);
  const [spinComplete, setSpinComplete] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  // Snapshot of winner data so modal survives round auto-advance
  const [winnerSnapshot, setWinnerSnapshot] = useState<{
    address: string; displayName: string; amount: number;
    fee: number; payout: number; color: string;
    degenSeed?: string | null;
  } | null>(null);

  const walletAddress = publicKey?.toBase58() ?? '';
  const myDeposit = jackpot.participants.find((p) => p.address === walletAddress);
  const showCancelRefundCard = shouldShowCancelRefundCard({
    connected,
    hasMyDeposit: !!myDeposit,
    phase: jackpot.phase,
    timeLeft: jackpot.timeLeft,
  });
  const myShare = myDeposit && jackpot.totalUsdc > 0
    ? (myDeposit.usdcAmount / jackpot.totalUsdc) * 100
    : 0;

  const winnerIndex = jackpot.winner
    ? jackpot.participants.findIndex((p) => p.address === jackpot.winner!.address)
    : null;
  const visibleUnclaimedPrizes = jackpot.unclaimedPrizes.filter(
    (prize) => spinComplete || prize.roundId !== jackpot.roundId
  );

  React.useEffect(() => {
    if (jackpot.phase === 'spinning') setSpinComplete(false);
  }, [jackpot.phase]);

  // Soft social bootstrap: create/import a Tapestry profile in the background.
  React.useEffect(() => {
    if (!ENABLE_TAPESTRY_SOCIAL || !connected || !walletAddress) return;
    void importOrCreateTapestryProfile(walletAddress);
  }, [connected, walletAddress]);

  // Show winner modal after spin animation completes, only for the winner
  React.useEffect(() => {
    if (jackpot.phase !== 'settled' || !jackpot.winner || dismissedWinnerRound === jackpot.roundId) return;
    // Only show modal to the winner
    if (!publicKey || jackpot.winner.address !== publicKey.toBase58()) return;
    const openModal = () => {
      const w = jackpot.winner!;
      setWinnerSnapshot({
        address: w.address,
        displayName: w.displayName,
        amount: jackpot.totalUsdc,
        fee: jackpot.totalUsdc * FEE_RATE,
        payout: jackpot.totalUsdc * (1 - FEE_RATE),
        color: w.color,
        degenSeed: null,
      });
      setShowWinnerModal(true);
      jackpot.setPauseAutoAdvance(true);
    };
    if (spinComplete) {
      openModal();
      return;
    }
    // Fallback: show after wheel reveal delay if spinComplete never fired (phase skipped/page loaded during settled)
    const timer = setTimeout(openModal, WHEEL_RESULT_REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [jackpot.phase, jackpot.winner, jackpot.roundId, dismissedWinnerRound, spinComplete, publicKey]);

  const handleAction = async (action: () => Promise<string>, label: string) => {
    try {
      setTxStatus(`${label}...`);
      const sig = await action();
      setTxStatus(`${label} ✓ ${sig.slice(0, 8)}...`);
      setTimeout(() => setTxStatus(null), 5000);
      // Publish claim/win events to Tapestry social feed
      if (walletAddress && label === 'Claim') {
        publishTapestryEvent(walletAddress, 'win', {
          round: String(jackpot.roundId),
          totalPot: String(jackpot.totalUsdc),
          sig: sig.slice(0, 16),
        });
        emitFeedRefresh();
      }
    } catch (e: any) {
      setTxStatus(`Error: ${e.message?.slice(0, 60)}`);
      setTimeout(() => setTxStatus(null), 8000);
    }
  };

  const handleDeposit = async (amount: number, mint: string, quote?: any) => {
    await handleAction(async () => {
      const sig = await jackpot.deposit(amount, mint, quote);
      const isJupiterSwap = mint !== USDC_MINT.toBase58();
      missionsApi.trackDeposit(amount, isJupiterSwap);
      refetchTokens(); // refresh wallet token list after deposit
      // Publish deposit event to Tapestry social feed (fire-and-forget)
      if (walletAddress) {
        publishTapestryEvent(walletAddress, 'deposit', {
          amount: String(amount),
          mint,
          round: String(jackpot.roundId),
          sig: sig.slice(0, 16),
        });
        emitFeedRefresh();
      }
      return sig;
    }, 'Deposit');
  };

  const handleDepositMany = async (legs: DepositLegInput[]) => {
    await handleAction(async () => {
      const sig = await jackpot.depositMany(legs);
      const hasJupiterSwap = legs.some((leg) => (leg.mint || USDC_MINT.toBase58()) !== USDC_MINT.toBase58());
      const totalInputAmount = legs.reduce((sum, leg) => sum + (Number.isFinite(leg.amount) ? leg.amount : 0), 0);
      missionsApi.trackDeposit(totalInputAmount, hasJupiterSwap);
      refetchTokens();
      // Publish deposit event to Tapestry social feed (fire-and-forget)
      if (walletAddress) {
        publishTapestryEvent(walletAddress, 'deposit', {
          amount: String(totalInputAmount),
          round: String(jackpot.roundId),
          sig: sig.slice(0, 16),
        });
        emitFeedRefresh();
      }
      return sig;
    }, 'Deposit');
  };

  const roundPda = (() => {
    try { return getRoundPda(jackpot.roundId).toBase58(); }
    catch { return ''; }
  })();

  const timerMinutes = Math.floor(jackpot.timeLeft / 60);
  const timerSeconds = jackpot.timeLeft % 60;
  const roundDuration = ROUND_DURATION_SEC;
  const progress = jackpot.timeLeft > 0 ? ((roundDuration - jackpot.timeLeft) / roundDuration) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-[#0f1219] text-slate-900 dark:text-slate-100">
      <JupiterMobileBanner />
      <Header />

      {/* TX Status Toast */}
      {txStatus && (
        <div className="fixed top-16 sm:top-4 left-3 right-3 sm:left-auto sm:right-4 z-50 bg-slate-900 text-white rounded-xl px-4 py-3 text-xs sm:text-sm font-mono shadow-lg sm:max-w-md">
          {txStatus}
        </div>
      )}

      {/* Unclaimed prize badges (top-right corner, persists across refreshes) */}
      {visibleUnclaimedPrizes.length > 0 && (
        <div className="fixed top-14 sm:top-20 right-3 sm:right-6 left-3 sm:left-auto z-50 flex flex-col items-end gap-2 sm:w-full sm:max-w-sm pointer-events-none">
          {visibleUnclaimedPrizes.map(prize => (
            <UnclaimedBadge
              key={prize.roundId}
              prize={prize}
              loading={jackpot.loading}
              onClaim={jackpot.claimUnclaimed}
            />
          ))}
        </div>
      )}

      <main className="flex-grow px-3 py-2 sm:px-4 sm:py-2 md:px-6 md:pb-4 w-full max-w-[1400px] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 auto-rows-[minmax(auto,auto)]">

          {/* ── Hero Card (col-span-2) ── */}
          <div className="col-span-1 md:col-span-3 lg:col-span-2 bento-card p-4 sm:p-5 flex flex-col justify-center relative overflow-hidden shadow-soft">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
            <div className="relative z-10 max-w-lg">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 text-xs font-bold mb-2 border border-green-200 dark:border-green-800">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Round #{jackpot.roundId} Live
              </div>
              <h1 className="text-xl sm:text-3xl md:text-4xl text-slate-900 dark:text-white leading-[1.1] mb-2">
                The <span className="font-serif italic text-primary font-medium">fairest</span> social<br />jackpot on-chain.
              </h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-md">
                Provably fair, decentralized, and built for transparency on Solana.
              </p>
            </div>
          </div>

          {/* ── Pot + Deposit Card (dark, row-span-2) ── */}
          <div className="col-span-1 lg:row-span-2 bento-card bg-slate-900 text-white p-4 sm:p-5 flex flex-col justify-between shadow-soft relative overflow-hidden">
            <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
              backgroundImage: 'radial-gradient(circle at 100% 100%, #4f46e5 0%, transparent 50%), radial-gradient(circle at 0% 0%, #0d59f2 0%, transparent 50%)'
            }} />
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-slate-300 mb-1">
                <span className="text-sm font-medium uppercase tracking-wider">Current Pot</span>
              </div>
              <div className="text-[2.5rem] sm:text-[3rem] font-bold tracking-tighter leading-none mb-1">
                <AnimatedNumber
                  value={jackpot.totalUsdc}
                  format={formatUsdcCompact}
                />
              </div>
              <div className="text-base font-medium text-blue-300">USDC</div>
              <div className="mt-2 inline-block px-3 py-1 bg-white/10 rounded-lg text-sm font-medium text-slate-300">
                {jackpot.participants.length} players
              </div>
            </div>
            <div className="relative z-10 space-y-3 mt-4">
              <div className="h-px w-full bg-white/10" />
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-300 mb-1">Your Chance</div>
                <div className="text-3xl font-bold tracking-tight"><AnimatedNumber value={myShare} format={(n) => n.toFixed(1)} />%</div>
                {myShare === 0 && connected && (
                  <p className="text-sm text-slate-400 mt-1">Deposit USDC to join</p>
                )}
              </div>

              <DepositPanel
                disabled={!connected || (jackpot.phase !== 'open' && jackpot.phase !== 'countdown' && jackpot.phase !== 'waiting')}
                loading={jackpot.loading}
                usdcBalance={jackpot.myUsdcBalance}
                tokens={tokens}
                tokensLoading={tokensLoading}
                onDeposit={handleDeposit}
                onDepositMany={ENABLE_MULTI_DEPOSIT ? handleDepositMany : undefined}
                compact
              />
            </div>
          </div>

          {/* ── Timer Card ── */}
          <div className="col-span-1 bento-card p-4 flex flex-col justify-between bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-slate-500 dark:text-slate-400 text-xs font-medium">Time Remaining</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                  {jackpot.timeLeft > 0
                    ? `${String(timerMinutes).padStart(2, '0')}:${String(timerSeconds).padStart(2, '0')}`
                    : jackpot.phase === 'spinning' ? 'Drawing...' : '--:--'}
                </p>
              </div>
              <div className="size-8 rounded-full bg-orange-50 dark:bg-orange-900/30 text-orange-500 flex items-center justify-center">
                <Timer className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                <span>Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>

            {/* Phase info */}
            <div className="mt-2">
              <RoundInfo
                phase={jackpot.phase}
                timeLeft={jackpot.timeLeft}
                totalUsdc={jackpot.totalUsdc}
                playerCount={jackpot.participants.length}
              />
            </div>
          </div>

          {/* ── Probability Wheel (col-span-2, row-span-2) ── */}
          <div className="col-span-1 md:col-span-2 lg:col-span-2 lg:row-span-2 bento-card p-3 sm:p-5 flex flex-col items-center justify-center relative shadow-soft">
            <div className="absolute top-4 left-4 z-10">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Probability Wheel</h3>
              <p className="text-slate-500 dark:text-slate-400 text-xs">Real-time distribution</p>
            </div>

            <div className="w-full max-w-[320px] mt-6">
              <JackpotWheel
                participants={jackpot.participants}
                totalUsdc={jackpot.totalUsdc}
                spinning={jackpot.phase === 'spinning'}
                winnerIndex={winnerIndex !== -1 ? winnerIndex : null}
                onSpinComplete={() => setSpinComplete(true)}
              />
            </div>

            {/* Claim button for winner */}
            {jackpot.phase === 'settled' &&
              spinComplete &&
              jackpot.winner &&
              publicKey &&
              jackpot.winner.address === walletAddress && (
                <Button
                  className="mt-4"
                  glow
                  onClick={() => handleAction(jackpot.claim, 'Claim')}
                  disabled={jackpot.loading}
                >
                  <Trophy className="w-4 h-4 mr-2" />
                  CLAIM ${(jackpot.totalUsdc * (1 - FEE_RATE)).toFixed(2)}
                </Button>
              )}
          </div>

          {/* ── Live Feed (row-span-2) ── */}
          <div className="col-span-1 lg:row-span-2 bento-card p-0 flex flex-col shadow-soft overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
            <ParticipantsList participants={jackpot.participants} totalUsdc={jackpot.totalUsdc} />
          </div>

          {/* ── Chat ── */}
          <div className="col-span-1 lg:row-span-2 bento-card p-0 flex flex-col shadow-soft overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
            <Chat />
          </div>

          {connected && ENABLE_TAPESTRY_SOCIAL && (
            <>
              {/* ── Social Section Divider ── */}
              <div className="col-span-1 md:col-span-3 lg:col-span-4 flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-200 dark:via-violet-800 to-transparent" />
                <span className="text-xs font-bold text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-3 py-1 rounded-full border border-violet-100 dark:border-violet-800 flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500" />
                  </span>
                  Social · Tapestry
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-200 dark:via-violet-800 to-transparent" />
              </div>
              <SocialActivityCard walletAddress={walletAddress || null} />
            </>
          )}

          {/* ── Vault Verified ── */}
          <div className="col-span-1 bento-card p-4 flex flex-col justify-center bg-primary/5 dark:bg-primary/10 border border-primary/10 dark:border-primary/20 shadow-none">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-7 rounded-full bg-white dark:bg-slate-800 text-primary flex items-center justify-center shadow-sm">
                <Shield className="w-3.5 h-3.5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Vault Verified</h3>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-2">
              Contract holds <span className="font-bold text-slate-900 dark:text-white">{formatUsdc(jackpot.totalUsdc)} USDC</span>. All deposits verifiable on-chain.
            </div>
            <a
              href={`https://solscan.io/account/${roundPda}${SOLSCAN_CLUSTER_QUERY}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
            >
              View on Solscan <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* ── Cancel / Status cards ── */}
          {showCancelRefundCard && (
            <div className="col-span-1 bento-card p-5 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 shadow-none flex flex-col justify-center">
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                Waiting for more players. You can cancel and get your USDC back.
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-500 mb-2">
                Min pot for draw: ${((MIN_TOTAL_TICKETS * TICKET_UNIT) / 10 ** USDC_DECIMALS).toFixed(2)} USDC
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleAction(jackpot.cancelRound, 'Cancel')}
                disabled={jackpot.loading}
              >
                <XCircle className="w-3 h-3 mr-1" /> Cancel & Refund
              </Button>
            </div>
          )}

          {/* ── Claim Refund for cancelled rounds ── */}
          {connected && myDeposit && jackpot.phase === 'cancelled' && (
            <div className="col-span-1 bento-card p-5 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 shadow-none flex flex-col justify-center">
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                This round was cancelled. Claim your deposit back.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleAction(jackpot.claimRefund, 'Claim Refund')}
                disabled={jackpot.loading}
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Claim Refund
              </Button>
            </div>
          )}

          {jackpot.autoStatus && (
            <div className="col-span-1 bento-card p-5 border border-primary/20 bg-primary/5 shadow-none">
              <p className="text-xs text-primary animate-pulse font-medium">{jackpot.autoStatus}</p>
            </div>
          )}
        </div>

        {/* ── Live Ticker ── */}
        <div className="mt-3 py-2 px-1 rounded-xl dark:bg-slate-900/80 backdrop-blur-sm border border-slate-800/50">
          <LiveTicker />
        </div>

        {/* ── Recent Winners ── */}
        <div className="mt-2 sm:mt-3">
          <RecentWinners />
        </div>
      </main>

      {/* Floating Missions Panel */}
      {connected && (
        <MissionsPanel
          missions={missionsApi.missions}
          level={missionsApi.level}
          totalJup={missionsApi.totalJup}
          jupToNext={missionsApi.jupToNext}
          streak={missionsApi.streak}
          claimableCount={missionsApi.claimableCount}
          onClaim={missionsApi.claimMission}
        />
      )}


      <WinnerModal
        isOpen={showWinnerModal}
        onClose={() => {
          setShowWinnerModal(false);
          setWinnerSnapshot(null);
          jackpot.setPauseAutoAdvance(false);
          setDismissedWinnerRound(jackpot.roundId);
          // Advance to next round — phase may have moved past 'settled' while modal was open
          if (jackpot.phase === 'settled' || jackpot.phase === 'claimed') jackpot.nextRound();
        }}
        isWinner={!!publicKey && (winnerSnapshot?.address === walletAddress || jackpot.winner?.address === walletAddress)}
        claiming={jackpot.loading}
        onClaim={async () => {
          await handleAction(jackpot.claim, 'Claim');
        }}
        onClaimDegen={async () => jackpot.claimDegen()}
        degenSeed={winnerSnapshot?.degenSeed ?? null}
        winner={winnerSnapshot}
      />
    </div>
  );
}
