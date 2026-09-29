import { beforeEach, describe, expect, it, vi } from "vitest";

// Fresh-install preview: ?bt_preview=buyer alone (isPreviewDemoMode() ===
// false) must be a brand-new, zero-state buyer whose write actions (posting)
// still fully work and appear immediately, exactly like a real new account's
// first post would. This file exercises services/socialService.ts's own
// isBuyerDevPreview()-gated preview-post store (createPost/getMyPosts),
// which has no `demo=1` gate at all — it's write-through preview session
// state, not seeded demo content, so it must behave identically whether or
// not `demo=1` is set.

const { storage, serviceRequest, devPreviewMock } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  serviceRequest: vi.fn(),
  devPreviewMock: { isBuyerDevPreview: true },
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

vi.mock("@/lib/serviceConfig", () => ({ serviceRequest }));
vi.mock("@/lib/devPreview", () => ({
  isBuyerDevPreview: () => devPreviewMock.isBuyerDevPreview,
  isPreviewDemoMode: () => false,
}));

import { createPost, deletePost, getMyPosts, initSocialService, resetPreviewMyPostsForTests, socialKeysForUser } from "./socialService";

describe("socialService: buyer post creation in a fresh (non-demo) preview session", () => {
  const userId = "fresh-preview-buyer";

  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    devPreviewMock.isBuyerDevPreview = true;
    resetPreviewMyPostsForTests();
    initSocialService(userId);
  });

  it("starts with zero posts, like a brand-new account", async () => {
    const posts = await getMyPosts(socialKeysForUser(userId));
    expect(posts).toEqual([]);
  });

  it("posting in preview mode does not throw, and the new post appears immediately", async () => {
    const post = await createPost({
      type: "photo",
      caption: "first fit check",
      hashtags: ["#ootd"],
      mediaColors: ["#111111"],
      profileVisibility: "public",
    });
    expect(post.caption).toBe("first fit check");
    expect(post.isDraft).toBe(false);

    const posts = await getMyPosts(socialKeysForUser(userId));
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe(post.id);
  });

  it("a deleted preview post no longer appears", async () => {
    const post = await createPost({
      type: "photo", caption: "temp", hashtags: [], mediaColors: [], profileVisibility: "public",
    });
    await deletePost(post.id);
    const posts = await getMyPosts(socialKeysForUser(userId));
    expect(posts).toEqual([]);
  });

  it("outside preview mode, publishing still throws (feature not built for real accounts yet)", async () => {
    devPreviewMock.isBuyerDevPreview = false;
    await expect(createPost({
      type: "photo", caption: "x", hashtags: [], mediaColors: [], profileVisibility: "public",
    })).rejects.toThrow('Buyer post publishing is not available yet.');
  });
});
