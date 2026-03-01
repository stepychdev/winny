import React, { useCallback, useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Trophy, Zap, CheckCircle, Loader2, Gift, ExternalLink } from 'lucide-react';
import { Header } from '../components/Header';
import { SoarLeaderboard } from '../components/SoarLeaderboard';
import { ENABLE_SOAR_LEADERBOARD, TREASURY_USDC_ATA, SOLSCAN_CLUSTER_QUERY } from '../lib/constants';
import { ensureSoarPlayerInitialized, checkSoarPlayerStatus } from '../lib/soar';

export function Leaderboard() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [status, setStatus] = useState<'loading' | 'not-registered' | 'registered'>('loading');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check registration status when wallet connects
  useEffect(() => {
    if (!ENABLE_SOAR_LEADERBOARD || !connected || !publicKey) {
      setStatus('not-registered');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    checkSoarPlayerStatus(connection, publicKey)
      .then((s) => {
        if (cancelled) return;
        setStatus(s.initialized && s.registered ? 'registered' : 'not-registered');
      })
      .catch(() => {
        if (!cancelled) setStatus('not-registered');
      });
    return () => { cancelled = true; };
  }, [connected, publicKey, connection]);

  const handleRegister = useCallback(async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    setRegistering(true);
    setError(null);
    try {
      await ensureSoarPlayerInitialized(
        connection,
        publicKey,
        (tx) => sendTransaction(tx, connection)
      );
      setStatus('registered');
    } catch (err: any) {
      console.error('[SOAR] Registration failed:', err);
      setError(err?.message?.includes('User rejected') ? 'Transaction cancelled' : 'Registration failed — try again');
    } finally {
      setRegistering(false);
    }
  }, [publicKey, connection, sendTransaction, setVisible]);

  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-[#0f1219] text-slate-900 dark:text-slate-100">
      <Header />
      <main className="flex-grow px-3 py-4 sm:px-4 md:px-6 w-full max-w-3xl mx-auto space-y-4">
        {/* Opt-in banner */}
        {ENABLE_SOAR_LEADERBOARD && status !== 'registered' && (
          <div className="bento-card p-5 sm:p-6 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 border border-indigo-100 dark:border-indigo-800/40">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shadow-sm flex-shrink-0 mt-0.5">
                <Trophy className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">Join the Volume Leaderboard</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                  Compete with other players for the top spot! Your total deposit volume is tracked
                  on-chain via <span className="font-medium text-slate-700 dark:text-slate-300">SOAR Protocol</span>.
                  Registration requires a one-time Solana transaction fee (~0.003 SOL) to create your
                  player account on-chain.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleRegister}
                    disabled={registering || status === 'loading'}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {registering ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</>
                    ) : !connected ? (
                      <><Zap className="w-4 h-4" /> Connect Wallet</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Register for Leaderboard</>
                    )}
                  </button>
                  <span className="text-xs text-slate-500 dark:text-slate-400">~0.003 SOL one-time fee</span>
                </div>
                {error && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Registered confirmation */}
        {ENABLE_SOAR_LEADERBOARD && status === 'registered' && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40">
            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">
              You're registered — your volume is being tracked!
            </span>
          </div>
        )}

        <SoarLeaderboard />

        {/* Rewards info */}
        {ENABLE_SOAR_LEADERBOARD && (
          <div className="bento-card p-5 sm:p-6 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/15 dark:to-orange-900/15 border border-amber-200/60 dark:border-amber-800/40">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-sm flex-shrink-0 mt-0.5">
                <Gift className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">Leaderboard Rewards</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-2">
                  Top players on the volume leaderboard will receive periodic <span className="font-semibold text-amber-700 dark:text-amber-300">USDC airdrops</span> directly
                  from the protocol treasury. The higher your rank — the bigger your share.
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                  All rewards are distributed from the on-chain treasury — fully transparent and verifiable.
                </p>
                <a
                  href={`https://solscan.io/account/${TREASURY_USDC_ATA.toBase58()}${SOLSCAN_CLUSTER_QUERY}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Treasury on Solscan
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
