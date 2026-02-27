import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useJackpot } from '../hooks/useJackpot';
import { useUserPnL } from '../hooks/useUserPnL';
import { Header } from '../components/Header';
import { PnLChart } from '../components/PnLChart';
import { SocialProfileCard } from '../components/social/SocialProfileCard';
import { SocialActivityCard } from '../components/social/SocialActivityCard';
import { Zap, TrendingUp, DollarSign, Award, AlertCircle } from 'lucide-react';
import { ENABLE_TAPESTRY_SOCIAL } from '../lib/constants';
import { importOrCreateTapestryProfile } from '../lib/tapestry/api';

export function Cabinet() {
  const { publicKey } = useWallet();
  const { roundId, participants, unclaimedPrizes, claimUnclaimed } = useJackpot();
  const { transactions, totalDeposited, totalWon, roundCount, winCount } = useUserPnL();
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleClaim = async () => {
    if (claiming || !unclaimedPrizes || unclaimedPrizes.length === 0) return;
    setClaiming(true);
    try {
      // Claim each unclaimed prize
      for (const prize of unclaimedPrizes) {
        await claimUnclaimed(prize.roundId);
      }
      setClaimStatus('success');
      setTimeout(() => setClaimStatus('idle'), 3000);
    } catch (e) {
      console.error('Claim failed:', e);
      setClaimStatus('error');
      setTimeout(() => setClaimStatus('idle'), 3000);
    } finally {
      setClaiming(false);
    }
  };

  const walletAddress = publicKey?.toBase58() || '';
  const shortAddress = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);

  // Soft social bootstrap: ensure Tapestry profile exists when visiting Cabinet.
  useEffect(() => {
    if (!ENABLE_TAPESTRY_SOCIAL || !walletAddress) return;
    void importOrCreateTapestryProfile(walletAddress);
  }, [walletAddress]);

  const winRate = roundCount > 0 ? Math.round((winCount / roundCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-background dark:bg-[#0f1219]">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* User Header — Tapestry Profile or fallback */}
        <div className="mb-8">
          {ENABLE_TAPESTRY_SOCIAL ? (
            <SocialProfileCard walletAddress={walletAddress} />
          ) : (
            <div className="mb-8 pb-8 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary via-accent to-primary flex items-center justify-center shadow-lg">
                  <span className="text-white font-bold text-3xl">{walletAddress.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white">My Portfolio</h1>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">{shortAddress}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          
          {/* PnL Chart */}
          <PnLChart
            transactions={transactions}
          />

          {/* Unclaimed Wins */}
          <div className="bento-card p-6 bg-amber-50 dark:bg-amber-950/20 border border-accent/30">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <Award size={20} className="text-accent" />
              Unclaimed Wins
            </h2>
            <p className="text-3xl font-bold text-accent mb-4">
              ${unclaimedPrizes?.reduce((sum, prize) => sum + prize.payout, 0).toFixed(2) || '0.00'}
            </p>
            <button
              onClick={handleClaim}
              disabled={claiming || (unclaimedPrizes?.length || 0) === 0}
              className={`w-full px-4 py-3 rounded-lg font-medium transition ${
                claiming
                  ? 'bg-accent/50 text-white cursor-wait'
                  : (unclaimedPrizes?.length || 0) === 0
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                  : 'bg-accent text-white hover:opacity-90'
              }`}
            >
              {claiming ? 'Claiming...' : 'Claim Now'}
            </button>
            {claimStatus === 'success' && (
              <p className="mt-2 text-sm text-green-600 flex items-center gap-1">
                <AlertCircle size={14} /> Successfully claimed!
              </p>
            )}
            {claimStatus === 'error' && (
              <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                <AlertCircle size={14} /> Claim failed
              </p>
            )}
          </div>

          {/* Statistics Cards */}
          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <DollarSign size={20} className="text-primary" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Total Deposited</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">${totalDeposited.toFixed(2)}</p>
          </div>

          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <TrendingUp size={20} className="text-green-600" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Total Won</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">${totalWon.toFixed(2)}</p>
          </div>

          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Zap size={20} className="text-purple-600" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Win Rate</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{winRate}%</p>
          </div>
        </div>

        {/* Active Rounds */}
        <div className="grid grid-cols-1 gap-6 mb-8">
          <div className="bento-card p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Active Rounds</h2>
            <div className="space-y-3">
              {participants?.slice(0, 3).map((participant: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-700">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">Round {roundId - 2 + idx}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Bet: ${participant.usdcDeposited || '0'}</p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-primary">
                    Waiting
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bento-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">Recent Activity</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Type</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Amount</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Date</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Status</th>
                </tr>
              </thead>
              <tbody>
                {unclaimedPrizes?.slice(0, 5).map((prize, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">Win</td>
                    <td className="py-4 px-4 text-slate-900 dark:text-white font-semibold">${prize.payout.toFixed(2)}</td>
                    <td className="py-4 px-4 text-slate-600 dark:text-slate-400">
                      {new Date(prize.timestamp * 1000).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                        Unclaimed
                      </span>
                    </td>
                  </tr>
                ))}
                {unclaimedPrizes?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-slate-500 dark:text-slate-400">
                      No activity yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Social Section */}
        {ENABLE_TAPESTRY_SOCIAL && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              Social
              <span className="text-[10px] font-bold text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 rounded-full">Tapestry</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <SocialActivityCard walletAddress={walletAddress || null} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
