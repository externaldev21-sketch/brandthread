import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Regression test for the /api/conversations/upload-media endpoint: mimeType
// and extension are attacker-controlled request fields. Before this fix, the
// extension was taken verbatim from the request body (only a leading "."
// was stripped) and the Content-Type set on the stored object came straight
// from the client, so a caller could smuggle arbitrary characters (including
// "/") into the generated object key and store a file under any declared
// content type. The route now derives the extension from a fixed allowlist
// of supported mimeTypes and rejects anything else.

//
// DM media privacy: uploads are stored PRIVATE (createObjectEntityFromBuffer,
// never makePublic) under /objects/messaging/<uid>/, and the response carries
// a short-lived signed URL plus the canonical objectPath.

const state = vi.hoisted(() => ({
  userId: "buyer-1",
  savedFiles: [] as Array<{ filename: string; contentType: string; cacheControl?: string }>,
  madePublic: 0,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => {
  class ObjectStorageService {
    async createObjectEntityFromBuffer(_b: Buffer, contentType: string, objectPath: string, opts: { cacheControl?: string } = {}) {
      state.savedFiles.push({ filename: objectPath, contentType, cacheControl: opts.cacheControl });
      return objectPath;
    }
    async getObjectEntityDownloadURL(objectPath: string, ttlSec: number) {
      return `https://storage.googleapis.com/test-bucket/.private/${objectPath.slice("/objects/".length)}?X-Goog-Expires=${ttlSec}&X-Goog-Signature=sig`;
    }
    async deleteObjectEntity() { /* no-op */ }
  }
  return {
    ObjectStorageService,
    ObjectNotFoundError: class extends Error {},
    objectStorageClient: {
      bucket: () => ({ file: () => ({ save: async () => undefined, makePublic: async () => { state.madePublic += 1; } }) }),
    },
  };
});

// The rest of conversations.ts pulls in a lot of db-backed routes we don't
// exercise here; stub just enough for the module to load.
vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  desc: (v: unknown) => v,
  eq: (...v: unknown[]) => v,
  inArray: (...v: unknown[]) => v,
  or: (...c: unknown[]) => c,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ kind: "sql", strings: Array.from(strings), values }),
}));
vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : String(key)),
  });
  return new Proxy({ db: {} }, { get: (target, key) => (key in target ? (target as any)[key] : table(String(key))) });
});
vi.mock("../../lib/contentModerator", () => ({ moderateMessage: () => ({ allowed: true }) }));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

import conversationsRouter from "../conversations";

let server: Server;
let base = "";
// Minimal valid PNG header (8-byte signature + IHDR start) — enough for the magic-byte check.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "100mb" }));
  app.use("/api/conversations", conversationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/conversations/upload-media", () => {
  const originalBucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const originalPrivateDir = process.env.PRIVATE_OBJECT_DIR;
  const originalModeration = process.env.MEDIA_MODERATION_ENABLED;

  beforeEach(() => {
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "test-bucket";
    process.env.PRIVATE_OBJECT_DIR = "/test-bucket/.private";
    process.env.MEDIA_MODERATION_ENABLED = "false";
    state.savedFiles = [];
    state.madePublic = 0;
  });

  afterEach(() => {
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = originalBucketId;
    process.env.PRIVATE_OBJECT_DIR = originalPrivateDir;
    process.env.MEDIA_MODERATION_ENABLED = originalModeration;
  });

  it("rejects a mimeType that is not on the allowlist", async () => {
    const response = await fetch(`${base}/api/conversations/upload-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: Buffer.from("hello").toString("base64"),
        mimeType: "application/x-msdownload",
      }),
    });
    expect(response.status).toBe(400);
    expect(state.savedFiles).toHaveLength(0);
  });

  it("never lets an attacker-supplied extension escape the generated object key", async () => {
    const response = await fetch(`${base}/api/conversations/upload-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: PNG_BYTES.toString("base64"),
        mimeType: "image/png",
        // Legacy field — no longer read by the route at all.
        extension: "../../../etc/passwd",
      }),
    });
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(state.savedFiles).toHaveLength(1);
    const saved = state.savedFiles[0];
    expect(saved.filename).toMatch(/^\/objects\/messaging\/buyer-1\/[0-9a-f-]{36}\.png$/);
    expect(saved.filename).not.toContain("..");
    expect(saved.contentType).toBe("image/png");
  });

  it("stores the upload privately and returns a signed URL + canonical objectPath", async () => {
    const response = await fetch(`${base}/api/conversations/upload-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: PNG_BYTES.toString("base64"), mimeType: "image/png" }),
    });
    const body = await response.json() as { url: string; objectPath: string };
    expect(response.status).toBe(200);
    expect(state.madePublic).toBe(0);
    expect(state.savedFiles[0].cacheControl).toMatch(/^private/);
    expect(body.objectPath).toBe(state.savedFiles[0].filename);
    // The client renders `url` immediately: a signed (expiring) URL for that object, ~1h.
    expect(body.url).toContain(`/test-bucket/.private/${body.objectPath.slice("/objects/".length)}?`);
    expect(body.url).toContain("X-Goog-Signature=");
    expect(body.url).toContain("X-Goog-Expires=3600");
  });

  it("returns 503 when private object storage is not configured", async () => {
    delete process.env.PRIVATE_OBJECT_DIR;
    const response = await fetch(`${base}/api/conversations/upload-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: PNG_BYTES.toString("base64"), mimeType: "image/png" }),
    });
    expect(response.status).toBe(503);
    expect(state.savedFiles).toHaveLength(0);
  });

  it("rejects non-base64 payloads", async () => {
    const response = await fetch(`${base}/api/conversations/upload-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "not-base64!!!", mimeType: "image/png" }),
    });
    expect(response.status).toBe(400);
    expect(state.savedFiles).toHaveLength(0);
  });
});
