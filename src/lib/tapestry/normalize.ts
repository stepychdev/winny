import type { Roll2RollSocialProfile, TapestryProfileLike } from "./types";

export function normalizeTapestryProfile(input: TapestryProfileLike | null | undefined): Roll2RollSocialProfile | null {
  if (!input?.profile) return null;

  const wallet = input.wallet?.address || input.walletAddress;
  if (!wallet) return null;

  const username = input.profile.username?.trim() || null;
  const displayName =
    username ||
    input.namespace?.readableName?.trim() ||
    input.namespace?.name?.trim() ||
    wallet;

  return {
    wallet,
    profileId: input.profile.id,
    displayName,
    username,
    avatarUrl: input.profile.image ?? input.contact?.image ?? null,
    bio: input.profile.bio ?? input.contact?.bio ?? null,
    source: "tapestry",
    namespaceName: input.namespace?.name ?? null,
    namespaceReadableName: input.namespace?.readableName ?? null,
  };
}

