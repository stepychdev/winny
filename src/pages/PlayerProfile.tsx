import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Header } from '../components/Header';
import { PnLChart } from '../components/PnLChart';
import { SocialProfileCard } from '../components/social/SocialProfileCard';
import { SocialActivityCard } from '../components/social/SocialActivityCard';
import { usePlayerPnL } from '../hooks/usePlayerPnL';
import { useNavigation } from '../contexts/NavigationContext';
import { Zap, TrendingUp, DollarSign, ArrowLeft, ExternalLink } from 'lucide-react';
import { SOLSCAN_CLUSTER_QUERY, ENABLE_TAPESTRY_SOCIAL } from '../lib/constants';
import { followTapestryProfile, unfollowTapestryProfile } from '../lib/tapestry/api';
import { useTapestryProfile } from '../hooks/useTapestryProfile';

function avatarUrl(addr: string): string {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(addr)}`;
}

export function PlayerProfile() {
  const { playerProfileAddress, navigate } = useNavigation();
  const { publicKey } = useWallet();
  const address = playerProfileAddress || '';
  const myWallet = publicKey?.toBase58() || '';
  const { transactions, totalDeposited, totalWon, roundCount, winCount, loading } = usePlayerPnL(address);
  const { profile: tapestryProfile } = useTapestryProfile(ENABLE_TAPESTRY_SOCIAL ? address : null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const shortAddress = address.length > 10
    ? address.slice(0, 6) + '...' + address.slice(-4)
    : address;
  const winRate = roundCount > 0 ? Math.round((winCount / roundCount) * 100) : 0;
  const isOwnProfile = myWallet === address;

  const handleToggleFollow = async () => {
    if (!myWallet || !tapestryProfile?.profileId) return;
    setFollowLoading(true);
    const nextState = !isFollowing;
    setIsFollowing(nextState);
    try {
      if (nextState) {
        await followTapestryProfile(myWallet, { wallet: address, profileId: tapestryProfile.profileId });
      } else {
        await unfollowTapestryProfile(myWallet, { wallet: address, profileId: tapestryProfile.profileId });
      }
    } catch {
      setIsFollowing(!nextState);
    } finally {
      setFollowLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background dark:bg-[#0f1219]">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Back + Player Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('game')}
            className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-primary mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to game
          </button>

          {ENABLE_TAPESTRY_SOCIAL ? (
            <SocialProfileCard
              walletAddress={address}
              showFollow={!isOwnProfile && !!myWallet}
              isFollowing={isFollowing}
              onToggleFollow={handleToggleFollow}
              followLoading={followLoading}
            />
          ) : (
            <div className="pb-8 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden shadow-lg ring-2 ring-slate-200 dark:ring-slate-600">
                  <img
                    src={avatarUrl(address)}
                    alt={`Avatar ${shortAddress}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Player Profile</h1>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-slate-600 dark:text-slate-400 font-mono">{shortAddress}</p>
                    <a
                      href={`https://solscan.io/account/${address}${SOLSCAN_CLUSTER_QUERY}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {loading && (
          <p className="text-sm text-slate-400 animate-pulse mb-8">Loading player statistics...</p>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* PnL Chart */}
          <PnLChart transactions={transactions} />

          {/* Total Deposited */}
          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <DollarSign size={20} className="text-primary" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Total Deposited</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">${totalDeposited.toFixed(2)}</p>
          </div>

          {/* Total Won */}
          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <TrendingUp size={20} className="text-green-600" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Total Won</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">${totalWon.toFixed(2)}</p>
          </div>

          {/* Win Rate */}
          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Zap size={20} className="text-purple-600" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Win Rate</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{winRate}%</p>
          </div>

          {/* Rounds Played */}
          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Zap size={20} className="text-amber-600" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Rounds Played</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{roundCount}</p>
          </div>

          {/* Wins */}
          <div className="bento-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <TrendingUp size={20} className="text-emerald-600" />
              </div>
              <span className="text-slate-600 dark:text-slate-400 text-sm">Wins</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{winCount}</p>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bento-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">Recent Activity</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Round</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Type</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Amount</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 dark:text-slate-400 text-sm">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 20).map((tx, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="py-4 px-4 text-slate-600 dark:text-slate-400">#{tx.roundId}</td>
                    <td className="py-4 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        tx.type === 'win'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {tx.type === 'win' ? 'Win' : 'Deposit'}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-semibold text-slate-900 dark:text-white">
                      ${tx.amount.toFixed(2)}
                    </td>
                    <td className="py-4 px-4 text-slate-600 dark:text-slate-400">
                      {new Date(tx.timestamp * 1000).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-slate-500 dark:text-slate-400">
                      No activity found for this player
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Social Activity Section */}
        {ENABLE_TAPESTRY_SOCIAL && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              Social Activity
              <span className="text-[10px] font-bold text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 rounded-full">Tapestry</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <SocialActivityCard walletAddress={address || null} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
