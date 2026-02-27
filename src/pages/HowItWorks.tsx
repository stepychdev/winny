import { useRef, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { useNavigation } from '../contexts/NavigationContext';
import {
  Wallet,
  ArrowRightLeft,
  Users,
  Trophy,
  BadgeCheck,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

const TOKEN_PILLS = [
  { symbol: 'SOL', color: 'bg-gradient-to-r from-purple-500 to-indigo-500', text: 'text-white' },
  { symbol: 'JUP', color: 'bg-gradient-to-r from-lime-400 to-emerald-500', text: 'text-white' },
  { symbol: 'BONK', color: 'bg-gradient-to-r from-amber-400 to-orange-500', text: 'text-white' },
  { symbol: 'WIF', color: 'bg-gradient-to-r from-pink-400 to-rose-500', text: 'text-white' },
  { symbol: 'USDC', color: 'bg-gradient-to-r from-blue-400 to-cyan-500', text: 'text-white' },
];

const steps = [
  {
    icon: Wallet,
    title: 'Connect Wallet',
    desc: 'Link your Phantom, Solflare, or any Solana wallet. Instant, secure connection — no sign-ups.',
    badge: 'Step 01',
    iconBg: 'bg-blue-50 dark:bg-blue-900/30',
    iconColor: 'text-primary',
    visual: (
      <div className="relative h-24 bg-gradient-to-r from-slate-50 to-blue-50/50 dark:from-slate-800 dark:to-blue-900/20 rounded-xl border border-dashed border-blue-200 dark:border-blue-800 flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-primary/5 blur-xl" />
        <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700 z-10">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm font-mono text-slate-600 dark:text-slate-300">7xKQ...9zM2</span>
        </div>
      </div>
    ),
  },
  {
    icon: ArrowRightLeft,
    title: 'Deposit Any Token',
    desc: 'Pick any SPL token from your wallet — SOL, JUP, BONK, WIF, whatever you hold. Non-USDC tokens are auto-swapped to USDC via Jupiter in the same transaction. You can even batch multiple tokens at once.',
    badge: 'Step 02',
    iconBg: 'bg-blue-50 dark:bg-blue-900/30',
    iconColor: 'text-primary',
    visual: (
      <div className="space-y-3">
        <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>You deposit</span>
            <span>Auto-swap via Jupiter 🪐</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-slate-900 dark:text-white">2.5</span>
            <div className="flex items-center gap-1 bg-gradient-to-r from-purple-500 to-indigo-500 px-2.5 py-1 rounded-lg text-white text-xs font-bold">◎ SOL</div>
            <ArrowRight className="w-4 h-4 text-slate-400 mx-1" />
            <span className="text-lg font-bold text-green-600 dark:text-green-400">≈ $340</span>
            <div className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/40 px-2 py-1 rounded-lg text-primary text-xs font-bold">USDC</div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {TOKEN_PILLS.map(t => (
            <span key={t.symbol} className={`${t.color} ${t.text} text-[10px] font-bold px-2.5 py-1 rounded-full`}>{t.symbol}</span>
          ))}
          <span className="text-[10px] text-slate-400 font-bold">+ any SPL token</span>
        </div>
      </div>
    ),
  },
  {
    icon: Users,
    title: 'Wait for Players',
    desc: 'The round fills up as other degens join. Watch the pot grow in the live feed — see who deposited which tokens and their win chance.',
    badge: 'Step 03',
    iconBg: 'bg-blue-50 dark:bg-blue-900/30',
    iconColor: 'text-primary',
    visual: (
      <div className="flex items-center justify-center gap-6 py-2">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
            <path className="text-slate-100 dark:text-slate-700" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
            <path className="text-primary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray="75, 100" strokeLinecap="round" strokeWidth="3" />
          </svg>
          <span className="absolute text-xs font-bold text-primary">45s</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-indigo-500" />
            <span className="font-mono text-slate-500 dark:text-slate-400">7xKQ</span>
            <span className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">SOL</span>
            <span className="text-slate-900 dark:text-white font-bold ml-auto">$340</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-pink-500" />
            <span className="font-mono text-slate-500 dark:text-slate-400">Ak9z</span>
            <span className="bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">BONK</span>
            <span className="text-slate-900 dark:text-white font-bold ml-auto">$50</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="font-mono text-slate-500 dark:text-slate-400">Tm4k</span>
            <span className="bg-blue-100 dark:bg-blue-900/40 text-primary text-[9px] font-bold px-1.5 py-0.5 rounded-full">USDC</span>
            <span className="text-slate-900 dark:text-white font-bold ml-auto">$100</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: Trophy,
    title: 'Winner Selected',
    desc: 'When the timer ends, MagicBlock VRF generates provably fair randomness on-chain. Higher deposit = higher chance. The result is tamper-proof and verifiable by anyone.',
    badge: 'Step 04',
    iconBg: 'bg-amber-50 dark:bg-amber-900/20',
    iconColor: 'text-amber-600 dark:text-amber-500',
    visual: (
      <div className="relative h-28 bg-slate-900 rounded-xl flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-amber-500/20 via-slate-900 to-slate-900" />
        <div className="absolute top-4 left-8 w-1.5 h-1.5 bg-amber-300 rounded-full animate-pulse" />
        <div className="absolute bottom-6 right-12 w-2 h-2 bg-amber-300 rounded-full animate-pulse [animation-delay:300ms]" />
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-300 to-amber-600 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/30 mb-2 rotate-3">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div className="text-white font-bold text-sm tracking-widest uppercase">Winner Found</div>
        </div>
      </div>
    ),
  },
  {
    icon: BadgeCheck,
    title: 'Claim — Classic or Degen Mode',
    desc: 'Claim your winnings in USDC, or flip on Degen Mode to auto-swap your prize into a random token (SOL, JUP, BONK, WIF…) via Jupiter. Only 0.25% fee from the pot.',
    badge: 'Final Step',
    iconBg: 'bg-primary',
    iconColor: 'text-white',
    cardExtra: 'bg-gradient-to-br from-white to-blue-50 dark:from-slate-800 dark:to-blue-900/20 !border-blue-100 dark:!border-blue-800',
    badgeExtra: 'text-primary bg-blue-100/50 dark:bg-blue-900/30',
    visual: (
      <div className="space-y-2">
        <div className="w-full flex items-center justify-center gap-3 bg-primary text-white py-3.5 rounded-xl font-bold text-base shadow-lg shadow-primary/20 cursor-default">
          <span>Claim USDC</span>
          <ArrowRight className="w-5 h-5" />
        </div>
        <div className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-purple-600 via-pink-500 to-amber-500 text-white py-3.5 rounded-xl font-bold text-base shadow-lg shadow-purple-500/20 cursor-default">
          <Sparkles className="w-5 h-5" />
          <span>Degen Claim → random token</span>
        </div>
      </div>
    ),
  },
];

function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible };
}

function StepCard({ step, index }: { step: typeof steps[number]; index: number }) {
  const { ref, visible } = useInView(0.15);
  const isEven = index % 2 === 0;
  const isLast = index === steps.length - 1;

  return (
    <div
      ref={ref}
      className={`relative flex flex-col ${isEven ? 'md:flex-row' : 'md:flex-row-reverse'} items-center justify-between gap-8 group
        transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      {/* Number node on timeline */}
      <div className={`absolute left-4 md:left-1/2 top-0 md:top-8 -translate-x-1/2 flex items-center justify-center w-10 h-10 rounded-full z-10 shadow-lg shadow-primary/20
        ${isLast
          ? 'bg-primary text-white ring-4 ring-blue-100 dark:ring-blue-900/40'
          : 'bg-white dark:bg-slate-800 border-4 border-primary'}`}>
        {isLast
          ? <BadgeCheck className="w-4 h-4" />
          : <span className="text-sm font-bold text-primary">{index + 1}</span>}
      </div>

      {/* Spacer for the other side */}
      <div className="hidden md:block w-1/2" />

      {/* Card */}
      <div className={`w-full md:w-1/2 pl-12 ${!isEven ? 'md:pr-12 md:pl-0' : 'md:pl-12'}`}>
        <div className={`bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden
          ${step.cardExtra || ''}`}>
          {/* Decorative blob */}
          {!isEven && <div className="absolute -right-10 -top-10 w-32 h-32 bg-primary/5 rounded-full blur-2xl" />}

          <div className={`flex ${!isEven ? 'flex-row md:flex-row-reverse' : 'flex-row'} items-start justify-between mb-4`}>
            <div className={`p-3 rounded-xl ${step.iconBg} ${step.iconColor}`}>
              <step.icon className="w-7 h-7" />
            </div>
            <span className={`text-xs font-semibold px-2 py-1 rounded ${step.badgeExtra || 'text-slate-400 bg-slate-50 dark:bg-slate-700 dark:text-slate-400'}`}>
              {step.badge}
            </span>
          </div>

          <h3 className={`text-xl font-bold text-slate-900 dark:text-white mb-2 ${!isEven ? 'md:text-right' : ''}`}>
            {step.title}
          </h3>
          <p className={`text-slate-500 dark:text-slate-400 leading-relaxed mb-6 ${!isEven ? 'md:text-right' : ''}`}>
            {step.desc}
          </p>

          {step.visual}
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const { navigate } = useNavigation();

  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-[#0f1219] text-slate-900 dark:text-slate-100">
      <Header />

      <main className="flex-grow">
        {/* Hero */}
        <section className="pt-16 pb-12 px-4 text-center">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Guide
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white">
              How It Works
            </h2>
            <p className="text-lg md:text-xl text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Deposit any Solana token, auto-swap via <a href="https://jup.ag/" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">Jupiter</a>, and compete for the pot. Claim in USDC or go full degen.
            </p>
          </div>
        </section>

        {/* Timeline */}
        <section className="relative max-w-5xl mx-auto px-4 pb-32">
          {/* Vertical line */}
          <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-1 -ml-0.5 rounded-full opacity-20 bg-gradient-to-b from-primary via-primary to-transparent" />

          <div className="space-y-16 md:space-y-24 relative">
            {steps.map((step, i) => (
              <StepCard key={i} step={step} index={i} />
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-white dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">Ready to ape in?</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6">Deposit any token. Win the pot. Claim as whatever you want.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={() => navigate('game')}
                className="w-full sm:w-auto px-8 py-4 bg-primary text-white rounded-xl font-bold text-lg shadow-lg shadow-primary/30 hover:bg-primary/90 hover:shadow-xl transition-all hover:-translate-y-0.5"
              >
                Enter the Roll
              </button>
              <button
                onClick={() => navigate('fairness')}
                className="w-full sm:w-auto px-8 py-4 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
              >
                View Fairness
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
