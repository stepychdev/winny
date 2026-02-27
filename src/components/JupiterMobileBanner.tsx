import { useState, useEffect } from 'react';
import { X, Smartphone } from 'lucide-react';
import { isJupiterMobile, openInJupiterMobile } from '../lib/jupiterMobile';

const DISMISSED_KEY = 'jup_mobile_banner_dismissed';

/**
 * Shows a contextual banner:
 * - Inside Jupiter Mobile: "You're in Jupiter Mobile — optimized UX active"
 * - On mobile browsers: "Open in Jupiter Mobile for the best experience"
 * - On desktop: hidden
 */
export function JupiterMobileBanner() {
  const [dismissed, setDismissed] = useState(true);
  const [inJupiter, setInJupiter] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const wasDismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const jupiter = isJupiterMobile();
    setInJupiter(jupiter);
    setIsMobile(mobile);
    // Always show for Jupiter Mobile users (it's positive feedback), hide if dismissed for others
    setDismissed(jupiter ? false : wasDismissed);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    if (!inJupiter) localStorage.setItem(DISMISSED_KEY, '1');
  };

  if (dismissed && !inJupiter) return null;
  if (!isMobile && !inJupiter) return null;

  if (inJupiter) {
    return (
      <div className="bg-gradient-to-r from-[#1B1B2F] to-[#162447] text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium">
        <span className="text-base">🪐</span>
        <span>Jupiter Mobile — optimized experience active</span>
        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px] font-bold">LIVE</span>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="bg-gradient-to-r from-[#1B1B2F] to-[#162447] text-white px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <Smartphone className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-xs font-medium truncate">
          Open in <span className="font-bold">Jupiter Mobile</span> for the best experience
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => openInJupiterMobile()}
          className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full text-[11px] font-bold transition-colors"
        >
          Open
        </button>
        <button onClick={handleDismiss} className="p-0.5 hover:bg-white/10 rounded-full transition-colors">
          <X className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    </div>
  );
}
