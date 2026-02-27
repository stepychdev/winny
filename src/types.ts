export interface Token {
  mint: string;
  symbol: string;
  icon: string;
  decimals: number;
  balance: number;
  priceUsdc: number;
}

export interface Participant {
  address: string;
  displayName: string;
  color: string;
  usdcAmount: number;
  tickets: number;
  tokens: { symbol: string; amount: number; icon: string }[];
}

export interface RoundState {
  id: number;
  status: GamePhase;
  totalUsdc: number;
  totalTickets: number;
  participants: Participant[];
  endTs: number;
  winner: string | null;
}

export type GamePhase =
  | 'waiting'
  | 'open'
  | 'countdown'
  | 'spinning'
  | 'settled'
  | 'claimed'
  | 'cancelled';
