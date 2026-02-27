import { Trophy, Clock, ArrowUpRight, X, CheckCircle, XCircle } from 'lucide-react';

export interface Notification {
  id: string;
  type: 'win' | 'loss' | 'round_start' | 'deposit' | 'win_old' | 'round_settled';
  title: string;
  detail: string;
  timeAgo: string;
  unread?: boolean;
}

interface NotificationsDropdownProps {
  notifications: Notification[];
  onClose: () => void;
  onClearAll: () => void;
  onClickNotification?: (id: string) => void;
  onViewAll?: () => void;
}

const iconMap = {
  win: { Icon: Trophy, bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-500' },
  loss: { Icon: XCircle, bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-500 dark:text-red-400' },
  win_old: { Icon: Trophy, bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500 dark:text-slate-400' },
  round_start: { Icon: Clock, bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-primary dark:text-blue-400' },
  round_settled: { Icon: CheckCircle, bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500 dark:text-slate-400' },
  deposit: { Icon: ArrowUpRight, bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-500' },
};

export function NotificationsDropdown({ notifications, onClose, onClearAll, onClickNotification, onViewAll }: NotificationsDropdownProps) {
  return (
    <>
      {/* Invisible backdrop to close on outside click */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto top-16 sm:top-full right-auto sm:right-0 sm:mt-2 z-50 sm:w-[380px] origin-top-right animate-in fade-in zoom-in-95 duration-200">
        {/* Arrow pointing to bell (desktop only) */}
        <div className="hidden sm:block absolute -top-[6px] right-[14px] w-4 h-4 bg-white dark:bg-slate-900 rotate-45 border-l border-t border-slate-200 dark:border-slate-700 z-[-1]" />

        <div className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden ring-1 ring-black/5 dark:ring-white/5">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h3 className="text-slate-900 dark:text-white text-base font-bold leading-tight">Notifications</h3>
            <div className="flex items-center gap-4">
              {notifications.length > 0 && (
                <button
                  onClick={onClearAll}
                  className="text-primary hover:text-blue-700 text-sm font-medium transition-colors"
                >
                  Clear All
                </button>
              )}
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex flex-col max-h-[400px] overflow-y-auto hide-scrollbar">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <div className="flex items-center justify-center size-12 rounded-full bg-slate-100 dark:bg-slate-800 mx-auto mb-3">
                  <Trophy className="w-5 h-5 text-slate-400" />
                </div>
                <p className="text-sm text-slate-400 dark:text-slate-500">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                const { Icon, bg, text } = iconMap[n.type] || iconMap.round_start;
                return (
                  <div
                    key={n.id}
                    onClick={() => onClickNotification?.(n.id)}
                    className={`group flex items-start gap-4 p-4 border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer relative ${n.type === 'win_old' ? 'opacity-70' : ''}`}
                  >
                    {/* Unread indicator */}
                    {n.unread && (
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500 rounded-r-full" />
                    )}

                    <div className={`shrink-0 flex items-center justify-center size-10 rounded-full ${bg} ${text} mt-0.5`}>
                      <Icon className="w-5 h-5" />
                    </div>

                    <div className="flex flex-col gap-0.5 w-full">
                      <p className={`text-slate-900 dark:text-white text-sm leading-snug pr-2 ${n.unread ? 'font-semibold' : 'font-medium'}`}>
                        {n.title}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400 text-xs leading-normal">
                        {n.detail && (
                          <span className={n.type === 'win' ? 'text-amber-600 font-medium' : ''}>{n.detail} • </span>
                        )}
                        {n.timeAgo}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="bg-slate-50 dark:bg-slate-800/50 p-3 text-center border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={() => {
                onClose();
                onViewAll?.();
              }}
              className="text-xs font-semibold text-slate-600 hover:text-primary dark:text-slate-400 dark:hover:text-white transition-colors"
            >
              View all activity
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
