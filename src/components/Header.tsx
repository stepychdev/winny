import { useState, useCallback } from 'react';
import { Wallet, Menu, X, Sun, Moon, Bell, User } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useNavigation, type Page } from '../contexts/NavigationContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationsDropdown, type Notification } from './NotificationsDropdown';
import { NETWORK } from '../lib/constants';

const NAV_ITEMS: { label: string; page: Page }[] = [
  { label: 'Game', page: 'game' },
  { label: 'History', page: 'history' },
  { label: 'How It Works', page: 'how-it-works' },
  { label: 'Fairness', page: 'fairness' },
  { label: 'Leaderboard', page: 'leaderboard' },
];

function formatTimeAgo(ts: number): string {
  const ago = Math.floor((Date.now() - ts) / 60000);
  if (ago < 1) return 'just now';
  if (ago < 60) return `${ago}m ago`;
  if (ago < 1440) return `${Math.floor(ago / 60)}h ago`;
  return `${Math.floor(ago / 1440)}d ago`;
}

export function Header() {
  const { connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { page, navigate } = useNavigation();
  const { theme, toggleTheme } = useTheme();

  const handleWalletClick = () => {
    if (connected) disconnect();
    else setVisible(true);
  };

  const { notifications: rawNotifs, unreadCount, markAllRead, clearAll } = useNotifications();

  const notifications: Notification[] = rawNotifs.map((n) => ({
    id: n.id,
    type: n.type === 'round_settled' ? 'win_old' : n.type,
    title: n.title,
    detail: n.detail,
    timeAgo: formatTimeAgo(n.timestamp),
    unread: n.unread,
  }));

  const handleBellClick = useCallback(() => {
    setNotifOpen((prev) => {
      if (!prev) markAllRead();
      return !prev;
    });
  }, [markAllRead]);

  return (
    <header className="sticky top-0 z-50 w-full bg-transparent">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-3 sm:py-5 flex items-center justify-between">
        {/* Logo */}
        <div
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => navigate('game')}
        >
          <img src="/metadata/w_logo.svg" alt="Winny" className="size-10 rounded-full" />
          <h2 className="text-slate-900 dark:text-white text-xl font-bold tracking-tight">Winny</h2>
        </div>

        {/* Desktop Nav — pill tabs */}
        <nav className="hidden md:flex items-center gap-1 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md p-1.5 rounded-full border border-slate-200/60 dark:border-slate-700">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.page}
              onClick={() => navigate(item.page)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                page === item.page
                  ? 'text-slate-900 dark:text-white bg-white dark:bg-slate-700 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <span
            className={`hidden sm:inline-flex items-center h-8 px-3 rounded-full text-[11px] font-bold border ${
              NETWORK === 'mainnet'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'
            }`}
            title="Solana cluster"
          >
            {NETWORK}
          </span>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="size-10 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

          {/* Notifications bell */}
          <div className="relative">
            <button
              onClick={handleBellClick}
              className={`relative size-10 rounded-full border flex items-center justify-center transition-colors ${
                notifOpen
                  ? 'bg-blue-50 dark:bg-slate-700 text-primary border-blue-100 dark:border-slate-600'
                  : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-primary dark:hover:text-primary'
              }`}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                </span>
              )}
            </button>

            {notifOpen && (
              <NotificationsDropdown
                notifications={notifications}
                onClose={() => setNotifOpen(false)}
                onClearAll={() => { clearAll(); setNotifOpen(false); }}
                onClickNotification={(_id) => {
                  setNotifOpen(false);
                  navigate('game');
                }}
                onViewAll={() => {
                  setNotifOpen(false);
                  navigate('history');
                }}
              />
            )}
          </div>

          {connected && (
            <button
              onClick={() => navigate('cabinet')}
              className="size-10 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors"
              title="Profile"
            >
              <User className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={handleWalletClick}
            className="flex h-10 sm:h-11 items-center gap-1.5 sm:gap-2 rounded-full bg-primary pl-3 pr-3.5 sm:pl-4 sm:pr-5 text-xs sm:text-sm font-bold text-white shadow-lg shadow-primary/30 hover:bg-primary/90 active:scale-95 transition-all"
          >
            <Wallet className="w-4 h-4" />
            <span>{connected ? 'Disconnect' : 'Connect'}</span>
          </button>

          <button
            className="md:hidden p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 px-4 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.page}
              onClick={() => { navigate(item.page); setMobileOpen(false); }}
              className={`block w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                page === item.page
                  ? 'text-primary bg-primary/5'
                  : 'text-slate-500 dark:text-slate-400 active:bg-slate-50 dark:active:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
          {connected && (
            <button
              onClick={() => { navigate('cabinet'); setMobileOpen(false); }}
              className={`block w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                page === 'cabinet'
                  ? 'text-primary bg-primary/5'
                  : 'text-slate-500 dark:text-slate-400 active:bg-slate-50 dark:active:bg-slate-800'
              }`}
            >
              Cabinet
            </button>
          )}
        </div>
      )}
    </header>
  );
}
