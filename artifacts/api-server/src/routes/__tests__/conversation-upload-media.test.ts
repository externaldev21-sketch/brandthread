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

const state = vi.hoisted(() => ({
  userId: "buyer-1",
  savedFiles: [] as Array<{ filename: string; contentType: string }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  objectStorageClient: {
    bucket: () => ({
      file: (filename: string) => ({
        save: async (_buffer: Buffer, opts: { contentType: string }) => {
          state.savedFiles.push({ filename, contentType: opts.contentType });
        },
        makePublic: async () => undefined,
      }),
    }),
  },
}));

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

  beforeEach(() => {
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "test-bucket";
    state.savedFiles = [];
  });

  afterEach(() => {
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = originalBucketId;
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
        data: Buffer.from("hello").toString("base64"),
        mimeType: "image/png",
        // Legacy field — no longer read by the route at all.
        extension: "../../../etc/passwd",
      }),
    });
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(state.savedFiles).toHaveLength(1);
    const saved = state.savedFiles[0];
    expect(saved.filename).toMatch(/^messaging\/buyer-1\/[0-9a-f-]{36}\.png$/);
    expect(saved.filename).not.toContain("..");
    expect(saved.contentType).toBe("image/png");
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
