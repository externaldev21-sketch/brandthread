/**
 * DM media privacy, end to end through the conversations router (real DB,
 * object storage mocked):
 *  - upload-media stores a private object and hands back a signed URL;
 *  - posting a message with that signed URL stores the CANONICAL object path,
 *    never the expiring signed URL;
 *  - participants read the message back with a signed URL; a non-participant
 *    gets nothing (403), so can never obtain one;
 *  - messages sent before this change (permanent public bucket URLs) still
 *    render unchanged;
 *  - a message cannot reference some other private object (so it can never
 *    make the server sign it).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, users, conversations, conversationParticipants, messages } from "@workspace/db";

const state = vi.hoisted(() => ({ signCalls: 0, saved: [] as string[] }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const header = req.header("x-test-user-id");
    if (!header) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = header;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => {
  class ObjectStorageService {
    async createObjectEntityFromBuffer(_b: Buffer, _contentType: string, objectPath: string) {
      state.saved.push(objectPath);
      return objectPath;
    }
    async getObjectEntityDownloadURL(objectPath: string, ttlSec: number) {
      state.signCalls += 1;
      return `https://storage.googleapis.com/test-bucket/.private/${objectPath.slice("/objects/".length)}?X-Goog-Expires=${ttlSec}&X-Goog-Signature=sig${state.signCalls}`;
    }
    async deleteObjectEntity() { /* no-op */ }
    async getObjectEntityFile() { throw new Error("not in tests"); }
  }
  return {
    ObjectStorageService,
    ObjectNotFoundError: class extends Error {},
    objectStorageClient: { bucket: () => ({ file: () => ({}) }) },
  };
});

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const A = `dm-media-a-${suffix}`;
const B = `dm-media-b-${suffix}`;
const C = `dm-media-outsider-${suffix}`;
const ALL = [A, B, C];
let conversationId = "";
let server: Server;
let base = "";
const savedEnv = {
  bucket: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
  dir: process.env.PRIVATE_OBJECT_DIR,
  mod: process.env.MEDIA_MODERATION_ENABLED,
};

async function call(method: string, path: string, userId: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// "ID3" header — a valid audio/mpeg upload that needs no image decoding.
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);

beforeAll(async () => {
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "test-bucket";
  process.env.PRIVATE_OBJECT_DIR = "/test-bucket/.private";
  process.env.MEDIA_MODERATION_ENABLED = "false";

  await db.insert(users).values(ALL.map((id) => ({
    clerkId: id, email: `${id}@example.test`, name: id, displayName: id, accountType: "buyer", onboardingComplete: true,
  })));
  const [conv] = await db.insert(conversations).values({ type: "buyer_to_buyer", isRequest: false }).returning();
  conversationId = conv.id;
  await db.insert(conversationParticipants).values([A, B].map((userId) => ({
    conversationId, userId, name: userId, handle: `@${userId}`, initials: "DM", color: "#111111", accountType: "buyer",
  })));

  const { default: conversationsRouter } = await import("../conversations");
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/conversations", conversationsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (conversationId) {
    await db.delete(messages).where(eq(messages.conversationId, conversationId));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, conversationId));
    await db.delete(conversations).where(eq(conversations.id, conversationId));
  }
  await db.delete(users).where(inArray(users.clerkId, ALL));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = savedEnv.bucket;
  process.env.PRIVATE_OBJECT_DIR = savedEnv.dir;
  process.env.MEDIA_MODERATION_ENABLED = savedEnv.mod;
});

describe("DM media privacy", () => {
  let uploaded: { url: string; objectPath: string };
  let messageId = "";

  it("upload-media stores a private object and returns a signed URL", async () => {
    const res = await call("POST", "/api/conversations/upload-media", A, { data: MP3.toString("base64"), mimeType: "audio/mpeg" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    uploaded = res.body;
    expect(uploaded.objectPath).toMatch(new RegExp(`^/objects/messaging/${A}/[0-9a-f-]{36}\\.mp3$`));
    expect(state.saved).toContain(uploaded.objectPath);
    expect(uploaded.url).toContain("X-Goog-Signature=");
  });

  it("posting the signed URL stores the canonical path and responds with a signed URL", async () => {
    const res = await call("POST", `/api/conversations/${conversationId}/messages`, A, {
      text: "",
      attachment: { type: "voice", uri: uploaded.url, title: "Voice message", meta: { duration: "3" } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    messageId = res.body.id;
    // Same URL the uploader is already showing (cached signature) — no flicker.
    expect(res.body.attachment.uri).toBe(uploaded.url);
    const [row] = await db.select().from(messages).where(eq(messages.id, messageId));
    expect((row.attachment as any).uri).toBe(uploaded.objectPath);
    expect((row.attachments as any[])[0].uri).toBe(uploaded.objectPath);
  });

  it("accepts the canonical objectPath and normalizes multi-photo meta.photoUris", async () => {
    const second = await call("POST", "/api/conversations/upload-media", A, { data: MP3.toString("base64"), mimeType: "audio/mpeg" });
    const res = await call("POST", `/api/conversations/${conversationId}/messages`, A, {
      text: "",
      attachment: {
        type: "image", uri: uploaded.objectPath, title: "2 photos",
        meta: { photoUris: JSON.stringify([uploaded.objectPath, second.body.url]) },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [row] = await db.select().from(messages).where(eq(messages.id, res.body.id));
    expect(JSON.parse((row.attachment as any).meta.photoUris)).toEqual([uploaded.objectPath, second.body.objectPath]);
    const returned = JSON.parse(res.body.attachment.meta.photoUris) as string[];
    expect(returned.every((u) => u.includes("X-Goog-Signature="))).toBe(true);
  });

  it("the other participant reads it back as a signed URL", async () => {
    const res = await call("GET", `/api/conversations/${conversationId}/messages`, B);
    expect(res.status).toBe(200);
    const msg = res.body.find((m: any) => m.id === messageId);
    expect(msg.attachment.uri).toContain(`/test-bucket/.private/messaging/${A}/`);
    expect(msg.attachment.uri).toContain("X-Goog-Signature=");
    expect(msg.attachments[0].uri).toBe(msg.attachment.uri);
    expect(JSON.stringify(res.body)).not.toContain(`"/objects/messaging/`);
  });

  it("a non-participant cannot read the thread, so never gets a signed URL", async () => {
    const before = state.signCalls;
    const res = await call("GET", `/api/conversations/${conversationId}/messages`, C);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("X-Goog-Signature");
    expect(state.signCalls).toBe(before);
  });

  it("old messages holding a public bucket URL still render unchanged", async () => {
    const legacyUrl = `https://storage.googleapis.com/test-bucket/messaging/${A}/${crypto.randomUUID()}.jpg`;
    const legacyAtt = { type: "image", uri: legacyUrl, title: "Photo", meta: { photoUris: JSON.stringify([legacyUrl]) } };
    const [legacy] = await db.insert(messages).values({
      conversationId, senderId: A, senderName: A, senderInitials: "DM", senderColor: "#111111",
      body: "", attachment: legacyAtt, attachments: [legacyAtt], status: "sent",
    }).returning();
    const res = await call("GET", `/api/conversations/${conversationId}/messages`, B);
    const msg = res.body.find((m: any) => m.id === legacy.id);
    expect(msg.attachment.uri).toBe(legacyUrl);
    expect(msg.attachment.meta.photoUris).toBe(JSON.stringify([legacyUrl]));
    // ...and forwarding / re-sending such a URL keeps working.
    const resend = await call("POST", `/api/conversations/${conversationId}/messages`, B, {
      text: "", attachment: { type: "image", uri: legacyUrl, title: "Photo" },
    });
    expect(resend.status, JSON.stringify(resend.body)).toBe(201);
    expect(resend.body.attachment.uri).toBe(legacyUrl);
  });

  it("refuses attachments pointing at other private objects or foreign hosts", async () => {
    for (const uri of [
      "/objects/uploads/some-review-photo",
      "https://storage.googleapis.com/test-bucket/.private/uploads/abc?X-Goog-Signature=x",
      "https://storage.googleapis.com/test-bucket/other/file.jpg?X-Goog-Signature=x",
      "https://evil.example/x.jpg",
    ]) {
      const res = await call("POST", `/api/conversations/${conversationId}/messages`, A, {
        text: "", attachment: { type: "image", uri, title: "Photo" },
      });
      expect(res.status, uri).toBe(400);
    }
  });
});
