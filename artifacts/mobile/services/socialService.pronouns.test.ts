import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, serviceRequest } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  serviceRequest: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));

vi.mock("@/lib/serviceConfig", () => ({ serviceRequest }));

vi.mock("@/lib/devPreview", () => ({
  isBuyerDevPreview: () => false,
  isSellerDevPreview: () => false,
  isPreviewDemoMode: () => false,
}));

import { getMyProfile, hydrateMyProfileFromAccount, initSocialService, socialKeysForUser, updateMyProfile } from "./socialService";

const userId = "buyer-pronouns";

describe("pronouns sync", () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    initSocialService(userId);
  });

  it("sends pronouns to the account and keeps the local cache", async () => {
    serviceRequest.mockResolvedValue({});
    await updateMyProfile({ pronouns: " she/her " }, socialKeysForUser(userId));
    expect(serviceRequest).toHaveBeenCalledWith("/api/auth/profile", {
      method: "PATCH",
      body: JSON.stringify({ pronouns: "she/her" }),
    });
    expect((await getMyProfile(socialKeysForUser(userId))).pronouns).toBe(" she/her ");
  });

  it("does not call the server when pronouns are not part of the update", async () => {
    await updateMyProfile({ bio: "hi" }, socialKeysForUser(userId));
    expect(serviceRequest).not.toHaveBeenCalled();
  });

  it("keeps the local copy when the server is unreachable", async () => {
    serviceRequest.mockRejectedValue(new Error("offline"));
    const next = await updateMyProfile({ pronouns: "they/them" }, socialKeysForUser(userId));
    expect(next.pronouns).toBe("they/them");
  });

  it("hydrates pronouns from the account on sign-in", async () => {
    const profile = await hydrateMyProfileFromAccount(
      { userId, name: "Avery", username: "avery", pronouns: "he/him" },
      socialKeysForUser(userId),
    );
    expect(profile.pronouns).toBe("he/him");
  });
});
