import { useState } from 'react';
import { Trophy, X, Loader2, Check } from 'lucide-react';
import type { UnclaimedPrize } from '../hooks/useJackpot';
import { pushNotification } from '../hooks/useNotifications';
import { fetchTokenLogoViaJupiter } from '../lib/tokenMetadata';

interface UnclaimedBadgeProps {
  prize: UnclaimedPrize;
  loading: boolean;
  onClaim: (roundId: number) => Promise<string>;
  onClaimDegen: (roundId: number) => Promise<{
    claimSig: string;
    tokenMint: string | null;
    tokenIndex: number | null;
    tokenSymbol: string | null;
    fallback: boolean;
  }>;
}

interface DegenResult {
  type: 'swapped' | 'fallback' | 'pending';
  tokenSymbol?: string;
  tokenMint?: string;
  tokenLogoUrl?: string;
}

export function UnclaimedBadge({ prize, loading, onClaim, onClaimDegen }: UnclaimedBadgeProps) {
  const [dismissed, setDismissed] = useState(false);
  const [claimingMode, setClaimingMode] = useState<"usdc" | "degen" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [degenResult, setDegenResult] = useState<DegenResult | null>(null);

  if (dismissed) return null;
  // Hide for USDC claims; degen claims show result card instead
  if (success && !degenResult) return null;

  const handleClaim = async () => {
    setClaimingMode("usdc");
    setError(null);
    try {
      await onClaim(prize.roundId);
      setSuccess(true);
    } catch (e: any) {
      setError(e.message?.slice(0, 50) || 'Claim failed');
    } finally {
      setClaimingMode(null);
    }
  };

  const handleClaimDegen = async () => {
    setClaimingMode("degen");
    setError(null);
    try {
      const result = await onClaimDegen(prize.roundId);
      setSuccess(true);

      if (result.fallback) {
        setDegenResult({ type: 'fallback' });
        pushNotification({
          type: 'win',
          title: `Round #${prize.roundId} — Degen Fallback`,
          detail: `$${prize.payout.toFixed(2)} USDC (no viable route)`,
        });
      } else if (result.tokenSymbol && result.tokenMint) {
        let logoUrl = '';
        try { logoUrl = await fetchTokenLogoViaJupiter(result.tokenMint); } catch {}
        setDegenResult({
          type: 'swapped',
          tokenSymbol: result.tokenSymbol,
          tokenMint: result.tokenMint,
          tokenLogoUrl: logoUrl || undefined,
        });
        pushNotification({
          type: 'win',
          title: `Round #${prize.roundId} — ${result.tokenSymbol}`,
          detail: `$${prize.payout.toFixed(2)} swapped to ${result.tokenSymbol}`,
        });
      } else {
        setDegenResult({ type: 'pending' });
        pushNotification({
          type: 'win',
          title: `Round #${prize.roundId} — Degen Pending`,
          detail: `$${prize.payout.toFixed(2)} — executor picking route…`,
        });
      }
    } catch (e: any) {
      setError(e.message?.slice(0, 50) || 'Degen claim failed');
    } finally {
      setClaimingMode(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    // Don't clear localStorage — badge will reappear on refresh
  };

  return (
    <div className="pointer-events-auto relative flex w-full flex-col animate-in fade-in slide-in-from-right duration-300">
      <div className={`flex items-center justify-between gap-4 rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-2xl border-l-[3px] ${degenResult ? 'border-purple-500' : 'border-amber-500 animate-pulse-gold'} ring-1 ring-black/5 dark:ring-white/5`}>

          {/* Degen result display */}
          {degenResult ? (
            <div className="flex items-center gap-3 min-w-0">
              {degenResult.type === 'swapped' ? (
                <>
                  {degenResult.tokenLogoUrl ? (
                    <img
                      src={degenResult.tokenLogoUrl}
                      alt={degenResult.tokenSymbol}
                      className="w-9 h-9 shrink-0 rounded-full ring-2 ring-purple-400/30 shadow-lg"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-white text-xs font-black shadow-lg">
                      {(degenResult.tokenSymbol || '?').slice(0, 2)}
                    </div>
                  )}
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                      <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">
                        {degenResult.tokenSymbol}
                      </p>
                    </div>
                    <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      ${prize.payout.toFixed(2)} → {degenResult.tokenSymbol}
                    </p>
                    {degenResult.tokenMint && (
                      <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">{degenResult.tokenMint}</p>
                    )}
                  </div>
                </>
              ) : degenResult.type === 'fallback' ? (
                <>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600">
                    <Check className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col">
                    <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 leading-tight">
                      USDC Fallback
                    </p>
                    <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      ${prize.payout.toFixed(2)} USDC (no viable route)
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                  <div className="flex flex-col">
                    <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 leading-tight">
                      Degen Pending
                    </p>
                    <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      Executor picking route…
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
          {/* Left Icon & Content */}
          <div className="flex items-center gap-3">
            {/* Trophy Icon */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600">
              <Trophy className="w-5 h-5" />
            </div>
            {/* Text Block */}
            <div className="flex flex-col">
              <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 leading-tight">
                You won Round #{prize.roundId}!
              </p>
              <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                ${prize.payout.toFixed(2)} USDC unclaimed
              </p>
            </div>
          </div>

          {/* Claim Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleClaim}
              disabled={claimingMode !== null || loading}
              className="flex h-9 min-w-[70px] cursor-pointer items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-white transition-all hover:bg-primary/90 hover:scale-105 active:scale-95 shadow-md shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {claimingMode === "usdc" ? <Loader2 className="w-4 h-4 animate-spin" /> : "USDC"}
            </button>
            <button
              onClick={handleClaimDegen}
              disabled={claimingMode !== null || loading}
              className="flex h-9 min-w-[70px] cursor-pointer items-center justify-center rounded-full bg-violet-600 px-4 text-sm font-bold text-white transition-all hover:bg-violet-500 hover:scale-105 active:scale-95 shadow-md shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {claimingMode === "degen" ? <Loader2 className="w-4 h-4 animate-spin" /> : "DEGEN"}
            </button>
          </div>
            </>
          )}

          {/* Close Button (circle, top-right) */}
          <button
            onClick={handleDismiss}
            className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shadow-sm border border-slate-100 dark:border-slate-700 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

      {/* Error message */}
      {error && (
        <p className="mt-1.5 px-2 text-right text-[11px] font-medium text-red-500 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
