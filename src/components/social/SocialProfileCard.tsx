import { Users, UserPlus, UserCheck, Sparkles } from "lucide-react";
import { useTapestryProfile } from "../../hooks/useTapestryProfile";
import type { Roll2RollSocialProfile } from "../../lib/tapestry/types";

interface SocialProfileCardProps {
  walletAddress: string;
  /** If provided externally, skip internal fetch */
  profile?: Roll2RollSocialProfile | null;
  /** Show follow/unfollow button (for other player's profiles) */
  showFollow?: boolean;
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  followLoading?: boolean;
  compact?: boolean;
}

function shorten(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export function SocialProfileCard({
  walletAddress,
  profile: externalProfile,
  showFollow = false,
  isFollowing = false,
  onToggleFollow,
  followLoading = false,
  compact = false,
}: SocialProfileCardProps) {
  const { profile: fetchedProfile, loading } = useTapestryProfile(
    externalProfile !== undefined ? null : walletAddress
  );
  const profile = externalProfile !== undefined ? externalProfile : fetchedProfile;

  if (loading) {
    return (
      <div className="bento-card relative overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500" />
        <div className="p-5 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-700/50" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bento-card relative overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700" />
        <div className="p-5">
          <div className="flex items-center gap-4">
            <div className="p-[2px] rounded-full bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700">
              <div className="w-12 h-12 rounded-full bg-white dark:bg-slate-800 text-slate-400 font-bold text-lg grid place-items-center">
                {walletAddress.charAt(0).toUpperCase()}
              </div>
            </div>
            <div>
              <div className="text-base font-bold text-slate-900 dark:text-white font-mono">
                {shorten(walletAddress)}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-xs text-slate-400 dark:text-slate-500">No Tapestry profile</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400 font-medium">Wallet only</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayName = profile.displayName || profile.username || shorten(profile.wallet);

  return (
    <div className="bento-card relative overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft">
      {/* Gradient top strip */}
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500" />

      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 w-40 h-40 bg-violet-500/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl pointer-events-none" />

      <div className={compact ? "p-4" : "p-5"}>
        <div className="flex items-center gap-4">
          {/* Avatar with gradient ring */}
          <div className="relative flex-shrink-0">
            <div className="p-[3px] rounded-full bg-gradient-to-br from-violet-400 via-fuchsia-400 to-pink-400 shadow-lg shadow-violet-500/20">
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={displayName}
                  className={`${compact ? "w-12 h-12" : "w-14 h-14"} rounded-full bg-white dark:bg-slate-800 object-cover`}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className={`${compact ? "w-12 h-12" : "w-14 h-14"} rounded-full bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-300 font-bold text-xl grid place-items-center`}>
                  {(displayName || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            {/* Online dot */}
            <div className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-green-500 border-[3px] border-white dark:border-slate-800 social-pulse" />
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className={`font-bold text-slate-900 dark:text-white truncate ${compact ? "text-base" : "text-lg"}`}>
                {displayName}
              </h3>
              {profile.source === "tapestry" && (
                <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0" />
              )}
            </div>
            {profile.username && (
              <p className="text-sm text-violet-500 dark:text-violet-400 font-medium truncate">
                @{profile.username}
              </p>
            )}
            {profile.bio && !compact && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                {profile.bio}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              {profile.namespaceName && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-300 border border-violet-100 dark:border-violet-800">
                  <Users className="w-2.5 h-2.5" />
                  {profile.namespaceReadableName || profile.namespaceName}
                </span>
              )}
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                {shorten(profile.wallet)}
              </span>
            </div>
          </div>

          {/* Follow button */}
          {showFollow && onToggleFollow && (
            <button
              type="button"
              onClick={onToggleFollow}
              disabled={followLoading || !profile.profileId}
              className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ${
                isFollowing
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  : "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/30 active:scale-95"
              }`}
            >
              {followLoading ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : isFollowing ? (
                <>
                  <UserCheck className="w-3.5 h-3.5" />
                  Following
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  Follow
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
