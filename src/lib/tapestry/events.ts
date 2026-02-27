/**
 * Minimal pub/sub for tapestry feed refresh events.
 * Allows Home.tsx to notify SocialActivityCard after publishing game events.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onFeedRefresh(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitFeedRefresh(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* swallow */ }
  }
}
