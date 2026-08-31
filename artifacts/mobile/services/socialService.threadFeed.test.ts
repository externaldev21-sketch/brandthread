import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRequest } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {},
}));

vi.mock("@/lib/serviceConfig", () => ({
  serviceRequest,
}));

import { getThreadPosts } from "./socialService";

type ApiPost = {
  id: string;
  userId: string;
  brandName: string;
  createdAt: string;
};

function post(id: string, brandName = "Northstar"): ApiPost {
  return {
    id,
    userId: `${brandName.toLowerCase()}-seller`,
    brandName,
    createdAt: "2026-08-31T12:00:00.000Z",
  };
}

describe("Thread feed personalization", () => {
  beforeEach(() => {
    serviceRequest.mockReset();
  });

  it("keeps followed-seller posts first, adds general posts after them, and removes duplicates", async () => {
    serviceRequest.mockImplementation((path: string) => {
      if (path.startsWith("/api/posts/feed")) {
        return Promise.resolve([
          post("followed-1", "Followed One"),
          post("shared", "Followed Two"),
          post("followed-1", "Followed One"),
        ]);
      }
      return Promise.resolve([
        post("shared", "Followed Two"),
        post("general-1", "General One"),
      ]);
    });

    const posts = await getThreadPosts();

    expect(posts.map(({ id }) => id)).toEqual([
      "followed-1",
      "shared",
      "general-1",
    ]);
    expect(serviceRequest).toHaveBeenCalledWith("/api/posts/feed?limit=30&offset=0");
    expect(serviceRequest).toHaveBeenCalledWith("/api/public/posts?limit=30&offset=0");
  });

  it("falls back to the public feed when the personalized response is empty", async () => {
    serviceRequest.mockImplementation((path: string) => {
      if (path.startsWith("/api/posts/feed")) return Promise.resolve([]);
      return Promise.resolve([post("public-1", "Public One")]);
    });

    const posts = await getThreadPosts();

    expect(posts.map(({ id }) => id)).toEqual(["public-1"]);
  });

  it("falls back to the public feed when the personalized response fails", async () => {
    serviceRequest.mockImplementation((path: string) => {
      if (path.startsWith("/api/posts/feed")) {
        return Promise.reject(new Error("personalized feed unavailable"));
      }
      return Promise.resolve([post("public-1", "Public One")]);
    });

    const posts = await getThreadPosts();

    expect(posts.map(({ id }) => id)).toEqual(["public-1"]);
  });
});