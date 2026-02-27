import { useState, useCallback, useEffect } from 'react';

export type NotificationType = 'win' | 'loss' | 'deposit' | 'round_start' | 'round_settled' | 'win_old';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  detail: string;
  timestamp: number;
  unread: boolean;
}

const STORAGE_KEY = 'roll2roll_notifications';
const MAX_NOTIFICATIONS = 30;

function load(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(items: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
  } catch {}
}

function makeNotification(n: Omit<AppNotification, 'id' | 'timestamp' | 'unread'>): AppNotification {
  return {
    ...n,
    id: `${n.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    unread: true,
  };
}

// ── Global event bus for cross-component notification triggers ──
type Listener = (n: Omit<AppNotification, 'id' | 'timestamp' | 'unread'>) => void;
const listeners = new Set<Listener>();

/** Call from anywhere (hooks, components) to push a notification.
 *  If no hook is mounted, writes directly to localStorage so nothing is lost. */
export function pushNotification(n: Omit<AppNotification, 'id' | 'timestamp' | 'unread'>) {
  if (listeners.size > 0) {
    listeners.forEach((fn) => fn(n));
  } else {
    // No hook mounted — persist directly to localStorage
    const item = makeNotification(n);
    const existing = load();
    save([item, ...existing]);
  }
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(() => load());

  // Sync to localStorage on change
  useEffect(() => {
    save(notifications);
  }, [notifications]);

  // Re-read from localStorage when this hook mounts (picks up any pushed while no listener was active)
  useEffect(() => {
    setNotifications(load());
  }, []);

  const addNotification = useCallback((n: Omit<AppNotification, 'id' | 'timestamp' | 'unread'>) => {
    const item = makeNotification(n);
    setNotifications((prev) => [item, ...prev].slice(0, MAX_NOTIFICATIONS));
  }, []);

  // Subscribe to global event bus
  useEffect(() => {
    listeners.add(addNotification);
    return () => { listeners.delete(addNotification); };
  }, [addNotification]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => n.unread).length;

  return { notifications, unreadCount, addNotification, markAllRead, clearAll };
}
