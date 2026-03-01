import { useState, useCallback } from 'react';
import { Header } from '../components/Header';
import { PROGRAM_ID as PROGRAM_ID_PK, SOLSCAN_CLUSTER_QUERY } from '../lib/constants';
import {
  Shield,
  ShieldCheck,
  ExternalLink,
  Copy,
  BarChart3,
  PieChart,
  Code,
  Cpu,
  CheckCircle,
  User,
  ArrowRight,
  Search,
  Check,
} from 'lucide-react';

const PROGRAM_ID = PROGRAM_ID_PK.toBase58();

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

/**
 * Reproduce the on-chain winning ticket derivation:
 *   bytes16 = randomness[0..16]  (little-endian u128)
 *   winning_ticket = (bytes16 % total_tickets) + 1
 */
function deriveWinningTicket(randomnessHex: string, totalTickets: string): { ticket: string; error: string | null } {
  try {
    const hex = randomnessHex.replace(/^0x/i, '').replace(/\s/g, '');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) return { ticket: '', error: 'Randomness must be exactly 64 hex characters (32 bytes)' };

    const totalBig = BigInt(totalTickets);
    if (totalBig <= 0n) return { ticket: '', error: 'Total tickets must be > 0' };

    // First 16 bytes as little-endian u128
    const first16Hex = hex.slice(0, 32); // 16 bytes = 32 hex chars
    const bytes = [];
    for (let i = 0; i < 32; i += 2) {
      bytes.push(parseInt(first16Hex.slice(i, i + 2), 16));
    }
    // Little-endian: byte[0] is LSB
    let r = 0n;
    for (let i = 0; i < 16; i++) {
      r |= BigInt(bytes[i]) << (8n * BigInt(i));
    }

    const ticket = (r % totalBig) + 1n;
    return { ticket: ticket.toString(), error: null };
  } catch {
    return { ticket: '', error: 'Invalid input' };
  }
}

export function Fairness() {
  const [vrfRandomness, setVrfRandomness] = useState('');
  const [vrfTotalTickets, setVrfTotalTickets] = useState('');
  const [vrfResult, setVrfResult] = useState<{ ticket: string; error: string | null } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleVerify = useCallback(() => {
    setVrfResult(deriveWinningTicket(vrfRandomness, vrfTotalTickets));
  }, [vrfRandomness, vrfTotalTickets]);

  const handleCopy = useCallback((text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-[#0f1219] text-slate-900 dark:text-slate-100">
      <Header />

      <main className="flex-grow px-4 sm:px-6 lg:px-8 py-10">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-10 text-center md:text-left">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">
              <ShieldCheck className="w-3.5 h-3.5" />
              VERIFIED ON-CHAIN
            </div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white sm:text-5xl mb-4">
              Provably Fair System
            </h1>
            <p className="max-w-2xl text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
              We use verifiable randomness on the Solana blockchain to ensure total transparency. Verify every single outcome yourself.
            </p>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* 1. How Randomness Works (col-span-2) */}
            <div className="group relative col-span-1 md:col-span-2 overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700 transition hover:shadow-md">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">How Randomness Works</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Powered by MagicBlock VRF</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-primary">
                  <Cpu className="w-5 h-5" />
                </div>
              </div>

              {/* Diagram */}
              <div className="relative flex flex-col md:flex-row items-center justify-between gap-4 md:gap-0 mt-6 px-4">
                {/* Step 1 */}
                <div className="flex flex-col items-center gap-3 z-10">
                  <div className="h-16 w-16 rounded-2xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 flex items-center justify-center shadow-sm">
                    <User className="w-8 h-8 text-slate-400" />
                  </div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">User Bet</span>
                </div>

                {/* Connector 1 */}
                <div className="hidden md:flex flex-1 h-[2px] bg-slate-100 dark:bg-slate-600 relative mx-4">
                  <div className="absolute inset-0 bg-primary/20 w-1/2 animate-pulse" />
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 bg-white dark:bg-slate-800 text-[10px] font-mono text-slate-400">Request</div>
                </div>
                <div className="md:hidden h-8 w-[2px] bg-slate-100 dark:bg-slate-600" />

                {/* Step 2: VRF */}
                <div className="flex flex-col items-center gap-3 z-10">
                  <div className="h-20 w-20 rounded-2xl bg-primary/5 dark:bg-primary/10 border border-primary/20 flex items-center justify-center shadow-sm relative">
                    <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-ping" />
                    <Cpu className="w-10 h-10 text-primary relative z-10" />
                  </div>
                  <span className="text-xs font-semibold text-primary uppercase tracking-wider">MagicBlock VRF</span>
                </div>

                {/* Connector 2 */}
                <div className="hidden md:flex flex-1 h-[2px] bg-slate-100 dark:bg-slate-600 relative mx-4">
                  <div className="absolute inset-0 bg-primary/20 w-full animate-pulse" />
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 bg-white dark:bg-slate-800 text-[10px] font-mono text-slate-400">Callback</div>
                </div>
                <div className="md:hidden h-8 w-[2px] bg-slate-100 dark:bg-slate-600" />

                {/* Step 3: Result */}
                <div className="flex flex-col items-center gap-3 z-10">
                  <div className="h-16 w-16 rounded-2xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 flex items-center justify-center shadow-sm">
                    <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Result</span>
                </div>
              </div>
            </div>

            {/* 2. VRF Hash Verification Tool */}
            <div className="group relative col-span-1 overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700 transition hover:shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Verify VRF Result</h3>
                <Search className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Paste VRF randomness (hex) and total tickets from any round to independently verify the winning ticket.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                    VRF Randomness (64 hex chars)
                  </label>
                  <input
                    type="text"
                    value={vrfRandomness}
                    onChange={(e) => setVrfRandomness(e.target.value)}
                    placeholder="e.g. a1b2c3d4..."
                    className="w-full rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                    Total Tickets
                  </label>
                  <input
                    type="text"
                    value={vrfTotalTickets}
                    onChange={(e) => setVrfTotalTickets(e.target.value)}
                    placeholder="e.g. 50000000"
                    className="w-full rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <button
                  onClick={handleVerify}
                  disabled={!vrfRandomness || !vrfTotalTickets}
                  className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-bold transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Verify Winning Ticket
                </button>
                {vrfResult && (
                  <div className={`rounded-lg p-3 border text-xs font-mono ${
                    vrfResult.error
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
                      : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                  }`}>
                    {vrfResult.error ? (
                      <span>{vrfResult.error}</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 dark:text-slate-400">Winning Ticket:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-primary text-sm">{vrfResult.ticket}</span>
                            <button onClick={() => handleCopy(vrfResult.ticket, 'ticket')} className="text-slate-400 hover:text-primary transition-colors">
                              {copiedField === 'ticket' ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
                          Formula: u128_le(randomness[0..16]) % total_tickets + 1
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
                Copy VRF data from any round detail page and verify here.
              </p>
            </div>

            {/* 3. RTP & Fees */}
            <div className="group relative col-span-1 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700 transition hover:shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">RTP & Fees</h3>
                <PieChart className="w-5 h-5 text-slate-400" />
              </div>
              <div className="flex items-center justify-center my-6">
                <div className="relative h-32 w-32 rounded-full border-[12px] border-primary flex items-center justify-center">
                  <div className="text-center">
                    <span className="block text-2xl font-bold text-slate-900 dark:text-white">99.75%</span>
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Payout</span>
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center text-sm border-t border-slate-100 dark:border-slate-700 pt-4">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  <span className="text-slate-600 dark:text-slate-400">Player Return</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-200 dark:bg-slate-600" />
                  <span className="text-slate-600 dark:text-slate-400">0.25% Fee</span>
                </div>
              </div>
            </div>

            {/* 4. Smart Contract */}
            <div className="group relative col-span-1 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700 transition hover:shadow-md">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Smart Contract</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Publicly verified source</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Code className="w-5 h-5" />
                </div>
              </div>
              <div className="relative mt-2 rounded-lg bg-slate-50 dark:bg-slate-900 p-3 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <code className="text-xs text-slate-600 dark:text-slate-300 font-mono truncate mr-2">{PROGRAM_ID.slice(0, 8)}...{PROGRAM_ID.slice(-8)}</code>
                <button
                  onClick={() => copyToClipboard(PROGRAM_ID)}
                  className="text-slate-400 hover:text-primary transition-colors"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <a
                href={`https://solscan.io/account/${PROGRAM_ID}${SOLSCAN_CLUSTER_QUERY}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex items-center justify-between w-full rounded-lg bg-slate-50 dark:bg-slate-700 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition"
              >
                <span>View on Solscan</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            {/* 5. Win Chances */}
            <div className="group relative col-span-1 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm ring-1 ring-slate-900/5 dark:ring-slate-700 transition hover:shadow-md">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Win Chances</h3>
                <BarChart3 className="w-5 h-5 text-slate-400" />
              </div>
              <div className="flex items-end justify-between h-32 gap-2 px-2">
                {[
                  { h: 52, label: '$10', highlight: false },
                  { h: 32, label: '$5', highlight: false },
                  { h: 102, label: '$50', highlight: true },
                  { h: 38, label: '$15', highlight: false },
                ].map((bar, i) => (
                  <div key={i} className="w-full flex flex-col items-center justify-end h-full gap-1">
                    <div
                      className={`w-full rounded-t-md relative transition-colors ${
                        bar.highlight
                          ? 'bg-blue-500/30 dark:bg-blue-500/40 hover:bg-blue-500/40 dark:hover:bg-blue-500/50'
                          : 'bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500'
                      }`}
                      style={{ height: `${bar.h}px` }}
                    >
                      {bar.highlight && (
                        <div className="bg-primary absolute inset-x-0 bottom-0 top-1/2 rounded-t-md opacity-30" />
                      )}
                    </div>
                    <span className={`text-[10px] font-bold ${bar.highlight ? 'text-primary' : 'text-slate-400'}`}>
                      {bar.label}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-3">Proportional Distribution</p>
            </div>

            {/* 6. Audited & Secure */}
            <div className="group relative col-span-1 rounded-2xl bg-gradient-to-br from-green-50 to-white dark:from-green-900/20 dark:to-slate-800 p-6 shadow-sm ring-1 ring-green-100 dark:ring-green-900/30 transition hover:shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Audited & Secure</h3>
                <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex flex-col items-center justify-center py-4">
                <div className="relative h-20 w-20 flex items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full text-green-200 dark:text-green-900/40" fill="currentColor" viewBox="0 0 100 100">
                    <path d="M50 0L93.3013 25V75L50 100L6.69873 75V25L50 0Z" />
                  </svg>
                  <Shield className="w-10 h-10 text-green-600 dark:text-green-400 relative z-10" />
                </div>
                <div className="mt-4 text-center">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">On-Chain Verified</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Immutable program on Solana</p>
                </div>
              </div>
              <div className="mt-2 text-center">
                <a
                  href={`https://solscan.io/account/${PROGRAM_ID}${SOLSCAN_CLUSTER_QUERY}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                >
                  View Program on Solscan &rarr;
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
