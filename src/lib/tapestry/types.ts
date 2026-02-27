export type TapestryProfileLike = {
  profile?: {
    id: string;
    namespace: string;
    created_at: number;
    username: string;
    bio?: string | null;
    image?: string | null;
  };
  wallet?: {
    address: string;
  };
  walletAddress?: string;
  namespace?: {
    name: string | null;
    readableName: string | null;
    faviconURL: string | null;
    userProfileURL: string | null;
  };
  contact?: {
    id: string;
    type: "EMAIL" | "PHONE" | "TWITTER";
    bio?: string;
    image?: string;
  };
};

export type TapestryActivityLike = {
  type: "following" | "new_content" | "like" | "comment" | "new_follower";
  actor_id: string;
  actor_username: string;
  target_id?: string;
  target_username?: string;
  comment_id?: string;
  timestamp: number;
  activity: string;
};

export interface Roll2RollSocialProfile {
  wallet: string;
  profileId?: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  source?: string | null;
  namespaceName?: string | null;
  namespaceReadableName?: string | null;
  isFollowing?: boolean;
}

/** Properties attached to a `new_content` game-event activity. */
export interface GameEventProperties {
  eventType?: string;   // "deposit" | "win" | "loss" | "claim" | "round_join"
  amount?: string;
  currency?: string;    // e.g. "USDC"
  round?: string;
  totalPot?: string;
  mint?: string;
  sig?: string;
  winner?: string;      // winner wallet (present on loss events)
  participants?: string; // participant count
}

export interface Roll2RollSocialActivity {
  id: string;
  type: TapestryActivityLike["type"];
  actorProfileId: string;
  actorUsername: string;
  targetProfileId?: string;
  targetUsername?: string;
  commentId?: string;
  timestamp: number;
  activity: string;
  /** Present only for `new_content` items that carry game-event data. */
  gameEvent?: GameEventProperties;
}

export type TapestryProfilesResponse = {
  ok: boolean;
  profiles: Record<string, Roll2RollSocialProfile | null>;
};

export type TapestryProfileResponse = {
  ok: boolean;
  profile: Roll2RollSocialProfile | null;
};

export type TapestryActivityFeedResponse = {
  ok: boolean;
  activities: Roll2RollSocialActivity[];
  limit?: number;
  page?: number;
  pageSize?: number;
};

export type TapestryFollowMutationResponse = {
  ok: boolean;
  action: "follow" | "unfollow";
  wallet: string;
  targetWallet?: string;
  targetProfileId: string;
};

export interface TapestryComment {
  id: string;
  text: string;
  createdAt: number;
  author: {
    profileId: string;
    username: string;
    image: string | null;
  } | null;
  likeCount: number;
  hasLiked: boolean;
}

export interface TapestryCommentsResponse {
  ok: boolean;
  comments: TapestryComment[];
  page: number;
  pageSize: number;
}

export interface TapestrySearchResponse {
  ok: boolean;
  profiles: Roll2RollSocialProfile[];
  page: number;
  pageSize: number;
}
