/**
 * Jupiter Mobile detection & helpers.
 *
 * Jupiter Mobile exposes a built-in wallet through its in-app browser.
 * The wallet is injected via Solana Wallet Standard, so standard wallet-adapter
 * picks it up automatically. We only need to *detect* the environment for UX optimizations.
 */

/** Check if current page is loaded inside Jupiter Mobile's in-app browser. */
export function isJupiterMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // Jupiter Mobile sets a distinctive UA fragment
  if (/Jupiter/i.test(ua)) return true;
  // Fallback: check injected wallet name
  if ((window as any).__jupiter) return true;
  // Check Solana wallet standard registrations
  try {
    const wallets = (window as any).solana;
    if (wallets && wallets.isJupiter) return true;
  } catch { /* ignore */ }
  return false;
}

/** Check if running in *any* mobile wallet in-app browser (Phantom, Solflare, Jupiter, etc.) */
export function isWalletInAppBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /Phantom/i.test(ua) ||
    /Solflare/i.test(ua) ||
    /Jupiter/i.test(ua) ||
    isJupiterMobile()
  );
}

/** App Store / Play Store links for Jupiter Mobile */
const JUPITER_APP_STORE = 'https://apps.apple.com/app/jupiter-mobile/id6502031970';
const JUPITER_PLAY_STORE = 'https://play.google.com/store/apps/details?id=ag.jup.mobile';

/**
 * Generate a deeplink URL to open the current dApp inside Jupiter Mobile's in-app browser.
 *
 * Strategy:
 *  - Returns a `https://` universal link that Jupiter Mobile intercepts when installed.
 *  - Use `openInJupiterMobile()` for a smarter flow that falls back to the app store.
 */
export function getJupiterMobileDeeplink(url?: string): string {
  const target = url || window.location.href;
  // Universal link format that Jupiter Mobile registers via Apple AASA / Android App Links
  return `https://mobile.jup.ag/browser?url=${encodeURIComponent(target)}`;
}

/**
 * Build the deep link URL to open a page in Jupiter Mobile's in-app browser.
 *
 * Android: Intent URL with explicit package name — guarantees the right app
 *          opens AND receives the target URL as an extra.
 * iOS:     Custom scheme with the target URL as a path segment (same pattern
 *          as Phantom `phantom://browse/https://...`).
 */
function buildJupiterDeeplink(target: string): string {
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isAndroid) {
    // Android Intent URL: opens Jupiter Mobile explicitly and passes the dApp URL
    // S.browser_url — string extra that the app reads to navigate its in-app browser
    return (
      `intent://browse/${encodeURIComponent(target)}` +
      `#Intent;scheme=jupiter;package=ag.jup.mobile;` +
      `S.browser_url=${encodeURIComponent(target)};end`
    );
  }

  // iOS: custom scheme with URL as path segment
  return `jupiter://browse/${encodeURIComponent(target)}`;
}

/**
 * Attempt to open the dApp in Jupiter Mobile.
 * Uses native deep link first, with fallback to app store download.
 */
export function openInJupiterMobile(url?: string): void {
  const target = url || window.location.href;
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const deeplink = buildJupiterDeeplink(target);

  // Set a timeout: if the app didn't open, redirect to store
  const fallbackTimeout = setTimeout(() => {
    window.location.href = isIOS ? JUPITER_APP_STORE : JUPITER_PLAY_STORE;
  }, 1500);

  // Listen for visibility change — if the app opened, the page goes hidden
  const onVisibilityChange = () => {
    if (document.hidden) {
      clearTimeout(fallbackTimeout);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Attempt to open via deep link
  window.location.href = deeplink;
}
