import { useEffect, useState, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { AnchorProvider } from '@coral-xyz/anchor';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { Header } from '../components/Header';
import { Card } from '../components/ui/Card';
import { useNavigation } from '../contexts/NavigationContext';
import {
  USDC_DECIMALS,
  RoundStatus,
  DegenModeStatus,
  FEE_BPS,
  USDC_MINT,
  TICKET_UNIT,
  SOLSCAN_CLUSTER_QUERY,
} from '../lib/constants';
import {
  fetchConfig,
  fetchRound,
  getRoundPda,
  getParticipantPda,
  buildClaim,
  buildRequestDegenVrf,
  fetchDegenClaim,
  type RoundData,
  getProgram,
} from '../lib/program';
import { fetchRoundFromFirebase, saveRoundToFirebase } from '../lib/roundArchive';
import { toHistoryRoundWithDeposits } from '../hooks/useRoundHistory';
import type { HistoryRound } from '../hooks/useRoundHistory';
import { fetchDegenTokenMeta } from '../lib/degenClaim';
import { PARTICIPANT_COLORS } from '../mocks';
import { formatTs } from '../lib/timeUtils';
import {
  ArrowLeft,
  Trophy,
  Users,
  DollarSign,
  Hash,
  Shield,
  ExternalLink,
  Loader2,
  XCircle,
  Copy,
  Check,
} from 'lucide-react';

const STATUS_LABELS: Record<number, { text: string; color: string; bg: string }> = {
  [RoundStatus.Open]: { text: 'Open', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/30' },
  [RoundStatus.Locked]: { text: 'Locked', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/30' },
  [RoundStatus.VrfRequested]: { text: 'VRF Requested', color: 'text-sky-600', bg: 'bg-sky-50 dark:bg-sky-900/30' },
  [RoundStatus.Settled]: { text: 'Settled', color: 'text-primary', bg: 'bg-primary/5' },
  [RoundStatus.Claimed]: { text: 'Claimed', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
  [RoundStatus.Cancelled]: { text: 'Cancelled', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/30' },
};

interface ParticipantDetail {
  address: string;
  tickets: number;
  usdcAmount: number;
  isWinner: boolean;
  color: string;
  pct: number;
}

// formatTs imported from ../lib/timeUtils

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-medium text-slate-800 dark:text-slate-200 break-all">{value}</span>
        <button onClick={copy} className="flex-shrink-0 text-slate-400 hover:text-primary transition-colors">
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

export default function RoundDetail() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { navigate, roundDetailId, navigateToPlayer } = useNavigation();
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  const [archivedRound, setArchivedRound] = useState<HistoryRound | null>(null);
  const [participants, setParticipants] = useState<ParticipantDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingMode, setClaimingMode] = useState<'usdc' | 'degen' | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const program = useMemo(() => {
    const kp = Keypair.generate();
    const provider = new AnchorProvider(
      connection,
      { publicKey: kp.publicKey, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
      { commitment: 'confirmed' },
    );
    return getProgram(provider);
  }, [connection]);

  useEffect(() => {
    if (!roundDetailId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchRound(connection, roundDetailId);
        if (cancelled) return;
        if (!data) {
          // Round closed on-chain — try Firebase archive
          const archived = await fetchRoundFromFirebase(roundDetailId);
          if (cancelled) return;
          if (!archived) {
            setError('Round not found');
            setLoading(false);
            return;
          }
          setArchivedRound(archived);
          setRoundData(null);

          // Build participants from archived data — use per-participant deposits if available
          const archParts: ParticipantDetail[] = [];
          const archWinner = archived.winner;
          const archTotal = archived.totalUsdc;
          const deposits = archived.participantDeposits || [];
          for (let i = 0; i < (archived.participants?.length || 0); i++) {
            const addrStr = archived.participants[i];
            // Try to find saved deposit data for this participant
            const dep = deposits.find(d => d.address === addrStr);
            const usdcAmt = dep ? dep.usdc : archTotal / (archived.participantsCount || 1);
            const tickets = dep ? dep.tickets : Math.floor(archived.totalTickets / (archived.participantsCount || 1));
            archParts.push({
              address: addrStr,
              tickets,
              usdcAmount: usdcAmt,
              isWinner: addrStr === archWinner && archived.status >= RoundStatus.Settled,
              color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
              pct: archTotal > 0 ? (usdcAmt / archTotal) * 100 : 0,
            });
          }
          setParticipants(archParts);
          setLoading(false);
          return;
        }
        setArchivedRound(null);
        setRoundData(data);

        const roundPda = getRoundPda(roundDetailId);
        const winnerStr = data.winner.toBase58();
        const totalUsdc = Number(data.totalUsdc) / 10 ** USDC_DECIMALS;
        const parts: ParticipantDetail[] = [];

        for (let i = 0; i < data.participantsCount; i++) {
          const addr = data.participants[i];
          const addrStr = addr.toBase58();
          let tickets = 0;
          let usdcAmt = 0;

          try {
            const partPda = getParticipantPda(roundPda, addr);
            const pData = await (program.account as any).participant.fetch(partPda);
            tickets = Number(pData.ticketsTotal.toString());
            usdcAmt = Number(pData.usdcTotal.toString()) / 10 ** USDC_DECIMALS;
          } catch {
            usdcAmt = totalUsdc / data.participantsCount;
            tickets = Math.floor(usdcAmt * 1_000_000 / TICKET_UNIT);
          }

          parts.push({
            address: addrStr,
            tickets,
            usdcAmount: usdcAmt,
            isWinner: addrStr === winnerStr && data.status >= RoundStatus.Settled,
            color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
            pct: totalUsdc > 0 ? (usdcAmt / totalUsdc) * 100 : 0,
          });
        }

        if (!cancelled) {
          setParticipants(parts);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Failed to load round');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [connection, roundDetailId, program]);

  // ── Claim handler ──
  const isWinner = !!(
    roundData &&
    publicKey &&
    roundData.status === RoundStatus.Settled &&
    roundData.winner.toBase58() === publicKey.toBase58()
  );

  const handleClaim = async () => {
    if (!publicKey || !roundData || !roundDetailId) return;
    setClaimingMode('usdc');
    setClaimError(null);
    try {
      // Pre-check: verify round is still Settled (not already claimed)
      const freshRound = await fetchRound(connection, roundDetailId);
      if (freshRound && freshRound.status !== RoundStatus.Settled) {
        setRoundData(freshRound);
        throw new Error(freshRound.status === RoundStatus.Claimed ? 'Prize already claimed' : 'Round is not in a claimable state');
      }

      const vrfPayer = roundData.vrfPayer;
      const tx = new Transaction();

      // Create VRF payer's USDC ATA if needed
      if (vrfPayer && !vrfPayer.equals(PublicKey.default)) {
        const vrfPayerAta = await getAssociatedTokenAddress(USDC_MINT, vrfPayer);
        const ataInfo = await connection.getAccountInfo(vrfPayerAta);
        if (!ataInfo) {
          tx.add(
            createAssociatedTokenAccountIdempotentInstruction(
              publicKey, vrfPayerAta, vrfPayer, USDC_MINT
            )
          );
        }
      }

      const cfg = await fetchConfig(program);
      const ix = await buildClaim(
        program,
        publicKey,
        roundDetailId,
        USDC_MINT,
        cfg.treasuryUsdcAta,
        vrfPayer
      );
      tx.add(ix);
      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      setClaimTx(sig);

      // Re-fetch round to update status
      const fresh = await fetchRound(connection, roundDetailId);
      if (fresh) setRoundData(fresh);

      // Archive to Firebase (crank handles close_round)
      // Force status=Claimed because fetchRound may return stale pre-confirmation data.
      if (fresh) {
        try {
          const histRound = await toHistoryRoundWithDeposits(fresh, program, roundDetailId);
          await saveRoundToFirebase({ ...histRound, status: RoundStatus.Claimed, claimTx: sig });
        } catch (e) {
          console.warn("Firebase archive from RoundDetail failed:", e);
        }
      }
    } catch (e: any) {
      setClaimError(e.message?.slice(0, 80) || 'Claim failed');
    } finally {
      setClaimingMode(null);
    }
  };

  const handleClaimDegen = async () => {
    if (!publicKey || !roundData || !roundDetailId) return;
    setClaimingMode('degen');
    setClaimError(null);
    try {
      const freshRound = await fetchRound(connection, roundDetailId);
      if (freshRound && freshRound.status !== RoundStatus.Settled) {
        setRoundData(freshRound);
        throw new Error(freshRound.status === RoundStatus.Claimed ? 'Prize already claimed' : 'Round is not in a claimable state');
      }

      const current = await fetchDegenClaim(program, roundDetailId, publicKey);
      let requestSig = '';

      if (!current || current.status === 0 || current.status === DegenModeStatus.None) {
        const reqTx = new Transaction();
        const reqIx = await buildRequestDegenVrf(program, publicKey, roundDetailId);
        reqTx.add(reqIx);
        requestSig = await sendTransaction(reqTx, connection, { skipPreflight: true });
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const degen = await fetchDegenClaim(program, roundDetailId, publicKey);
      if (!degen) throw new Error('Degen claim state is not available yet');

      if (degen.status === DegenModeStatus.ClaimedFallback) {
        setClaimTx(requestSig || 'DEGEN_FALLBACK_DONE');
      } else if (degen.status === DegenModeStatus.ClaimedSwapped) {
        const tokenMint = degen.tokenMint.equals(PublicKey.default) ? null : degen.tokenMint.toBase58();
        const tokenSymbol = tokenMint ? (await fetchDegenTokenMeta(tokenMint)).symbol : 'token';
        setClaimTx(requestSig || `DEGEN_${tokenSymbol || 'TOKEN'}`);
      } else if (
        degen.status === DegenModeStatus.VrfRequested ||
        degen.status === DegenModeStatus.VrfReady ||
        degen.status === DegenModeStatus.Executing
      ) {
        const waitMsg = requestSig
          ? `DEGEN request sent: ${requestSig}`
          : 'DEGEN request already pending';
        setClaimTx(waitMsg);
      } else {
        throw new Error('Unexpected degen claim state');
      }

      const updated = await fetchRound(connection, roundDetailId);
      if (updated) setRoundData(updated);
    } catch (e: any) {
      setClaimError(e.message?.slice(0, 80) || 'Degen claim failed');
    } finally {
      setClaimingMode(null);
    }
  };

  if (!roundDetailId) return null;

  // Unified display values from either on-chain or archived data
  const displayData = roundData || archivedRound;
  const totalUsdc = roundData
    ? Number(roundData.totalUsdc) / 10 ** USDC_DECIMALS
    : archivedRound
      ? archivedRound.totalUsdc
      : 0;
  const fee = totalUsdc * FEE_BPS / 10000;
  const payout = totalUsdc - fee;
  const displayStatus = roundData ? roundData.status : archivedRound ? archivedRound.status : -1;
  const st = displayData ? (STATUS_LABELS[displayStatus] || { text: '?', color: 'text-slate-400', bg: 'bg-slate-50' }) : null;
  const roundPda = getRoundPda(roundDetailId);
  const explorerUrl = `https://solscan.io/account/${roundPda.toBase58()}${SOLSCAN_CLUSTER_QUERY}`;
  const winnerStr = roundData
    ? roundData.winner.toBase58()
    : archivedRound
      ? archivedRound.winner
      : '';
  const displayStartTs = roundData ? Number(roundData.startTs) : archivedRound ? archivedRound.startTs : 0;
  const displayEndTs = roundData ? Number(roundData.endTs) : archivedRound ? archivedRound.endTs : 0;
  const displayParticipantsCount = roundData ? roundData.participantsCount : archivedRound ? archivedRound.participantsCount : 0;
  const isArchived = !roundData && !!archivedRound;

  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-[#0f1219] text-slate-900 dark:text-slate-100">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-6">
        {/* Back button */}
        <button
          onClick={() => navigate('history')}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to History
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary mr-3" />
            <span className="text-slate-400">Loading round #{roundDetailId}...</span>
          </div>
        ) : error ? (
          <Card className="p-8 text-center">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-slate-500">{error}</p>
          </Card>
        ) : displayData ? (
          <>
            {/* Header card */}
            <Card className="p-5 mb-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                    <Hash className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                      Round #{roundDetailId}
                    </h1>
                    <div className="flex items-center gap-3 mt-1">
                      {st && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.color} ${st.bg}`}>
                          {st.text}
                        </span>
                      )}
                      {isArchived && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-slate-500 bg-slate-100 dark:bg-slate-800">
                          Archived
                        </span>
                      )}
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatTs(displayEndTs || displayStartTs)}</span>
                    </div>
                  </div>
                </div>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  View on Solscan <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Left: Round stats */}
              <Card className="p-5 space-y-4">
                <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="w-4 h-4" /> Round Info
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Total Pot</div>
                    <div className="text-2xl font-mono font-bold text-emerald-600">${totalUsdc.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Winner Payout</div>
                    <div className="text-2xl font-mono font-bold text-primary">${payout.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Fee ({FEE_BPS / 100}%)</div>
                    <div className="text-sm font-mono font-medium text-slate-800 dark:text-slate-200">${fee.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Players</div>
                    <div className="text-sm font-mono font-medium text-slate-800 dark:text-slate-200">{displayParticipantsCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Started</div>
                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200">{formatTs(displayStartTs)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Ended</div>
                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200">{formatTs(displayEndTs)}</div>
                  </div>
                </div>

                {/* Winner highlight */}
                {displayStatus >= RoundStatus.Settled && winnerStr && winnerStr !== PublicKey.default.toBase58() && (
                  <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-2 mb-1">
                      <Trophy className="w-4 h-4 text-amber-500" />
                      <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Winner</span>
                    </div>
                    <button
                      onClick={() => navigateToPlayer(winnerStr)}
                      className="text-sm font-mono font-medium text-slate-900 dark:text-white break-all hover:underline cursor-pointer text-left"
                    >
                      {winnerStr}
                    </button>
                  </div>
                )}

                {/* Claim Prize Card — Stitch-inspired */}
                {isWinner && !claimTx && (
                  <div className="mt-4 p-5 rounded-2xl bg-gradient-to-br from-amber-50/80 via-white to-primary/5 dark:from-amber-900/20 dark:via-slate-900 dark:to-primary/10 border-[2px] border-amber-400/40 dark:border-amber-600/30">
                    <div className="flex flex-col items-center text-center">
                      <div className="mb-3 relative">
                        <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full scale-150" />
                        <div className="relative bg-amber-100 dark:bg-amber-900/30 p-3 rounded-full">
                          <Trophy className="w-8 h-8 text-amber-500" />
                        </div>
                      </div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">Congratulations!</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">You are the winner! Claim your prize.</p>
                      <button
                        onClick={handleClaim}
                        disabled={claimingMode !== null}
                        className="group relative w-full h-14 bg-gradient-to-r from-primary to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold text-base rounded-full overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-primary/25 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                      >
                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="relative flex items-center justify-center gap-3">
                          {claimingMode === 'usdc' ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              <span className="tracking-wide">CLAIMING...</span>
                            </>
                          ) : (
                            <>
                              <Trophy className="w-5 h-5 text-amber-300" />
                              <span className="tracking-wide">CLAIM ${payout.toFixed(2)} USDC</span>
                            </>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={handleClaimDegen}
                        disabled={claimingMode !== null}
                        className="group relative mt-2 w-full h-12 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold text-sm rounded-full overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-violet-500/25 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                      >
                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="relative flex items-center justify-center gap-3">
                          {claimingMode === 'degen' ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span className="tracking-wide">DEGEN CLAIM...</span>
                            </>
                          ) : (
                            <>
                              <Trophy className="w-4 h-4 text-fuchsia-200" />
                              <span className="tracking-wide">CLAIM DEGEN</span>
                            </>
                          )}
                        </div>
                      </button>
                      {claimingMode !== null && (
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 animate-pulse">
                          Processing transaction on Solana...
                        </p>
                      )}
                      {claimError && (
                        <p className="mt-2 text-xs text-red-500 dark:text-red-400">{claimError}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Claim success */}
                {claimTx && (
                  <div className="mt-4 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Prize Claimed</span>
                    </div>
                    <p className="text-sm font-mono font-medium text-slate-600 dark:text-slate-300 break-all">{claimTx}</p>
                    <a
                      href={`https://solscan.io/tx/${claimTx}${SOLSCAN_CLUSTER_QUERY}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
                    >
                      View on Solscan <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </Card>

              {/* Right: Participants */}
              <Card className="p-5">
                <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-4">
                  <Users className="w-4 h-4" /> Participants
                </h2>
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                  {participants.map((p) => (
                    <button
                      key={p.address}
                      onClick={() => navigateToPlayer(p.address)}
                      className={`flex items-center gap-3 p-2.5 rounded-xl border transition-colors w-full text-left cursor-pointer hover:ring-1 hover:ring-primary/30 ${p.isWinner
                        ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50'
                        }`}
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
                            {p.address.slice(0, 4)}...{p.address.slice(-4)}
                          </span>
                          {p.isWinner && (
                            <Trophy className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          )}
                        </div>
                        <div className="text-[10px] font-medium text-slate-700 dark:text-slate-300 font-mono truncate">
                          {p.address}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100">
                          ${p.usdcAmount.toFixed(2)}
                        </div>
                        <div className="text-[10px] font-medium text-slate-700 dark:text-slate-300">{p.pct.toFixed(1)}%</div>
                      </div>
                      <div className="w-10 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex-shrink-0">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(p.pct, 100)}%`, backgroundColor: p.color }}
                        />
                      </div>
                    </button>
                  ))}
                  {participants.length === 0 && (
                    <div className="text-center text-slate-400 py-8 text-sm">No participants</div>
                  )}
                </div>
              </Card>
            </div>

            {/* Provably Fair */}
            <Card className="p-5">
              <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4" /> Provably Fair
              </h2>
              <div className="space-y-3">
                <CopyField
                  label="VRF Randomness (32 bytes)"
                  value={roundData
                    ? (Buffer.from(roundData.randomness).toString('hex') || '0'.repeat(64))
                    : (archivedRound?.randomness || '0'.repeat(64))}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Winning Ticket</div>
                    <div className="text-sm font-mono font-medium text-primary">
                      {roundData
                        ? roundData.winningTicket.toString()
                        : archivedRound?.winningTicket?.toString() || '0'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">Total Tickets</div>
                    <div className="text-sm font-mono font-medium text-slate-800 dark:text-slate-200">
                      {roundData
                        ? roundData.totalTickets.toString()
                        : archivedRound?.totalTickets?.toString() || '0'}
                    </div>
                  </div>
                </div>
                <CopyField label="Round PDA" value={roundPda.toBase58()} />
                <CopyField
                  label="Vault ATA"
                  value={roundData
                    ? roundData.vaultUsdcAta.toBase58()
                    : archivedRound?.vaultUsdcAta || '—'}
                />
              </div>
            </Card>
          </>
        ) : null}
      </main>
    </div>
  );
}
