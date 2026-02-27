import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { JackpotProvider } from './contexts/JackpotContext';
import { NETWORK as SOLANA_NETWORK } from './lib/constants';
import { Home } from './pages/Home';
import { HowItWorks } from './pages/HowItWorks';
import { Fairness } from './pages/Fairness';
import History from './pages/History';
import RoundDetail from './pages/RoundDetail';
import { Cabinet } from './pages/Cabinet';
import { PlayerProfile } from './pages/PlayerProfile';

import '@solana/wallet-adapter-react-ui/styles.css';

// In production mainnet, always route through the serverless proxy
// so the RPC API key stays server-side and is never exposed to visitors.
// For local dev, use VITE_RPC_URL if set, otherwise fall back to public endpoint.
const RPC_ENDPOINT =
  import.meta.env.PROD && SOLANA_NETWORK === 'mainnet' && typeof window !== 'undefined'
    ? `${window.location.origin}/api/solana-rpc`
    : ((import.meta.env.VITE_RPC_URL as string | undefined)?.trim() ||
       clusterApiUrl(SOLANA_NETWORK === 'mainnet' ? 'mainnet-beta' : 'devnet'));

function PageRouter() {
  const { page } = useNavigation();
  switch (page) {
    case 'how-it-works': return <HowItWorks />;
    case 'fairness': return <Fairness />;
    case 'history': return <History />;
    case 'round-detail': return <RoundDetail />;
    case 'cabinet': return <Cabinet />;
    case 'player-profile': return <PlayerProfile />;
    default: return <Home />;
  }
}

function App() {
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ThemeProvider>
            <NavigationProvider>
              <JackpotProvider>
                <PageRouter />
              </JackpotProvider>
            </NavigationProvider>
          </ThemeProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export { App };
