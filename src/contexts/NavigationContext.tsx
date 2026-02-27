import React, { createContext, useContext, useState, useCallback } from 'react';

export type Page = 'game' | 'how-it-works' | 'fairness' | 'history' | 'round-detail' | 'cabinet' | 'player-profile';

interface NavigationContextType {
  page: Page;
  navigate: (page: Page) => void;
  roundDetailId: number | null;
  navigateToRound: (id: number) => void;
  playerProfileAddress: string | null;
  navigateToPlayer: (address: string) => void;
}

const NavigationContext = createContext<NavigationContextType>({
  page: 'game',
  navigate: () => {},
  roundDetailId: null,
  navigateToRound: () => {},
  playerProfileAddress: null,
  navigateToPlayer: () => {},
});

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [page, setPage] = useState<Page>('game');
  const [roundDetailId, setRoundDetailId] = useState<number | null>(null);
  const [playerProfileAddress, setPlayerProfileAddress] = useState<string | null>(null);

  const navigateToRound = useCallback((id: number) => {
    setRoundDetailId(id);
    setPage('round-detail');
  }, []);

  const navigateToPlayer = useCallback((address: string) => {
    setPlayerProfileAddress(address);
    setPage('player-profile');
  }, []);

  return (
    <NavigationContext.Provider value={{ page, navigate: setPage, roundDetailId, navigateToRound, playerProfileAddress, navigateToPlayer }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  return useContext(NavigationContext);
}
