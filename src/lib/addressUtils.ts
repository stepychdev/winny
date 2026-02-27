/**
 * Address display utilities — shared across History, RoundDetail,
 * RecentWinners, and mocks.
 */

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/**
 * Shorten a Solana address for display: `AbcD...5678`.
 * Returns "—" for empty/system-program addresses.
 */
export function shortenAddr(addr: string): string {
  if (!addr || addr === SYSTEM_PROGRAM) return '\u2014';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}
