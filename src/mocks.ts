import { Token, Participant, RoundState } from './types';

export const PARTICIPANT_COLORS = [
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#ef4444', // red
  '#22c55e', // green
  '#ec4899', // pink
  '#3b82f6', // blue
  '#f97316', // orange
];

export const MOCK_TOKENS: Token[] = [
  {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    decimals: 9,
    balance: 12.45,
    priceUsdc: 178.5,
  },
  {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    icon: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
    decimals: 5,
    balance: 15_000_000,
    priceUsdc: 0.0000234,
  },
  {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    icon: 'https://static.jup.ag/jup/icon.png',
    decimals: 6,
    balance: 520,
    priceUsdc: 0.89,
  },
  {
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    symbol: 'RAY',
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png',
    decimals: 6,
    balance: 85.3,
    priceUsdc: 2.15,
  },
  {
    mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    symbol: 'PYTH',
    icon: 'https://pyth.network/token.svg',
    decimals: 6,
    balance: 340,
    priceUsdc: 0.42,
  },
  {
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: 'WIF',
    icon: 'https://bafkreibk3covs5ltyqxa272uodhber6xekr6ocfes74bvziqcldlhqsbia.ipfs.nftstorage.link',
    decimals: 6,
    balance: 210,
    priceUsdc: 1.65,
  },
];

export const MOCK_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

export const MOCK_PARTICIPANTS: Participant[] = [
  {
    address: '3Fq1VxR...kN9p',
    displayName: 'whale.sol',
    color: PARTICIPANT_COLORS[0],
    usdcAmount: 850,
    tickets: 850,
    tokens: [{ symbol: 'SOL', amount: 4.76, icon: MOCK_TOKENS[0].icon }],
  },
  {
    address: '8YhT4mQ...bR2x',
    displayName: 'degen420',
    color: PARTICIPANT_COLORS[1],
    usdcAmount: 320,
    tickets: 320,
    tokens: [
      { symbol: 'BONK', amount: 8_000_000, icon: MOCK_TOKENS[1].icon },
      { symbol: 'JUP', amount: 120, icon: MOCK_TOKENS[2].icon },
    ],
  },
  {
    address: '5KpWn7E...jL4m',
    displayName: 'sol_maxi',
    color: PARTICIPANT_COLORS[2],
    usdcAmount: 540,
    tickets: 540,
    tokens: [{ symbol: 'SOL', amount: 3.02, icon: MOCK_TOKENS[0].icon }],
  },
];

export { shortenAddr as shortenAddress } from './lib/addressUtils';

export function generateMockRound(id: number): RoundState {
  return {
    id,
    status: 'open',
    totalUsdc: MOCK_PARTICIPANTS.reduce((s, p) => s + p.usdcAmount, 0),
    totalTickets: MOCK_PARTICIPANTS.reduce((s, p) => s + p.tickets, 0),
    participants: [...MOCK_PARTICIPANTS],
    endTs: Date.now() + 30_000,
    winner: null,
  };
}
