import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => storage.delete(key));
    }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));

vi.mock("@/lib/serviceConfig", () => ({
  serviceRequest: vi.fn(),
}));

import {
  getMyProfile,
  hydrateMyProfileFromAccount,
  initSocialService,
  socialKeysForUser,
} from "./socialService";

const userId = "buyer-provisioned-identity";
const profileKey = `bt:social:${userId}:profile:v1`;

describe("provisioned buyer identity hydration", () => {
  beforeEach(() => {
    storage.clear();
    initSocialService(userId);
  });

  it("replaces an empty profile with the authenticated buyer identity", async () => {
    const profile = await hydrateMyProfileFromAccount(
      {
        userId,
        name: "Avery Stone",
        username: "@averystone",
        bio: "Finding the next great drop",
      },
      socialKeysForUser(userId),
    );

    expect(profile).toMatchObject({
      id: userId,
      userId,
      name: "Avery Stone",
      username: "averystone",
      bio: "Finding the next great drop",
      avatarInitials: "AS",
    });
    expect(JSON.parse(storage.get(profileKey)!)).toMatchObject({
      name: "Avery Stone",
      username: "averystone",
    });
  });

  it("replaces the legacy Jordan demo profile with the provisioned identity", async () => {
    storage.set(
      profileKey,
      JSON.stringify({
        id: "me",
        userId,
        accountType: "buyer",
        name: "Jordan",
        username: "jordan",
        pronouns: "",
        bio: "Demo profile",
        website: "",
        location: "",
        avatarColor: "#C7CDD5",
        avatarInitials: "J",
        profileVisibility: "public",
        postsCount: 0,
        friendsCount: 0,
        savedCount: 0,
        followingBrandsCount: 0,
        createdAt: "2026-08-31T00:00:00.000Z",
      }),
    );

    const profile = await hydrateMyProfileFromAccount(
      { userId, name: "Mila Chen", username: "milachen", bio: null },
      socialKeysForUser(userId),
    );

    expect(profile).toMatchObject({
      id: userId,
      userId,
      name: "Mila Chen",
      username: "milachen",
      bio: "",
      avatarInitials: "MC",
    });
    expect(profile.name).not.toBe("Jordan");
    expect(profile.username).not.toBe("jordan");
    expect((await getMyProfile(socialKeysForUser(userId))).name).toBe("Mila Chen");
  });
});