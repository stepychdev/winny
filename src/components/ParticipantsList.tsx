import { useWallet } from '@solana/wallet-adapter-react';
import { Users } from 'lucide-react';
import { Participant } from '../types';
import { shortenAddress } from '../mocks';
import { formatUsdc } from '../lib/format';
import { useNavigation } from '../contexts/NavigationContext';
import { useTapestryProfiles } from '../hooks/useTapestryProfiles';

interface ParticipantsListProps {
  participants: Participant[];
  totalUsdc: number;
}

export function ParticipantsList({ participants, totalUsdc }: ParticipantsListProps) {
  const { publicKey } = useWallet();
  const { navigateToPlayer } = useNavigation();
  const { profilesByWallet } = useTapestryProfiles(participants.map((p) => p.address));
  return (
    <div className="p-4 flex flex-col h-full">
      <h3 className="font-bold text-sm mb-3 flex items-center gap-2 text-slate-900 dark:text-white">
        <Users className="w-4 h-4 text-primary" />
        Live Feed
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400 font-mono">{participants.length}</span>
      </h3>

      <div className="flex-1 overflow-y-auto space-y-1.5 max-h-[320px] pr-1 hide-scrollbar">
        {participants.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            Waiting for deposits...
          </div>
        ) : (
          [...participants]
            .sort((a, b) => b.usdcAmount - a.usdcAmount)
            .map((p, i) => {
            const pct = totalUsdc > 0 ? (p.usdcAmount / totalUsdc) * 100 : 0;
            const isYou = !!publicKey && p.address === publicKey.toBase58();
            const socialProfile = profilesByWallet[p.address];
            const displayName = socialProfile?.displayName || p.displayName;

            return (
              <div
                key={`${p.address}-${i}`}
                className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-300 cursor-pointer hover:ring-2 hover:ring-primary/30 ${
                  isYou
                    ? 'border-primary/20 bg-primary/5'
                    : 'border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50'
                }`}
                style={{
                  animation: 'fadeSlideIn 0.3s ease-out',
                }}
                onClick={() => navigateToPlayer(p.address)}
              >
                {/* Color dot */}
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {socialProfile?.avatarUrl ? (
                      <img
                        src={socialProfile.avatarUrl}
                        alt={displayName}
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                    <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {displayName}
                    </span>
                    {isYou && (
                      <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {p.tokens.map((t, j) => (
                      <span key={j} className="inline-flex items-center gap-0.5">
                        {t.icon ? (
                          <img
                            src={t.icon}
                            alt={t.symbol}
                            className="w-3.5 h-3.5 rounded-full"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <span
                            className="w-3.5 h-3.5 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-[6px] font-bold text-slate-500 dark:text-slate-300"
                            title={t.symbol}
                          >
                            {t.symbol.slice(0, 1)}
                          </span>
                        )}
                        <span className="text-[9px] font-semibold text-slate-500 dark:text-slate-400">
                          {t.symbol}
                        </span>
                      </span>
                    ))}
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      {shortenAddress(p.address)}
                    </span>
                  </div>
                </div>

                {/* Amount & chance */}
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-mono font-bold text-slate-900 dark:text-white">
                    ${formatUsdc(p.usdcAmount)}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                    {pct.toFixed(1)}%
                  </div>
                </div>

                {/* Chance bar */}
                <div className="w-10 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: p.color,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
