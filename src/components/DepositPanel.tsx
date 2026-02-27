import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronDown, Loader2, ArrowRightLeft, Repeat2, Settings2, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import type { WalletToken } from '../hooks/useWalletTokens';
import { NETWORK, USDC_MINT as USDC_MINT_PK, TICKET_UNIT, MIN_DEPOSIT_USDC, MAX_MULTI_DEPOSIT_LEGS } from '../lib/constants';
import { getJupiterQuote, type JupiterQuote } from '../lib/jupiterClient';

const USDC_MINT = USDC_MINT_PK.toBase58();

// Known symbols for devnet mints where metadata may be missing
const KNOWN_SYMBOLS: Record<string, string> = {
  [USDC_MINT]: 'USDC',
};

function tokenSymbol(t: WalletToken): string {
  return KNOWN_SYMBOLS[t.mint] || t.symbol;
}

interface QuotePreview {
  outAmount: number;
  minReceived: number;
  tickets: number;
  priceImpact: string;
  route: string;
  inAmount: number;
  inputDecimals: number;
  quote: JupiterQuote;
}

interface DepositPanelProps {
  disabled: boolean;
  loading: boolean;
  usdcBalance: number;
  tokens: WalletToken[];
  tokensLoading: boolean;
  onDeposit: (amount: number, mint: string, quote?: JupiterQuote) => void;
  onDepositMany?: (legs: Array<{ amount: number; mint: string; quote?: JupiterQuote }>) => void;
  compact?: boolean;
}

const USDC_DECIMALS = 6;
const DEFAULT_SLIPPAGE_BPS = 100; // 1%
const SLIPPAGE_PRESETS = [0.5, 1, 2, 3];
const QUOTE_DEBOUNCE_MS = 500;

interface BatchLeg {
  amount: number; // token amount for selected mint; for USDC this is USDC amount
  mint: string;
  quote?: JupiterQuote;
  symbol: string;
  estimatedUsdc: number;
}

export function normalizeDecimalInput(value: string): string {
  return value.replace(/,/g, '.');
}

function floorToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
}

function formatQuickFillAmount(value: number, decimals: number): string {
  const floored = floorToDecimals(value, decimals);
  return floored.toFixed(decimals).replace(/\.?0+$/, '');
}

function formatDisplayedBalance(value: number, isUsdc: boolean): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: isUsdc ? 2 : 6,
  });
}

export function DepositPanel({ disabled, loading, usdcBalance, tokens, tokensLoading, onDeposit, onDepositMany, compact = false }: DepositPanelProps) {
  const [amount, setAmount] = useState<string>('');
  const [selectedMint, setSelectedMint] = useState<string>(USDC_MINT);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  // Quote preview state
  const [quotePreview, setQuotePreview] = useState<QuotePreview | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [inputMode, setInputMode] = useState<'token' | 'usdc'>('token'); // token=ExactIn, usdc=ExactOut
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [customSlippage, setCustomSlippage] = useState('');
  const [batchLegs, setBatchLegs] = useState<BatchLeg[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedToken = tokens.find((t) => t.mint === selectedMint);
  const isUsdc = selectedMint === USDC_MINT;
  const balance = selectedToken?.balance ?? (isUsdc ? usdcBalance : 0);
  const symbol = selectedToken ? tokenSymbol(selectedToken) : 'USDC';
  const tokenDecimals = selectedToken?.decimals ?? 9;

  const numAmount = parseFloat(normalizeDecimalInput(amount)) || 0;
  const batchEnabled = !!onDepositMany;

  // Reset inputMode when switching to USDC
  useEffect(() => {
    if (isUsdc) setInputMode('token');
  }, [isUsdc]);

  // Debounced quote fetch for non-USDC tokens
  const fetchQuote = useCallback(async (amt: number, mint: string, mode: 'token' | 'usdc', decimals: number) => {
    if (amt <= 0 || mint === USDC_MINT) {
      setQuotePreview(null);
      return;
    }
    setQuoteLoading(true);
    try {
      const swapMode = mode === 'token' ? 'ExactIn' as const : 'ExactOut' as const;
      const rawAmount = mode === 'token'
        ? Math.floor(amt * 10 ** decimals).toString()
        : Math.floor(amt * 10 ** USDC_DECIMALS).toString();

      const quote = await getJupiterQuote(mint, USDC_MINT, rawAmount, slippageBps, swapMode);

      const outUsdc = Number(quote.outAmount) / 10 ** USDC_DECIMALS;
      const minUsdc = Number(quote.otherAmountThreshold) / 10 ** USDC_DECIMALS;
      const inTokens = Number(quote.inAmount) / 10 ** decimals;
      const routeLabel = quote.routePlan.map(r => r.swapInfo.label).filter(Boolean).join(' → ') || 'Jupiter';

      setQuotePreview({
        outAmount: outUsdc,
        minReceived: minUsdc,
        tickets: Math.floor(outUsdc * 1_000_000 / TICKET_UNIT),
        priceImpact: quote.priceImpactPct,
        route: routeLabel,
        inAmount: inTokens,
        inputDecimals: decimals,
        quote,
      });
    } catch (e) {
      console.warn('[DepositPanel] Quote fetch failed:', e);
      setQuotePreview(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [slippageBps]);

  // Trigger debounced quote
  useEffect(() => {
    if (isUsdc || numAmount <= 0) {
      setQuotePreview(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchQuote(numAmount, selectedMint, inputMode, tokenDecimals);
    }, QUOTE_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [numAmount, selectedMint, inputMode, isUsdc, tokenDecimals, fetchQuote, slippageBps]);

  // Position the portal menu under the trigger button
  useEffect(() => {
    if (dropdownOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [dropdownOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const handleDeposit = () => {
    if (numAmount <= 0 || belowMinimum) return;
    if (inputMode === 'token' && numAmount > balance) return;
    if (inputMode === 'usdc' && quotePreview && quotePreview.inAmount > balance) return;
    onDeposit(numAmount, selectedMint, quotePreview?.quote);
    setAmount('');
    setQuotePreview(null);
  };

  const handleSelectToken = (mint: string) => {
    setSelectedMint(mint);
    setAmount('');
    setQuotePreview(null);
    setInputMode('token');
    setDropdownOpen(false);
  };

  const upsertBatchLeg = (nextLeg: BatchLeg) => {
    setBatchLegs((prev) => {
      const idx = prev.findIndex((l) => l.mint === nextLeg.mint);
      if (idx < 0) return [...prev, nextLeg];

      // Merge duplicate mint: keep latest quote and sum amounts / estimated USDC.
      const copy = [...prev];
      const current = copy[idx];
      copy[idx] = {
        ...current,
        amount: current.amount + nextLeg.amount,
        estimatedUsdc: current.estimatedUsdc + nextLeg.estimatedUsdc,
        quote: nextLeg.quote ?? current.quote,
      };
      return copy;
    });
  };

  const handleAddToBatch = () => {
    if (!batchEnabled) return;
    if (numAmount <= 0) return;
    if (inputMode === 'token' && numAmount > balance) return;
    if (inputMode === 'usdc' && quotePreview && quotePreview.inAmount > balance) return;

    if (!isUsdc && !quotePreview) return;

    const amountForLeg = isUsdc
      ? numAmount
      : (inputMode === 'usdc' ? (quotePreview?.inAmount ?? numAmount) : numAmount);

    const estimatedUsdc = isUsdc
      ? numAmount
      : (quotePreview?.outAmount ?? 0);

    const alreadyInBatch = batchLegs.some((l) => l.mint === selectedMint);
    if (!alreadyInBatch && batchLegs.length >= MAX_MULTI_DEPOSIT_LEGS) return;

    upsertBatchLeg({
      amount: amountForLeg,
      mint: selectedMint,
      quote: quotePreview?.quote,
      symbol,
      estimatedUsdc,
    });

    setAmount('');
    setQuotePreview(null);
    setInputMode('token');
  };

  const removeBatchLeg = (mint: string) => {
    setBatchLegs((prev) => prev.filter((l) => l.mint !== mint));
  };

  const editBatchLeg = (mint: string) => {
    const leg = batchLegs.find((l) => l.mint === mint);
    if (!leg) return;
    setSelectedMint(leg.mint);
    setAmount(String(leg.amount));
    setInputMode('token');
    setQuotePreview(null);
    removeBatchLeg(mint);
  };

  const handleDepositBatch = () => {
    if (!onDepositMany || batchLegs.length === 0) return;
    onDepositMany(
      batchLegs.map((leg) => ({
        amount: leg.amount,
        mint: leg.mint,
        quote: leg.quote,
      }))
    );
    setBatchLegs([]);
    setAmount('');
    setQuotePreview(null);
  };

  const toggleInputMode = () => {
    setInputMode(prev => prev === 'token' ? 'usdc' : 'token');
    setAmount('');
    setQuotePreview(null);
  };

  // Minimum deposit check ($1 USDC equivalent)
  const belowMinimum = numAmount > 0 && (
    isUsdc
      ? numAmount < MIN_DEPOSIT_USDC
      : (quotePreview ? quotePreview.outAmount < MIN_DEPOSIT_USDC : false)
  );

  const exceedsBalance =
    numAmount > 0 &&
    (isUsdc
      ? numAmount > balance
      : (
        inputMode === 'token'
          ? numAmount > balance
          : (quotePreview ? quotePreview.inAmount > balance : false)
      ));

  // Button disabled logic
  const depositDisabled = disabled || loading || numAmount <= 0 || belowMinimum || (
    isUsdc ? exceedsBalance : (
      inputMode === 'token' ? exceedsBalance : (
        quotePreview ? exceedsBalance : true
      )
    )
  );

  const balanceErrorText =
    exceedsBalance
      ? (
        inputMode === 'usdc' && quotePreview
          ? `Cost exceeds balance (need ${quotePreview.inAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}, max ${formatDisplayedBalance(balance, false)} ${symbol})`
          : `Amount exceeds balance (max ${formatDisplayedBalance(balance, isUsdc)} ${symbol})`
      )
      : null;

  const addToBatchDisabled =
    !batchEnabled ||
    depositDisabled ||
    quoteLoading ||
    (batchLegs.length >= MAX_MULTI_DEPOSIT_LEGS && !batchLegs.some((l) => l.mint === selectedMint)) ||
    (selectedMint === USDC_MINT ? false : !quotePreview);

  const batchDepositDisabled =
    !batchEnabled || disabled || loading || quoteLoading || batchLegs.length === 0;
  // Safety guard: if the user has a non-empty draft in the form, require adding/updating
  // it in the batch explicitly before allowing batch submit (prevents accidental 1-leg sends).
  const hasUnsavedBatchDraft =
    batchEnabled && batchLegs.length > 0 && numAmount > 0;
  const batchDepositBlockedByDraft = hasUnsavedBatchDraft;
  const batchDepositDisabledSafe = batchDepositDisabled || batchDepositBlockedByDraft;
  const batchFullWithNewDraft =
    hasUnsavedBatchDraft &&
    batchLegs.length >= MAX_MULTI_DEPOSIT_LEGS &&
    !batchLegs.some((l) => l.mint === selectedMint);
  const batchDraftWarningText = batchFullWithNewDraft
    ? `Batch is full (${MAX_MULTI_DEPOSIT_LEGS}/${MAX_MULTI_DEPOSIT_LEGS}). Remove a leg or clear the current amount.`
    : `Add the current ${symbol} amount to batch first.`;

  const batchEstimatedUsdc = batchLegs.reduce((sum, leg) => sum + leg.estimatedUsdc, 0);
  const batchEstimatedTickets = Math.floor((batchEstimatedUsdc * 1_000_000) / TICKET_UNIT);

  // Quote info component (reused in compact + full modes)
  const QuoteInfo = () => {
    if (isUsdc || numAmount <= 0) return null;

    if (quoteLoading) {
      return (
        <div className="text-xs flex items-center gap-1.5 text-slate-400 py-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Fetching best route...</span>
        </div>
      );
    }

    if (!quotePreview) return null;

    const impactNum = parseFloat(quotePreview.priceImpact);
    const impactColor = impactNum > 1 ? 'text-red-400' : impactNum > 0.3 ? 'text-yellow-400' : 'text-emerald-400';

    return (
      <div className="text-xs space-y-1.5">
        {/* Estimated output + tickets */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Estimated</span>
          <span className="font-mono font-bold text-emerald-400">
            ≈ {quotePreview.outAmount.toFixed(2)} USDC → {quotePreview.tickets} ticket{quotePreview.tickets !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Min received + slippage editor */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Min received</span>
          <span className="font-mono text-slate-300">
            {quotePreview.minReceived.toFixed(2)} USDC
          </span>
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSlippageOpen(prev => !prev)}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Settings2 className="w-3 h-3" />
            <span>Slippage</span>
          </button>
          <button
            type="button"
            onClick={() => setSlippageOpen(prev => !prev)}
            className="font-mono text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
          >
            {(slippageBps / 100).toFixed(1)}%
          </button>
        </div>

        {slippageOpen && (
          <div className="flex items-center gap-1 pt-0.5">
            {SLIPPAGE_PRESETS.map(pct => {
              const bps = Math.round(pct * 100);
              const active = slippageBps === bps && customSlippage === '';
              return (
                <button
                  key={pct}
                  type="button"
                  onClick={() => { setSlippageBps(bps); setCustomSlippage(''); }}
                  className={`px-2 py-0.5 rounded-md font-mono text-[11px] transition-colors ${
                    active
                      ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                      : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {pct}%
                </button>
              );
            })}
            <div className="relative flex-1 min-w-[52px]">
              <input
                type="text"
                inputMode="decimal"
                placeholder="Custom"
                value={customSlippage}
                onChange={e => {
                  const v = normalizeDecimalInput(e.target.value).replace(/[^0-9.]/g, '');
                  setCustomSlippage(v);
                  const num = parseFloat(v);
                  if (!isNaN(num) && num > 0 && num <= 50) {
                    setSlippageBps(Math.round(num * 100));
                  }
                }}
                className="w-full px-2 py-0.5 rounded-md bg-slate-700/60 text-slate-200 text-[11px] font-mono
                  placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40
                  text-right pr-5"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 pointer-events-none">%</span>
            </div>
          </div>
        )}

        {/* ExactOut: show required token cost */}
        {inputMode === 'usdc' && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Cost</span>
            <span className="font-mono text-blue-300 font-bold">
              {quotePreview.inAmount.toFixed(quotePreview.inAmount < 1 ? 6 : 4)} {symbol}
            </span>
          </div>
        )}

        {/* Route + price impact */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <ArrowRightLeft className="w-3 h-3" />
            via {quotePreview.route}
          </span>
          {impactNum > 0 && (
            <span className={`font-mono ${impactColor}`}>
              {impactNum.toFixed(2)}% impact
            </span>
          )}
        </div>
      </div>
    );
  };

  const dropdownMenu = dropdownOpen
    ? createPortal(
      <div
        ref={menuRef}
        className="fixed z-[9999] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-64 overflow-y-auto custom-scrollbar"
        style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
      >
        {tokensLoading ? (
          <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading tokens...
          </div>
        ) : tokens.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400">No tokens found</div>
        ) : (
          tokens.map((t) => {
            const sym = tokenSymbol(t);
            return (
              <button
                key={t.mint}
                onClick={() => handleSelectToken(t.mint)}
                className={`w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${t.mint === selectedMint ? 'bg-primary/5' : ''
                  }`}
              >
                <div className="flex items-center gap-2">
                  {t.image ? (
                    <img src={t.image} alt={sym} className="w-4 h-4 rounded-full" />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary">
                      {sym[0]}
                    </div>
                  )}
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{sym}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold font-mono text-slate-600 dark:text-slate-300">
                    {formatDisplayedBalance(t.balance, t.mint === USDC_MINT)}
                  </span>
                  {t.usdValue > 0 && (
                    <div className="text-[11px] font-semibold font-mono text-slate-500 dark:text-slate-400">
                      ≈ ${t.usdValue < 0.01 ? '<0.01' : t.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>,
      document.body
    )
    : null;

  const BatchLegsPreview = ({ dark = false }: { dark?: boolean }) => {
    if (!batchEnabled || batchLegs.length === 0) return null;

    return (
      <div className={`rounded-lg ${dark ? 'bg-white/5 border-white/10' : 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600'} border px-3 py-2 space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={`text-[11px] font-bold ${dark ? 'text-slate-300' : 'text-slate-600 dark:text-slate-300'}`}>
            Batch ({batchLegs.length}/{MAX_MULTI_DEPOSIT_LEGS})
          </span>
          <span className={`text-[11px] font-mono ${dark ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400'}`}>
            ≈ {batchEstimatedUsdc.toFixed(2)} USDC
          </span>
        </div>
        <div className="space-y-1.5">
          {batchLegs.map((leg) => (
              <div
                key={leg.mint}
                role="button"
                tabIndex={0}
                onClick={() => editBatchLeg(leg.mint)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    editBatchLeg(leg.mint);
                  }
                }}
                className={`w-full text-left flex items-center justify-between gap-2 rounded px-1 py-1 ${dark ? 'hover:bg-white/5' : 'hover:bg-slate-100 dark:hover:bg-slate-600'} transition-colors`}
                title="Edit this leg"
              >
                <div className="min-w-0">
                  <div className={`text-xs font-bold truncate ${dark ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                    {leg.symbol}
                </div>
                <div className={`text-[10px] font-mono ${dark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {leg.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {leg.symbol}
                  <span className="ml-1">→ ~{leg.estimatedUsdc.toFixed(2)} USDC</span>
                </div>
              </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBatchLeg(leg.mint);
                  }}
                  className={`shrink-0 p-1 rounded ${dark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300'}`}
                  title="Remove from batch"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
          ))}
        </div>
        <div className={`text-[10px] ${dark ? 'text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>
          ≈ {batchEstimatedTickets} tickets (estimated)
        </div>
      </div>
    );
  };

  // ── Compact mode (inside dark pot card) ──
  if (compact) {
    return (
      <div className="space-y-3">
        {/* Token selector */}
        <button
          ref={triggerRef}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between bg-white/10 rounded-lg px-3 py-2 border border-white/10 hover:border-white/20 transition-colors"
          disabled={disabled || loading}
        >
          <div className="flex items-center gap-2">
            {selectedToken?.image ? (
              <img src={selectedToken.image} alt={symbol} className="w-5 h-5 rounded-full" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[9px] font-bold text-white">
                {symbol[0]}
              </div>
            )}
            <span className="text-sm font-bold text-white">{symbol}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-xs font-semibold font-mono text-slate-200">
                {formatDisplayedBalance(balance, isUsdc)}
              </div>
              {selectedToken && selectedToken.usdValue > 0 && (
                <div className="text-[11px] font-semibold font-mono text-slate-300">
                  ≈ ${selectedToken.usdValue < 0.01 ? '<0.01' : selectedToken.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </div>
        </button>
        {dropdownMenu}

        {/* Balance display */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Your balance</span>
          <span className="font-mono text-slate-300">
            {formatDisplayedBalance(balance, isUsdc)} {symbol}
          </span>
        </div>

        {/* Amount input + ExactOut toggle */}
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(normalizeDecimalInput(e.target.value))}
            placeholder={inputMode === 'usdc' ? 'USDC amount' : '0.00'}
            min={0}
            className="w-full bg-white/10 rounded-lg px-4 py-3 text-lg text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-400/50 border border-white/10 placeholder-white/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
            disabled={disabled || loading}
          />
          {/* ExactOut toggle for non-USDC */}
          {!isUsdc && (
            <button
              onClick={toggleInputMode}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
              title={inputMode === 'token' ? 'Switch to USDC input' : `Switch to ${symbol} input`}
            >
              <Repeat2 className="w-3 h-3" />
              {inputMode === 'token' ? symbol : 'USDC'}
            </button>
          )}
        </div>

        {/* Input mode label */}
        {!isUsdc && (
          <div className="text-[10px] text-slate-500 -mt-1">
            {inputMode === 'token'
              ? `Enter ${symbol} amount to swap`
              : 'Enter desired USDC to receive'}
          </div>
        )}

        <div className="flex gap-1.5">
          {[0.25, 0.5, 1].map((pct) => (
            <button
              key={pct}
              onClick={() => setAmount(formatQuickFillAmount(
                balance * pct,
                inputMode === 'usdc' || isUsdc ? 2 : Math.min(6, tokenDecimals)
              ))}
              className="flex-1 text-[11px] py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white transition-colors font-bold"
              disabled={disabled || loading || balance <= 0 || inputMode === 'usdc'}
            >
              {pct === 1 ? 'MAX' : `${pct * 100}%`}
            </button>
          ))}
        </div>

        {/* Jupiter quote preview */}
        {!isUsdc && numAmount > 0 && (
          <div className="bg-blue-400/10 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 text-blue-300 text-xs mb-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{symbol} → USDC via Jupiter</span>
              <span className="ml-auto text-[10px]">🪐</span>
            </div>
            <QuoteInfo />
          </div>
        )}

        {/* Minimum deposit warning */}
        {belowMinimum && (
          <div className="text-xs text-red-400 text-center py-1">
            Minimum deposit: ${MIN_DEPOSIT_USDC} USDC{!isUsdc && quotePreview ? ` (≈ ${quotePreview.outAmount.toFixed(2)} USDC)` : ''}
          </div>
        )}
        {balanceErrorText && (
          <div className="text-xs text-red-400 text-center py-1">
            {balanceErrorText}
          </div>
        )}

        {batchEnabled && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleAddToBatch}
              disabled={addToBatchDisabled}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-bold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {batchLegs.some((l) => l.mint === selectedMint) ? 'Update Batch Leg' : 'Add to Batch'}
            </button>
            <BatchLegsPreview dark />
            {hasUnsavedBatchDraft && (
              <p className="text-[10px] text-amber-300">
                {batchDraftWarningText}
              </p>
            )}
            {batchLegs.length > 0 && (
              <Button
                className="w-full"
                disabled={batchDepositDisabledSafe}
                onClick={handleDepositBatch}
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                {loading ? 'CONFIRMING...' : `DEPOSIT BATCH (${batchLegs.length})`}
              </Button>
            )}
          </div>
        )}

        <Button
          className="w-full"
          glow
          disabled={depositDisabled || quoteLoading}
          onClick={handleDeposit}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4 mr-2" />
          )}
          {loading ? 'CONFIRMING...' : isUsdc ? 'DEPOSIT' : `DEPOSIT ${symbol}`}
        </Button>

        {NETWORK === 'devnet' && balance === 0 && isUsdc && (
          <p className="text-[10px] text-slate-400 text-center">
            Need test USDC? Run: npx tsx scripts/mint_test_usdc.ts {'<wallet>'}
          </p>
        )}
      </div>
    );
  }

  // ── Full mode (standalone card) ──
  return (
    <div className="bento-card p-5 flex flex-col">
      <h3 className="font-bold text-sm mb-3 flex items-center gap-2 text-slate-900 dark:text-white">
        Deposit
      </h3>

      <div className="space-y-3">
        {/* Token selector */}
        <button
          ref={triggerRef}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between bg-slate-50 dark:bg-slate-700 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-600 hover:border-primary/30 transition-colors"
          disabled={disabled || loading}
        >
          <div className="flex items-center gap-2">
            {selectedToken?.image ? (
              <img src={selectedToken.image} alt={symbol} className="w-5 h-5 rounded-full" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary">
                {symbol[0]}
              </div>
            )}
            <span className="text-sm font-bold text-slate-900 dark:text-white">{symbol}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-xs font-semibold font-mono text-slate-600 dark:text-slate-300">
                {formatDisplayedBalance(balance, isUsdc)}
              </div>
              {selectedToken && selectedToken.usdValue > 0 && (
                <div className="text-[11px] font-semibold font-mono text-slate-500 dark:text-slate-400">
                  ≈ ${selectedToken.usdValue < 0.01 ? '<0.01' : selectedToken.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </div>
        </button>
        {dropdownMenu}

        {/* Balance display */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Your balance</span>
          <span className="font-mono text-slate-700 dark:text-slate-300">
            {formatDisplayedBalance(balance, isUsdc)} {symbol}
          </span>
        </div>

        {/* Amount input + ExactOut toggle */}
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(normalizeDecimalInput(e.target.value))}
            placeholder={inputMode === 'usdc' ? 'USDC amount' : '0.00'}
            min={0}
            className="w-full bg-slate-50 dark:bg-slate-700 rounded-xl px-4 py-3 text-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 border border-slate-200 dark:border-slate-600 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
            disabled={disabled || loading}
          />
          {/* ExactOut toggle for non-USDC */}
          {!isUsdc && (
            <button
              onClick={toggleInputMode}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
              title={inputMode === 'token' ? 'Switch to USDC input' : `Switch to ${symbol} input`}
            >
              <Repeat2 className="w-3 h-3" />
              {inputMode === 'token' ? symbol : 'USDC'}
            </button>
          )}
        </div>

        {/* Input mode label */}
        {!isUsdc && (
          <div className="text-[10px] text-slate-500 dark:text-slate-400 -mt-1">
            {inputMode === 'token'
              ? `Enter ${symbol} amount to swap`
              : 'Enter desired USDC to receive'}
          </div>
        )}

        {/* Quick amounts */}
        <div className="flex gap-1.5">
          {[0.25, 0.5, 1].map((pct) => (
            <button
              key={pct}
              onClick={() => setAmount(formatQuickFillAmount(
                balance * pct,
                inputMode === 'usdc' || isUsdc ? 2 : Math.min(6, tokenDecimals)
              ))}
              className="flex-1 text-[11px] py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors font-bold"
              disabled={disabled || loading || balance <= 0 || inputMode === 'usdc'}
            >
              {pct === 1 ? 'MAX' : `${pct * 100}%`}
            </button>
          ))}
        </div>

        {/* Jupiter quote preview */}
        {!isUsdc && numAmount > 0 && (
          <div className="text-xs bg-primary/5 rounded-xl px-3 py-2">
            <div className="flex items-center gap-1.5 text-primary mb-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{symbol} → USDC via Jupiter</span>
              <span className="ml-auto text-[10px]">🪐</span>
            </div>
            <QuoteInfo />
          </div>
        )}

        {batchEnabled && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleAddToBatch}
              disabled={addToBatchDisabled}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-bold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {batchLegs.some((l) => l.mint === selectedMint) ? 'Update Batch Leg' : 'Add to Batch'}
            </button>
            <BatchLegsPreview />
            {hasUnsavedBatchDraft && (
              <p className="text-[10px] text-amber-600 dark:text-amber-300">
                {batchDraftWarningText}
              </p>
            )}
          </div>
        )}

        {/* USDC tickets estimate */}
        {numAmount > 0 && isUsdc && !belowMinimum && (
          <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
            ≈ <span className="text-primary font-mono font-bold">{Math.floor(numAmount * 1_000_000 / TICKET_UNIT)}</span> tickets
          </div>
        )}

        {/* Minimum deposit warning */}
        {belowMinimum && (
          <div className="text-xs text-red-500 dark:text-red-400 text-center py-1">
            Minimum deposit: ${MIN_DEPOSIT_USDC} USDC{!isUsdc && quotePreview ? ` (≈ ${quotePreview.outAmount.toFixed(2)} USDC)` : ''}
          </div>
        )}
        {balanceErrorText && (
          <div className="text-xs text-red-500 dark:text-red-400 text-center py-1">
            {balanceErrorText}
          </div>
        )}
      </div>

      {/* Deposit button */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
        {batchEnabled && batchLegs.length > 0 && (
          <Button
            className="w-full mb-2"
            disabled={batchDepositDisabledSafe}
            onClick={handleDepositBatch}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4 mr-2" />
            )}
            {loading ? 'CONFIRMING...' : `DEPOSIT BATCH (${batchLegs.length})`}
          </Button>
        )}
        <Button
          className="w-full"
          glow
          disabled={depositDisabled || quoteLoading}
          onClick={handleDeposit}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4 mr-2" />
          )}
          {loading ? 'CONFIRMING...' : isUsdc ? 'DEPOSIT' : `DEPOSIT ${symbol}`}
        </Button>
      </div>

      {NETWORK === 'devnet' && balance === 0 && isUsdc && (
        <p className="text-[10px] text-slate-500 mt-2 text-center">
          Need test USDC? Run: npx tsx scripts/mint_test_usdc.ts {'<your_wallet>'}
        </p>
      )}
    </div>
  );
}
