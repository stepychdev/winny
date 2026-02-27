import { useState } from "react";
import { Activity, MessageSquare, Heart, UserPlus2, UserRoundPlus, Zap, ArrowDownToLine, Trophy, Gift, Gamepad2, TrendingDown } from "lucide-react";
import { useTapestryActivityFeed } from "../../hooks/useTapestryActivityFeed";
import type { Roll2RollSocialActivity, GameEventProperties } from "../../lib/tapestry/types";

interface SocialActivityCardProps {
  walletAddress: string | null;
}

const ACTIVITY_CONFIG: Record<Roll2RollSocialActivity["type"], {
  icon: typeof Activity;
  gradient: string;
  iconColor: string;
  label: string;
}> = {
  comment: {
    icon: MessageSquare,
    gradient: "from-blue-500 to-cyan-500",
    iconColor: "text-blue-500",
    label: "Comment",
  },
  like: {
    icon: Heart,
    gradient: "from-pink-500 to-rose-500",
    iconColor: "text-pink-500",
    label: "Like",
  },
  following: {
    icon: UserPlus2,
    gradient: "from-violet-500 to-purple-500",
    iconColor: "text-violet-500",
    label: "Followed",
  },
  new_follower: {
    icon: UserRoundPlus,
    gradient: "from-emerald-500 to-green-500",
    iconColor: "text-emerald-500",
    label: "New Follower",
  },
  new_content: {
    icon: Zap,
    gradient: "from-amber-500 to-orange-500",
    iconColor: "text-amber-500",
    label: "New Content",
  },
};

// Game-event sub-type configs (override new_content defaults).
const GAME_EVENT_CONFIG: Record<string, {
  icon: typeof Activity;
  gradient: string;
  iconColor: string;
  label: string;
}> = {
  deposit: {
    icon: ArrowDownToLine,
    gradient: "from-green-500 to-emerald-500",
    iconColor: "text-green-500",
    label: "Deposit",
  },
  win: {
    icon: Trophy,
    gradient: "from-yellow-400 to-amber-500",
    iconColor: "text-yellow-500",
    label: "Win",
  },
  claim: {
    icon: Gift,
    gradient: "from-purple-500 to-pink-500",
    iconColor: "text-purple-500",
    label: "Claim",
  },
  round_join: {
    icon: Gamepad2,
    gradient: "from-cyan-500 to-blue-500",
    iconColor: "text-cyan-500",
    label: "Joined",
  },
  loss: {
    icon: TrendingDown,
    gradient: "from-red-500 to-rose-500",
    iconColor: "text-red-500",
    label: "Loss",
  },
};

function getActivityConfig(item: Roll2RollSocialActivity) {
  if (item.type === "new_content" && item.gameEvent?.eventType) {
    return GAME_EVENT_CONFIG[item.gameEvent.eventType] || ACTIVITY_CONFIG.new_content;
  }
  return ACTIVITY_CONFIG[item.type] || ACTIVITY_CONFIG.new_content;
}

function formatGameEventDescription(ge: GameEventProperties): string {
  const amount = ge.amount ? `${ge.amount} ${ge.currency || "USDC"}` : "";
  const round = ge.round ? `Round #${ge.round}` : "";
  switch (ge.eventType) {
    case "deposit":
      return amount && round ? `deposited ${amount} in ${round}` : amount ? `deposited ${amount}` : "deposited";
    case "win":
      if (ge.totalPot) return `won pot of ${ge.totalPot} ${ge.currency || "USDC"}${round ? ` in ${round}` : ""}`;
      return amount && round ? `won ${amount} in ${round}` : amount ? `won ${amount}` : "won the round!";
    case "claim":
      return amount ? `claimed ${amount}` : "claimed winnings";
    case "round_join":
      return round ? `joined ${round}` : "joined a round";
    case "loss":
      return ge.totalPot
        ? `lost in ${round || "a round"} (pot: ${ge.totalPot} ${ge.currency || "USDC"})`
        : round ? `lost in ${round}` : "lost the round";
    default:
      return ge.eventType || "game activity";
  }
}

function formatAgo(ts: number) {
  const nowMs = Date.now();
  // Tapestry timestamps are in ms; normalize just in case a seconds-based timestamp slips through.
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  const deltaSec = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  return `${Math.floor(deltaSec / 86400)}d`;
}

function compactUsername(username?: string | null) {
  if (!username) return "unknown";
  return username.length > 18 ? `${username.slice(0, 15)}...` : username;
}

export function SocialActivityCard({ walletAddress }: SocialActivityCardProps) {
  const { activities, loading } = useTapestryActivityFeed(walletAddress, 10);
  const [expanded, setExpanded] = useState(false);
  const visibleActivities = expanded ? activities : activities.slice(0, 5);

  if (!walletAddress) return null;

  return (
    <div className="col-span-1 bento-card relative overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft">
      {/* Decorative gradient top strip */}
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500" />

      <div className="p-4 pt-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 text-white flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm leading-tight">Social Feed</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Your Tapestry network
              </p>
            </div>
          </div>
          {activities.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-cyan-500 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 px-2 py-0.5 rounded-full">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500" />
              </span>
              Live
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-2.5 py-1">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 animate-pulse">
                <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-2 w-20 rounded bg-slate-100 dark:bg-slate-700/50" />
                </div>
                <div className="h-3 w-6 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="size-10 rounded-full bg-cyan-50 dark:bg-cyan-900/20 text-cyan-400 flex items-center justify-center mb-2">
              <Activity className="w-5 h-5" />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[180px]">
              No activity yet. Follow players to build your feed.
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-cyan-200 via-blue-200 to-transparent dark:from-cyan-800 dark:via-blue-800" />

            <div className="space-y-1">
              {visibleActivities.map((item, idx) => {
                const config = getActivityConfig(item);
                const ItemIcon = config.icon;
                const description = item.gameEvent
                  ? formatGameEventDescription(item.gameEvent)
                  : item.activity || item.type;
                return (
                  <div
                    key={item.id}
                    className="relative flex items-start gap-2.5 rounded-2xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-all duration-200 social-feed-item"
                    style={{ animationDelay: `${idx * 80}ms` }}
                  >
                    {/* Activity icon with gradient background */}
                    <div className={`relative z-10 mt-0.5 size-7 rounded-full bg-gradient-to-br ${config.gradient} text-white flex items-center justify-center shrink-0 shadow-sm`}>
                      <ItemIcon className="w-3 h-3" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[12px] font-semibold text-slate-900 dark:text-white truncate">
                            @{compactUsername(item.actorUsername)}
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${config.iconColor} bg-slate-50 dark:bg-slate-700/60 leading-none`}>
                            {config.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                          {formatAgo(item.timestamp)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-1 mt-0.5">
                        {description}
                      </p>
                      {item.targetUsername && (
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                          → @{compactUsername(item.targetUsername)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {activities.length > 5 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full text-center text-[11px] text-cyan-500 hover:text-cyan-400 font-medium py-1.5 transition-colors"
              >
                {expanded ? "Show less" : `Show more (${activities.length - 5})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
