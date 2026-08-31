import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, posts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `posts-owner-a-${suffix}`;
const sellerB = `posts-owner-b-${suffix}`;
const postIds: string[] = [];
const authState = vi.hoisted(() => ({ clerkUserId: "" }));
const videoStorage = vi.hoisted(() => ({
  nextId: 0,
  objects: new Map<string, { bytes: Buffer; contentType: string; owner: string; visibility: string }>(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(bytes: Buffer, contentType: string) {
      const path = `/objects/uploads/video-test-${++videoStorage.nextId}`;
      videoStorage.objects.set(path, { bytes, contentType, owner: "", visibility: "private" });
      return path;
    }
    async trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: string }) {
      const object = videoStorage.objects.get(path);
      if (!object) throw new Error("not found");
      Object.assign(object, policy);
      return path;
    }
    async getObjectEntityFile(path: string) {
      const object = videoStorage.objects.get(path);
      if (!object) throw new Error("not found");
      return {
        getMetadata: async () => [{ size: String(object.bytes.length), contentType: object.contentType }],
        download: async () => [object.bytes],
        __path: path,
      };
    }
    async canAccessObjectEntity({ userId, objectFile, requestedPermission }: any) {
      const object = videoStorage.objects.get(objectFile.__path);
      if (!object) return false;
      return object.visibility === "public" && requestedPermission === "read" || object.owner === userId;
    }
    async downloadObject(objectFile: any) {
      const object = videoStorage.objects.get(objectFile.__path)!;
      return new Response(object.bytes, { headers: { "Content-Type": object.contentType } });
    }
    async deleteObjectEntity(path: string) {
      videoStorage.objects.delete(path);
    }
    async getObjectEntityDownloadURL(path: string) {
      return `https://signed-preview.test/${encodeURIComponent(path)}`;
    }
  },
}));

vi.mock("node:child_process", async () => {
  const fs = await import("node:fs");
  return {
    execFile: (
      command: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      if (command === "ffprobe") {
        callback(null, { stdout: args.includes("stream=index") ? "0\n" : "1\n", stderr: "" });
        return;
      }
      fs.writeFileSync(args[args.length - 1], Buffer.from(command === "ffmpeg" ? "generated-media" : ""));
      callback(null, { stdout: "", stderr: "" });
    },
  };
});

let server: Server;
let base = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json() as any,
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: sellerA,
      email: `${sellerA}@test.local`,
      name: "Post Owner A",
      displayName: "Post Owner A",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: sellerB,
      email: `${sellerB}@test.local`,
      name: "Post Owner B",
      displayName: "Post Owner B",
      role: "seller",
      accountType: "seller",
    },
  ]);

  const [{ default: postsRouter }, { default: publicRouter }] = await Promise.all([
    import("../posts"),
    import("../public"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/posts", postsRouter);
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (postIds.length > 0) await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("seller post management", () => {
  it("uploads, composes, and publishes seller-owned video media", async () => {
    authState.clerkUserId = sellerA;
    const clipBytes = Buffer.concat([
      Buffer.alloc(4),
      Buffer.from("ftyp"),
      Buffer.from("isom-test-video"),
    ]);
    const uploadResponse = await fetch(`${base}/api/posts/video-clips`, {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: clipBytes,
    });
    expect(uploadResponse.status).toBe(201);
    const upload = await uploadResponse.json() as any;
    expect(upload.objectPath).toMatch(/^\/objects\/uploads\//);

    const composed = await request("/api/posts/compose-video", {
      method: "POST",
      body: JSON.stringify({
        clips: [{ objectPath: upload.objectPath, speed: 1, filter: "none" }],
        trimStart: 0,
        trimEnd: 1,
      }),
    });
    expect(composed.status).toBe(200);
    expect(composed.body.mediaPath).toMatch(/^\/objects\/uploads\//);
    expect(composed.body.thumbnailPath).toMatch(/^\/objects\/uploads\//);

    const published = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaUrl: composed.body.mediaUrl,
        thumbnailUrl: composed.body.thumbnailUrl,
        mediaPath: composed.body.mediaPath,
        thumbnailPath: composed.body.thumbnailPath,
        mediaType: "video",
        caption: "Composed video",
      }),
    });
    expect(published.status).toBe(201);
    expect(published.body.mediaUrl).toContain("/api/posts/media/");
    expect(published.body.mediaUrl).not.toContain("signed-preview.test");
    expect(published.body.mediaUrls).toEqual([published.body.mediaUrl]);
    expect(published.body.thumbnailUrl).toContain("/api/posts/media/");
    expect(published.body.thumbnailUrl).not.toContain("signed-preview.test");
    expect(videoStorage.objects.get(composed.body.mediaPath)?.visibility).toBe("public");
    expect(videoStorage.objects.get(composed.body.thumbnailPath)?.visibility).toBe("public");
    const publicPost = await request(`/api/posts/${published.body.id}`);
    expect(publicPost.status).toBe(200);
    expect(publicPost.body.mediaUrls).toEqual([published.body.mediaUrl]);
    expect(publicPost.body.mediaUrls.join(" ")).not.toContain("signed-preview.test");
    await db.delete(posts).where(eq(posts.id, published.body.id));
  });

  it("stores lifecycle state and keeps non-published posts private", async () => {
    authState.clerkUserId = sellerA;
    const draft = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        caption: "Work in progress",
        mediaUrl: "https://example.test/original.jpg",
        mediaUrls: ["https://example.test/original.jpg"],
        hashtags: ["draft"],
        styleTags: ["minimal"],
        aspectRatio: "1:1",
        sound: { soundId: "sound-1", soundTitle: "Original", artist: "Test", startTime: 0, volume: 0.5 },
        visibility: { isPublic: true, allowComments: false, allowReposts: true, showLikeCount: false },
        isDraft: true,
      }),
    });
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ caption: "Coming soon", mediaUrl: "", scheduledAt }),
    });
    const published = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ caption: "Live now", mediaUrl: "" }),
    });
    const privatePost = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        caption: "Not public",
        mediaUrl: "",
        visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true },
      }),
    });
    const repostRestricted = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        caption: "No reposts",
        mediaUrl: "",
        visibility: { isPublic: true, allowComments: true, allowReposts: false, showLikeCount: false },
      }),
    });
    postIds.push(draft.body.id, scheduled.body.id, published.body.id, privatePost.body.id, repostRestricted.body.id);

    expect(draft.body.postStatus).toBe("draft");
    expect(scheduled.body.postStatus).toBe("scheduled");
    expect(scheduled.body.scheduledAt).toBe(scheduledAt);
    expect(published.body.postStatus).toBe("published");

    expect((await request(`/api/posts/${draft.body.id}`)).status).toBe(404);
    expect((await request(`/api/posts/${scheduled.body.id}`)).status).toBe(404);
    expect((await request(`/api/posts/${published.body.id}`)).status).toBe(200);
    expect((await request(`/api/posts/${privatePost.body.id}`)).status).toBe(404);
    expect((await request(`/api/posts/${draft.body.id}/interact`, {
      method: "POST",
      body: JSON.stringify({ type: "like" }),
    })).status).toBe(404);
    expect((await request(`/api/posts/${privatePost.body.id}/interact`, {
      method: "POST",
      body: JSON.stringify({ type: "like" }),
    })).status).toBe(404);
    expect((await request(`/api/posts/${repostRestricted.body.id}/interact`, {
      method: "POST",
      body: JSON.stringify({ type: "repost" }),
    })).status).toBe(403);
    expect((await request(`/api/posts/${repostRestricted.body.id}`)).body.likeCount).toBeNull();

    const publicSeller = await request(`/api/public/sellers/${sellerA}`);
    expect(publicSeller.status).toBe(200);
    expect(publicSeller.body.posts.map((post: any) => post.id)).toEqual([
      repostRestricted.body.id,
      published.body.id,
    ]);

    const mine = await request("/api/posts/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.map((post: any) => post.id)).toEqual(expect.arrayContaining([
      draft.body.id,
      scheduled.body.id,
      published.body.id,
      privatePost.body.id,
      repostRestricted.body.id,
    ]));

    const invalidSchedule = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ caption: "Too late", mediaUrl: "", scheduledAt: new Date(Date.now() - 1000).toISOString() }),
    });
    expect(invalidSchedule.status).toBe(400);
  });

  it("allows only the owner to edit and delete a post", async () => {
    const ownedPostId = postIds[0];
    authState.clerkUserId = sellerB;
    expect((await request(`/api/posts/${ownedPostId}`, {
      method: "PATCH",
      body: JSON.stringify({ caption: "Not mine" }),
    })).status).toBe(404);
    expect((await request(`/api/posts/${ownedPostId}`, { method: "DELETE" })).status).toBe(404);
    expect((await request("/api/posts/mine")).body).toEqual([]);

    authState.clerkUserId = sellerA;
    const updated = await request(`/api/posts/${ownedPostId}`, {
      method: "PATCH",
      body: JSON.stringify({
        caption: "Ready to ship",
        mediaUrls: ["https://example.test/final-1.jpg", "https://example.test/final-2.jpg"],
        hashtags: ["launch"],
        styleTags: ["streetwear"],
        aspectRatio: "3:4",
        sound: { soundId: "sound-2", soundTitle: "Final", artist: "Test", startTime: 2, volume: 0.8 },
        visibility: { isPublic: true, allowComments: true, allowReposts: false, showLikeCount: true },
        isDraft: false,
        postStatus: "published",
      }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.caption).toBe("Ready to ship");
    expect(updated.body.postStatus).toBe("published");
    expect(updated.body.mediaUrls).toEqual([
      "https://example.test/final-1.jpg",
      "https://example.test/final-2.jpg",
    ]);
    expect(updated.body.hashtags).toEqual(["launch"]);
    expect(updated.body.styleTags).toEqual(["streetwear"]);
    expect(updated.body.aspectRatio).toBe("3:4");
    expect(updated.body.visibility.allowReposts).toBe(false);
    expect(updated.body.sound.soundId).toBe("sound-2");

    const reloaded = await request("/api/posts/mine");
    expect(reloaded.body.find((post: any) => post.id === ownedPostId)).toMatchObject({
      mediaUrls: ["https://example.test/final-1.jpg", "https://example.test/final-2.jpg"],
      hashtags: ["launch"],
      styleTags: ["streetwear"],
      aspectRatio: "3:4",
      visibility: { allowComments: true, allowReposts: false, showLikeCount: true },
      sound: { soundId: "sound-2" },
    });

    const archived = await request(`/api/posts/${ownedPostId}`, {
      method: "PATCH",
      body: JSON.stringify({ postStatus: "archived" }),
    });
    expect(archived.status).toBe(200);
    expect(archived.body.postStatus).toBe("archived");
    expect((await request("/api/posts/mine")).body.some(
      (post: any) => post.id === ownedPostId && post.postStatus === "archived",
    )).toBe(true);

    const restored = await request(`/api/posts/${ownedPostId}`, {
      method: "PATCH",
      body: JSON.stringify({ postStatus: "published", scheduledAt: null }),
    });
    expect(restored.status).toBe(200);
    expect(restored.body.postStatus).toBe("published");

    const deleted = await request(`/api/posts/${ownedPostId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    expect((await request("/api/posts/mine")).body.some((post: any) => post.id === ownedPostId)).toBe(false);
  });
});