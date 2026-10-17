import { beforeEach, describe, expect, it, vi } from "vitest";

// Items 75-81: a real account's delete / archive / restore / caption edit /
// like must reach the server and throw on failure (callers roll back and
// show the error) instead of quietly writing AsyncStorage.

const { storage, serviceRequest, devPreviewMock } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  serviceRequest: vi.fn(),
  devPreviewMock: { isBuyerDevPreview: false },
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
  isBuyerDevPreview: () => devPreviewMock.isBuyerDevPreview,
  isSellerDevPreview: () => false,
  isPreviewDemoMode: () => false,
}));

import {
  archivePost, createPost, deletePost, getMyArchivedPosts, getMyPosts, initSocialService, isOwnPost,
  likePost, MY_USER_ID, resetPreviewMyPostsForTests, socialKeysForUser, unarchivePost, updatePost,
} from "./socialService";

const userId = "user_real_123";
const postId = "11111111-2222-4333-8444-555555555555";

function lastCall() {
  const call = serviceRequest.mock.calls.at(-1)!;
  return { path: call[0] as string, method: call[1]?.method as string | undefined, body: call[1]?.body ? JSON.parse(call[1].body) : undefined };
}

describe("socialService post mutations (real account)", () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    devPreviewMock.isBuyerDevPreview = false;
    resetPreviewMyPostsForTests();
    initSocialService(userId);
  });

  it("deletePost soft-deletes on the server", async () => {
    serviceRequest.mockResolvedValueOnce({ id: postId, deleted: true });
    await deletePost(postId);
    expect(lastCall()).toMatchObject({ path: `/api/posts/${postId}`, method: "DELETE" });
  });

  it("deletePost throws when the server fails", async () => {
    serviceRequest.mockRejectedValueOnce(new Error("boom"));
    await expect(deletePost(postId)).rejects.toThrow("boom");
  });

  it("archivePost / unarchivePost PATCH postStatus and throw on failure", async () => {
    serviceRequest.mockResolvedValueOnce({ id: postId, postStatus: "archived" });
    await archivePost(postId);
    expect(lastCall()).toMatchObject({ path: `/api/posts/${postId}`, method: "PATCH", body: { postStatus: "archived" } });

    serviceRequest.mockResolvedValueOnce({ id: postId, postStatus: "published" });
    await unarchivePost(postId);
    expect(lastCall()).toMatchObject({ method: "PATCH", body: { postStatus: "published" } });

    serviceRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(archivePost(postId)).rejects.toThrow("offline");
    serviceRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(unarchivePost(postId)).rejects.toThrow("offline");
  });

  it("updatePost PATCHes the caption and returns the saved post", async () => {
    serviceRequest.mockResolvedValueOnce({ id: postId, userId, caption: "new caption", mediaType: "photo", postStatus: "published" });
    const saved = await updatePost(postId, { caption: "new caption" });
    expect(lastCall()).toMatchObject({ path: `/api/posts/${postId}`, method: "PATCH", body: { caption: "new caption" } });
    expect(saved?.caption).toBe("new caption");
    expect(saved?.authorId).toBe(userId);
  });

  it("updatePost surfaces a moderation rejection", async () => {
    serviceRequest.mockRejectedValueOnce(Object.assign(new Error("Not allowed. Edit your caption and try again."), { status: 422 }));
    await expect(updatePost(postId, { caption: "bad" })).rejects.toThrow(/Edit your caption/);
  });

  it("likePost sends the desired state to /interact", async () => {
    serviceRequest.mockResolvedValueOnce({ action: "liked", count: 4 });
    await expect(likePost(postId, true)).resolves.toEqual({ count: 4 });
    expect(lastCall()).toMatchObject({ path: `/api/posts/${postId}/interact`, method: "POST", body: { type: "like", value: "add" } });

    serviceRequest.mockResolvedValueOnce({ action: "unliked", count: 3 });
    await likePost(postId, false);
    expect(lastCall().body).toEqual({ type: "like", value: "remove" });

    serviceRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(likePost(postId, true)).rejects.toThrow("offline");
  });

  it("getMyArchivedPosts reads /api/posts/mine?status=archived", async () => {
    serviceRequest.mockResolvedValueOnce([
      { id: postId, userId, caption: "old fit", mediaType: "photo", mediaUrls: ["https://cdn.test/a.jpg"], postStatus: "archived", likesCount: 2 },
    ]);
    const archived = await getMyArchivedPosts(socialKeysForUser(userId));
    expect(lastCall().path).toBe("/api/posts/mine?status=archived");
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ id: postId, isArchived: true, caption: "old fit", mediaUrl: "https://cdn.test/a.jpg", likesCount: 2 });
  });

  it("isOwnPost matches the Clerk user id or the preview author id", () => {
    expect(isOwnPost({ authorId: userId }, userId)).toBe(true);
    expect(isOwnPost({ authorId: MY_USER_ID }, null)).toBe(true);
    expect(isOwnPost({ authorId: "someone_else" }, userId)).toBe(false);
    expect(isOwnPost(null, userId)).toBe(false);
  });
});

describe("socialService post mutations (fresh preview session)", () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    devPreviewMock.isBuyerDevPreview = true;
    resetPreviewMyPostsForTests();
    initSocialService("preview-user");
  });

  it("archive / restore / edit / like stay in the preview store and never call the server", async () => {
    const post = await createPost({ type: "photo", caption: "first", hashtags: [], mediaColors: [], profileVisibility: "public" });
    await archivePost(post.id);
    expect((await getMyArchivedPosts()).map((p) => p.id)).toEqual([post.id]);
    await unarchivePost(post.id);
    expect(await getMyArchivedPosts()).toEqual([]);
    await updatePost(post.id, { caption: "edited" });
    await likePost(post.id, true);
    const [mine] = await getMyPosts(socialKeysForUser("preview-user"));
    expect(mine).toMatchObject({ caption: "edited", likedByMe: true, likesCount: 1 });
    expect(serviceRequest).not.toHaveBeenCalled();
  });
});
