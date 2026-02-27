import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { Header } from '../components/Header';
import { useRoundHistory } from '../hooks/useRoundHistory';
import { useNavigation } from '../contexts/NavigationContext';
import { PROGRAM_ID, RoundStatus, SOLSCAN_CLUSTER_QUERY } from '../lib/constants';
import {
  Users,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Clock,
  BarChart3,
  Search,
  RefreshCw,
  Target,
  Trophy,
  ExternalLink,
  CheckCircle2,
  CircleDot,
} from 'lucide-react';
import { getRoundPda } from '../lib/program';
import { shortenAddr } from '../lib/addressUtils';
import { timeAgo } from '../lib/timeUtils';

type Filter = 'all' | 'won' | 'lost' | 'active';

const STATUS_MAP: Record<number, { text: string; bg: string; textColor: string; ring: string }> = {
  [RoundStatus.Open]:         { text: 'Active',    bg: 'bg-blue-50 dark:bg-blue-900/30', textColor: 'text-blue-700 dark:text-blue-400', ring: 'ring-blue-700/10' },
  [RoundStatus.Locked]:       { text: 'Locked',    bg: 'bg-amber-50 dark:bg-amber-900/30', textColor: 'text-amber-700 dark:text-amber-400', ring: 'ring-amber-600/20' },
  [RoundStatus.VrfRequested]: { text: 'Drawing',   bg: 'bg-sky-50 dark:bg-sky-900/30', textColor: 'text-sky-700 dark:text-sky-400', ring: 'ring-sky-600/20' },
  [RoundStatus.Settled]:      { text: 'Unclaimed', bg: 'bg-orange-50 dark:bg-orange-900/30', textColor: 'text-orange-700 dark:text-orange-400', ring: 'ring-orange-600/20' },
  [RoundStatus.Claimed]:      { text: 'Claimed',   bg: 'bg-green-50 dark:bg-green-900/30', textColor: 'text-green-700 dark:text-green-400', ring: 'ring-green-600/20' },
  [RoundStatus.Cancelled]:    { text: 'Cancelled', bg: 'bg-slate-50 dark:bg-slate-800', textColor: 'text-slate-600 dark:text-slate-400', ring: 'ring-slate-500/10' },
};

export default function History() {
  const { connection } = useConnection();
  const { rounds, loading, page, totalPages, goToPage, refresh } = useRoundHistory();
  const { navigateToRound } = useNavigation();
  const [filter, setFilter] = useState<Filter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [resolvedClaimTx, setResolvedClaimTx] = useState<Record<number, string>>({});
  const [unresolvedClaimRounds, setUnresolvedClaimRounds] = useState<Record<number, true>>({});

  const buildTxUrl = (signature: string) => `https://solscan.io/tx/${signature}${SOLSCAN_CLUSTER_QUERY}`;

  const isActive = (s: number) => s === RoundStatus.Open || s === RoundStatus.Locked || s === RoundStatus.VrfRequested;

  useEffect(() => {
    let disposed = false;
    const claimedWithoutTx = rounds
      .filter(
        (r) =>
          r.status === RoundStatus.Claimed &&
          !r.claimTx &&
          !resolvedClaimTx[r.roundId] &&
          !unresolvedClaimRounds[r.roundId]
      )
      .map((r) => r.roundId);

    if (claimedWithoutTx.length === 0) return;

    const resolveClaimTx = async () => {
      const found: Record<number, string> = {};
      const missed: number[] = [];

      for (const roundId of claimedWithoutTx) {
        try {
          const signatures = await connection.getSignaturesForAddress(
            getRoundPda(roundId),
            { limit: 25 },
            'confirmed'
          );

          let claimSig: string | null = null;
          for (const sigInfo of signatures) {
            const parsed = await connection.getParsedTransaction(sigInfo.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            });

            if (!parsed?.meta?.logMessages) continue;
            const logs = parsed.meta.logMessages;
            const hasProgramInvoke = logs.some((line) =>
              line.includes(`Program ${PROGRAM_ID.toBase58()} invoke`)
            );
            const hasClaimInstruction = logs.some((line) =>
              line.includes('Instruction: Claim')
            );
            if (hasProgramInvoke && hasClaimInstruction) {
              claimSig = sigInfo.signature;
              break;
            }
          }

          if (claimSig) found[roundId] = claimSig;
          else missed.push(roundId);
        } catch {
          missed.push(roundId);
        }
      }

      if (disposed) return;
      if (Object.keys(found).length > 0) {
        setResolvedClaimTx((prev) => ({ ...prev, ...found }));
      }
      if (missed.length > 0) {
        setUnresolvedClaimRounds((prev) => {
          const next = { ...prev };
          for (const roundId of missed) next[roundId] = true;
          return next;
        });
      }
    };

    resolveClaimTx();
    return () => {
      disposed = true;
    };
  }, [connection, rounds, resolvedClaimTx, unresolvedClaimRounds]);

  const filtered = rounds.filter((r) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!String(r.roundId).includes(q) && !r.winner.toLowerCase().includes(q)) return false;
    }
    if (filter === 'won') return r.status === RoundStatus.Claimed || r.status === RoundStatus.Settled;
    if (filter === 'lost') return r.status === RoundStatus.Cancelled;
    if (filter === 'active') return isActive(r.status);
    return true;
  });

  // Stats (computed from currently loaded rounds)
  const totalRounds = rounds.length;
  const avgPlayers = totalRounds > 0
    ? (rounds.reduce((sum, r) => sum + r.participantsCount, 0) / totalRounds).toFixed(1)
    : '0';

  // Generate page numbers for pagination
  const pageNumbers: number[] = [];
  if (totalPages > 0) {
    const maxButtons = 5;
    let start = Math.max(0, page - Math.floor(maxButtons / 2));
    const end = Math.min(totalPages - 1, start + maxButtons - 1);
    start = Math.max(0, end - maxButtons + 1);
    for (let i = start; i <= end; i++) {
      pageNumbers.push(i);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-[#0f1219] text-slate-900 dark:text-slate-100">
      <Header />
      <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          {/* Page Header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Round History</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Track performance and past games.</p>
            </div>
            <button
              onClick={refresh}
              disabled={loading}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 text-sm font-medium text-slate-600 dark:text-slate-300 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {/* Stat Cards */}
          <div className="mb-10 grid gap-6 md:grid-cols-2">
            <div className="group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700 transition-all hover:shadow-md">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-blue-50 dark:bg-blue-900/20 transition-transform group-hover:scale-110" />
              <div className="relative z-10">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/30 text-primary">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Loaded Rounds</p>
                  <h3 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{totalRounds.toLocaleString()}</h3>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700 transition-all hover:shadow-md">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-purple-50 dark:bg-purple-900/20 transition-transform group-hover:scale-110" />
              <div className="relative z-10">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  <Target className="w-5 h-5" />
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Avg Players / Round</p>
                  <h3 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{avgPlayers}</h3>
                </div>
              </div>
            </div>
          </div>

          {/* Filters + Search */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center rounded-lg bg-white dark:bg-slate-800 p-1 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
              {(['all', 'won', 'lost', 'active'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    filter === f
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {f === 'all' ? 'All Games' : f === 'won' ? 'Settled' : f === 'lost' ? 'Cancelled' : 'Active'}
                </button>
              ))}
            </div>
            <div className="relative max-w-xs w-full">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full rounded-lg border-0 bg-white dark:bg-slate-800 py-2 pl-10 pr-3 text-slate-900 dark:text-white shadow-sm ring-1 ring-inset ring-slate-200 dark:ring-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
                placeholder="Search Round ID or Wallet"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-2xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700">
            {loading && rounds.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-primary mr-3" />
                <span className="text-slate-400">Loading rounds...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Clock className="w-10 h-10 mb-3 opacity-50" />
                <p>{searchQuery ? 'No matching rounds' : 'No rounds yet'}</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-700">
                    <thead>
                      <tr className="bg-slate-50/50 dark:bg-slate-900/50">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Round #</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Pot</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Players</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Winner</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Claim</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                        <th className="relative px-6 py-4"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {filtered.map((r) => {
                        const st = STATUS_MAP[r.status] || { text: '?', bg: 'bg-slate-50', textColor: 'text-slate-400', ring: 'ring-slate-500/10' };
                        const active = isActive(r.status);
                        const claimTx = r.claimTx || resolvedClaimTx[r.roundId];
                        return (
                          <tr
                            key={r.roundId}
                            onClick={() => navigateToRound(r.roundId)}
                            className={`group hover:bg-slate-50/80 dark:hover:bg-slate-700/50 transition-colors cursor-pointer ${active ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}
                          >
                            <td className="whitespace-nowrap px-6 py-4">
                              <div className="flex items-center">
                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg font-bold text-xs mr-3 ${
                                  active ? 'bg-primary text-white' : r.status === RoundStatus.Claimed ? 'bg-blue-50 dark:bg-blue-900/30 text-primary' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                }`}>
                                  #
                                </div>
                                <span className="font-medium text-slate-900 dark:text-white">{r.roundId}</span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <span className={`font-semibold ${active ? 'text-primary' : 'text-slate-900 dark:text-white'}`}>
                                ${r.totalUsdc.toFixed(2)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <div className="flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-slate-400" />
                                <span className="text-sm text-slate-600 dark:text-slate-300">{r.participantsCount}</span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              {active ? (
                                <span className="text-xs text-slate-400 italic">In Progress...</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{shortenAddr(r.winner)}</span>
                                  {r.status === RoundStatus.Claimed && <Trophy className="w-3.5 h-3.5 text-amber-400" />}
                                </div>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${st.bg} ${st.textColor} ${st.ring}`}>
                                {active && (
                                  <span className="relative flex h-2 w-2 mr-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                                  </span>
                                )}
                                {r.status === RoundStatus.Claimed && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                {r.status === RoundStatus.Settled && <CircleDot className="w-3 h-3 mr-1" />}
                                {st.text}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              {r.status === RoundStatus.Claimed ? (
                                claimTx ? (
                                  <a
                                    href={buildTxUrl(claimTx)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 hover:underline"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    View TX
                                  </a>
                                ) : (
                                  <span className="text-xs text-slate-400">TX pending</span>
                                )
                              ) : r.status === RoundStatus.Settled ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigateToRound(r.roundId); }}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline"
                                >
                                  <Trophy className="w-3 h-3" />
                                  Claim
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                              {timeAgo(r.endTs || r.startTs)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right">
                              <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-primary transition-colors" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 px-4 py-3 sm:px-6">
                  <p className="text-sm text-slate-700 dark:text-slate-400">
                    Page <span className="font-medium">{page + 1}</span> of <span className="font-medium">{totalPages || 1}</span>
                    {' · '}<span className="font-medium">{filtered.length}</span> rounds loaded
                  </p>

                  <div className="flex items-center gap-1">
                    {/* Previous page */}
                    <button
                      onClick={() => goToPage(page - 1)}
                      disabled={page === 0 || loading}
                      className="inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    {/* Page numbers */}
                    {pageNumbers.map((p) => (
                      <button
                        key={p}
                        onClick={() => goToPage(p)}
                        disabled={loading}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                          p === page
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                        } disabled:opacity-50`}
                      >
                        {p + 1}
                      </button>
                    ))}

                    {/* Next page */}
                    <button
                      onClick={() => goToPage(page + 1)}
                      disabled={page >= totalPages - 1 || loading}
                      className="inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>

                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
