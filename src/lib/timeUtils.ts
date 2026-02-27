/**
 * Time display utilities — shared across History, RoundDetail, RecentWinners.
 */

/**
 * Format a Unix timestamp as a relative time string ("Just now", "5m ago", etc).
 * Returns "—" for falsy timestamps.
 */
export function timeAgo(ts: number): string {
  if (!ts) return '\u2014';
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Format a Unix timestamp as a human-readable date string.
 * Returns "—" for falsy timestamps.
 */
export function formatTs(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}
