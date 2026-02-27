import { describe, expect, test } from "vitest";
import { normalizeTapestryProfile } from "./normalize";

describe("normalizeTapestryProfile", () => {
  test("normalizes a wallet-backed tapestry profile", () => {
    const profile = normalizeTapestryProfile({
      profile: {
        id: "prof_1",
        namespace: "tapestry",
        created_at: Date.now(),
        username: "degen_player",
        bio: "bio",
        image: "https://example.com/a.png",
      },
      wallet: { address: "wallet123" },
      namespace: {
        name: "sns",
        readableName: "degen.sol",
        faviconURL: null,
        userProfileURL: null,
      },
    });

    expect(profile).toEqual({
      wallet: "wallet123",
      profileId: "prof_1",
      displayName: "degen_player",
      username: "degen_player",
      avatarUrl: "https://example.com/a.png",
      bio: "bio",
      source: "tapestry",
      namespaceName: "sns",
      namespaceReadableName: "degen.sol",
    });
  });

  test("falls back to namespace name when username is empty", () => {
    const profile = normalizeTapestryProfile({
      profile: {
        id: "prof_2",
        namespace: "tapestry",
        created_at: Date.now(),
        username: "   ",
      },
      walletAddress: "walletABC",
      namespace: {
        name: "alldomains",
        readableName: "ape.bonk",
        faviconURL: null,
        userProfileURL: null,
      },
    });

    expect(profile?.displayName).toBe("ape.bonk");
    expect(profile?.wallet).toBe("walletABC");
  });

  test("returns null when profile or wallet is missing", () => {
    expect(normalizeTapestryProfile(null)).toBeNull();
    expect(
      normalizeTapestryProfile({
        wallet: { address: "wallet_only" },
      } as any)
    ).toBeNull();
    expect(
      normalizeTapestryProfile({
        profile: {
          id: "id",
          namespace: "tapestry",
          created_at: Date.now(),
          username: "u",
        },
      } as any)
    ).toBeNull();
  });
});
