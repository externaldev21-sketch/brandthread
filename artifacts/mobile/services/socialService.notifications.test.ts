import { beforeEach, describe, expect, it, vi } from "vitest";

// Items 86, 90-92: notification mute / clear read / mark unread and saved-post
// removal must reach the server (and throw on failure) — local-only writes
// were overwritten by the next refetch.

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
  clearAllReadNotifications, initSocialService, markNotificationUnread, muteNotificationCategory,
  removeSavedItem, saveItem,
} from "./socialService";

function calls() {
  return serviceRequest.mock.calls.map((call) => ({
    path: call[0] as string,
    method: (call[1]?.method as string | undefined) ?? "GET",
    body: call[1]?.body ? JSON.parse(call[1].body) : undefined,
  }));
}

describe("socialService notifications + saves (real account)", () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    devPreviewMock.isBuyerDevPreview = false;
    initSocialService("user_real_123");
    serviceRequest.mockImplementation(async (path: string) => (path === "/api/buyer/notifications" ? [] : { ok: true }));
  });

  it("92: mark unread PATCHes the server", async () => {
    await markNotificationUnread("n1");
    expect(calls()[0]).toMatchObject({ path: "/api/buyer/notifications/n1/unread", method: "PATCH" });
  });

  it("90: mute / unmute a category goes to the server", async () => {
    await muteNotificationCategory("orders");
    await muteNotificationCategory("orders", false);
    const posts = calls().filter((c) => c.method === "POST");
    expect(posts.map((c) => [c.path, c.body])).toEqual([
      ["/api/buyer/notifications/mute-category", { category: "orders", muted: true }],
      ["/api/buyer/notifications/mute-category", { category: "orders", muted: false }],
    ]);
  });

  it("91: clear read DELETEs read rows (optionally per category), never read-all", async () => {
    await clearAllReadNotifications();
    await clearAllReadNotifications("social");
    const deletes = calls().filter((c) => c.method === "DELETE").map((c) => c.path);
    expect(deletes).toEqual(["/api/buyer/notifications/read", "/api/buyer/notifications/read?category=social"]);
    expect(calls().some((c) => c.path.includes("read-all"))).toBe(false);
  });

  it("surfaces server failures instead of faking success", async () => {
    serviceRequest.mockRejectedValue(new Error("offline"));
    await expect(markNotificationUnread("n1")).rejects.toThrow("offline");
    await expect(muteNotificationCategory("social")).rejects.toThrow("offline");
    await expect(clearAllReadNotifications()).rejects.toThrow("offline");
    await expect(removeSavedItem("p1")).rejects.toThrow("offline");
    await expect(saveItem({ type: "post", targetId: "p1", title: "x" })).rejects.toThrow("offline");
  });

  it("86: unsave calls DELETE /api/buyer/saved/:id", async () => {
    await removeSavedItem("p1");
    expect(calls()[0]).toMatchObject({ path: "/api/buyer/saved/p1", method: "DELETE" });
  });
});
