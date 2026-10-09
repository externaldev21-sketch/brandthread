import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  MAX_OPEN_UPLOAD_SESSIONS,
  UPLOAD_SESSION_MAX_BYTES,
  UPLOAD_SESSION_TTL_MS,
  isSessionExpired,
  ownerSessionsDir,
  sweepOwnerSessions,
  acceptUploadSession,
  completedChunks,
  contentTypeAllowed,
  createUploadSessionRouter,
  expectedChunkSize,
  validateSessionStart,
  type UploadSessionStorage,
} from "../uploadSessions";

// In-memory stand-in for ObjectStorageService (no GCS, no DB).
class MemoryStorage implements UploadSessionStorage {
  objects = new Map<string, Buffer>();
  async createObjectEntityFromBuffer(contents: Buffer, _type: string, objectPath = `/objects/x/${this.objects.size}`) {
    this.objects.set(objectPath, Buffer.from(contents));
    return objectPath;
  }
  async getObjectEntityFile(objectPath: string) {
    const data = this.objects.get(objectPath);
    return {
      download: async (opts?: { start?: number; end?: number }): Promise<[Buffer]> => {
        if (!data) throw new Error("not found");
        return [opts ? data.subarray(opts.start ?? 0, (opts.end ?? data.length - 1) + 1) : data];
      },
    };
  }
  async listObjectEntities(prefix: string) {
    return [...this.objects.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([objectPath, b]) => ({ objectPath, size: b.length }));
  }
  async combineObjectEntities(parts: string[], dest: string) {
    this.objects.set(dest, Buffer.concat(parts.map((p) => this.objects.get(p)!)));
  }
  async deleteObjectEntity(objectPath: string) {
    this.objects.delete(objectPath);
  }
}

const CHUNK = 4;
const state = { user: "user-a" as string | undefined, now: 1_000_000 };
const storage = new MemoryStorage();
let server: Server;
let base = "";
let received: { body: Buffer; type: string } | null = null;

beforeAll(async () => {
  const app = express();
  const opts = { storage, actorId: () => state.user, now: () => state.now };
  app.use("/sessions", createUploadSessionRouter({ ...opts, chunkSize: CHUNK }));
  app.post(
    "/target",
    acceptUploadSession({ ...opts, allowedTypes: ["image/*"], maxBytes: 10 }),
    express.raw({ type: "image/*", limit: 10 }),
    (req, res) => {
      received = { body: req.body as Buffer, type: String(req.headers["content-type"]) };
      res.status(201).json({ ok: true });
    },
  );
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { state.user = "user-a"; state.now = 1_000_000; received = null; storage.objects.clear(); });

const json = (path: string, method: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const putChunk = (id: string, index: number, bytes: Buffer) =>
  fetch(`${base}/sessions/${id}/chunks/${index}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes });

describe("pure helpers", () => {
  it("validates start requests", () => {
    expect(validateSessionStart({ contentType: "video/mp4", size: 9 }, 4)).toEqual({ ok: true, contentType: "video/mp4", size: 9, chunkSize: 4, totalChunks: 3 });
    expect(validateSessionStart({ contentType: "text/html", size: 9 })).toMatchObject({ ok: false, status: 415 });
    expect(validateSessionStart({ contentType: "image/png", size: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(validateSessionStart({ contentType: "image/png", size: UPLOAD_SESSION_MAX_BYTES + 1 })).toMatchObject({ ok: false, status: 400 });
    expect(validateSessionStart({ contentType: "image/png", size: 1.5 })).toMatchObject({ ok: false, status: 400 });
  });

  it("matches exact and wildcard content types", () => {
    expect(contentTypeAllowed("image/png; charset=x", ["image/*"])).toBe(true);
    expect(contentTypeAllowed("video/mp4", ["image/*"])).toBe(false);
    expect(contentTypeAllowed("application/pdf", ["image/*", "application/pdf"])).toBe(true);
    expect(contentTypeAllowed("", ["image/*"])).toBe(false);
  });

  it("computes chunk sizes and completed chunks", () => {
    const meta = { owner: "u", contentType: "image/png", size: 9, chunkSize: 4, totalChunks: 3, createdAt: 0 };
    expect([0, 1, 2].map((i) => expectedChunkSize(meta, i))).toEqual([4, 4, 1]);
    expect(completedChunks(meta, [
      { objectPath: "/s/p000002", size: 1 },
      { objectPath: "/s/p000000", size: 3 }, // short: not complete
      { objectPath: "/s/p000001", size: 4 },
      { objectPath: "/s/meta.json", size: 40 },
    ])).toEqual([1, 2]);
  });
});

describe("session lifecycle", () => {
  it("uploads in chunks, resumes, completes and hands off to a route", async () => {
    const file = Buffer.from("abcdefghi");
    const start = await json("/sessions", "POST", { contentType: "image/png", size: file.length });
    expect(start.status).toBe(201);
    const { uploadId, chunkSize, totalChunks } = await start.json() as { uploadId: string; chunkSize: number; totalChunks: number };
    expect([chunkSize, totalChunks]).toEqual([4, 3]);

    expect((await putChunk(uploadId, 2, file.subarray(8))).status).toBe(200);
    expect((await putChunk(uploadId, 0, file.subarray(0, 3))).status).toBe(400); // wrong size

    const status = await (await json(`/sessions/${uploadId}`, "GET")).json() as { received: number[] };
    expect(status.received).toEqual([2]);

    const early = await json(`/sessions/${uploadId}/complete`, "POST");
    expect(early.status).toBe(409);
    expect((await early.json() as { missing: number[] }).missing).toEqual([0, 1]);

    await putChunk(uploadId, 0, file.subarray(0, 4));
    await putChunk(uploadId, 1, file.subarray(4, 8));
    expect((await json(`/sessions/${uploadId}/complete`, "POST")).status).toBe(200);
    // complete is idempotent
    expect((await json(`/sessions/${uploadId}/complete`, "POST")).status).toBe(200);

    const handoff = await fetch(`${base}/target`, { method: "POST", headers: { "X-Upload-Id": uploadId } });
    expect(handoff.status).toBe(201);
    expect(received?.body.toString()).toBe("abcdefghi");
    expect(received?.type).toBe("image/png");
    await new Promise((r) => setTimeout(r, 20));
    expect([...storage.objects.keys()].some((k) => k.includes(uploadId))).toBe(false);
  });

  it("keeps normal single-shot bodies working", async () => {
    const res = await fetch(`${base}/target`, { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.from("xyz") });
    expect(res.status).toBe(201);
    expect(received?.body.toString()).toBe("xyz");
  });

  it("refuses other people's sessions, expired sessions, wrong types and oversize files", async () => {
    const start = await (await json("/sessions", "POST", { contentType: "image/png", size: 2 })).json() as { uploadId: string };
    await putChunk(start.uploadId, 0, Buffer.from("ok"));
    await json(`/sessions/${start.uploadId}/complete`, "POST");

    state.user = "user-b";
    expect((await json(`/sessions/${start.uploadId}`, "GET")).status).toBe(404);
    expect((await fetch(`${base}/target`, { method: "POST", headers: { "X-Upload-Id": start.uploadId } })).status).toBe(404);
    state.user = "user-a";

    state.now += UPLOAD_SESSION_TTL_MS + 1;
    expect((await json(`/sessions/${start.uploadId}`, "GET")).status).toBe(410);
    state.now = 1_000_000;

    const video = await (await json("/sessions", "POST", { contentType: "video/mp4", size: 1 })).json() as { uploadId: string };
    await putChunk(video.uploadId, 0, Buffer.from("v"));
    await json(`/sessions/${video.uploadId}/complete`, "POST");
    expect((await fetch(`${base}/target`, { method: "POST", headers: { "X-Upload-Id": video.uploadId } })).status).toBe(415);

    const big = await (await json("/sessions", "POST", { contentType: "image/png", size: 11 })).json() as { uploadId: string };
    await putChunk(big.uploadId, 0, Buffer.from("aaaa"));
    await putChunk(big.uploadId, 1, Buffer.from("bbbb"));
    await putChunk(big.uploadId, 2, Buffer.from("ccc"));
    await json(`/sessions/${big.uploadId}/complete`, "POST");
    expect((await fetch(`${base}/target`, { method: "POST", headers: { "X-Upload-Id": big.uploadId } })).status).toBe(413);
  });

  it("rejects a hand-off of an incomplete session and a request with both a body and an id", async () => {
    const s = await (await json("/sessions", "POST", { contentType: "image/png", size: 2 })).json() as { uploadId: string };
    expect((await fetch(`${base}/target`, { method: "POST", headers: { "X-Upload-Id": s.uploadId } })).status).toBe(409);
    const both = await fetch(`${base}/target`, { method: "POST", headers: { "X-Upload-Id": s.uploadId, "Content-Type": "image/png" }, body: Buffer.from("zz") });
    expect(both.status).toBe(400);
  });

  it("requires a signed-in owner and can be abandoned", async () => {
    state.user = undefined;
    expect((await json("/sessions", "POST", { contentType: "image/png", size: 2 })).status).toBe(401);
    state.user = "user-a";
    const s = await (await json("/sessions", "POST", { contentType: "image/png", size: 2 })).json() as { uploadId: string };
    expect((await json(`/sessions/${s.uploadId}`, "DELETE")).status).toBe(204);
    expect((await json(`/sessions/${s.uploadId}`, "GET")).status).toBe(404);
    expect((await json("/sessions/not-a-uuid", "GET")).status).toBe(404);
  });
});

describe("expiry and cleanup", () => {
  const start = async (size = 8) => (await (await json("/sessions", "POST", { contentType: "image/png", size })).json()) as { uploadId: string };
  const ownedKeys = (owner: string) => [...storage.objects.keys()].filter((k) => k.startsWith(ownerSessionsDir(owner)));

  it("knows when a session is past its 24 h lifetime", () => {
    expect(isSessionExpired({ createdAt: 0 }, UPLOAD_SESSION_TTL_MS)).toBe(false);
    expect(isSessionExpired({ createdAt: 0 }, UPLOAD_SESSION_TTL_MS + 1)).toBe(true);
    expect(isSessionExpired({ createdAt: Number.NaN }, 0)).toBe(true);
  });

  it("rejects chunks, completion and hand-off for an expired session and deletes it", async () => {
    const s = await start();
    await putChunk(s.uploadId, 0, Buffer.from("abcd"));
    state.now += UPLOAD_SESSION_TTL_MS + 1;
    const late = await putChunk(s.uploadId, 1, Buffer.from("efgh"));
    expect(late.status).toBe(410);
    expect((await late.json() as { code: string }).code).toBe("UPLOAD_EXPIRED");
    await new Promise((r) => setTimeout(r, 20));
    expect(ownedKeys("user-a")).toEqual([]);
  });

  it("refuses an expired, already-assembled session at hand-off", async () => {
    const s = await start(2);
    await putChunk(s.uploadId, 0, Buffer.from("ok"));
    await json(`/sessions/${s.uploadId}/complete`, "POST");
    state.now += UPLOAD_SESSION_TTL_MS + 1;
    expect((await fetch(`${base}/target`, { method: "POST", headers: { "X-Upload-Id": s.uploadId } })).status).toBe(410);
  });

  it("starting a session sweeps that person's expired and orphaned sessions only", async () => {
    const old = await start();
    await putChunk(old.uploadId, 0, Buffer.from("abcd"));
    state.user = "user-b";
    const other = await start();
    state.user = "user-a";
    // Orphaned parts with no meta object.
    storage.objects.set(`${ownerSessionsDir("user-a")}/11111111-1111-4111-8111-111111111111/p000000`, Buffer.from("zz"));

    state.now += UPLOAD_SESSION_TTL_MS + 1;
    const fresh = await start();
    const keys = ownedKeys("user-a");
    expect(keys.every((k) => k.includes(fresh.uploadId))).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    // user-b's (also old) session is untouched until user-b starts one.
    expect(ownedKeys("user-b").some((k) => k.includes(other.uploadId))).toBe(true);
  });

  it("caps open sessions per person", async () => {
    for (let i = 0; i < MAX_OPEN_UPLOAD_SESSIONS; i += 1) expect((await json("/sessions", "POST", { contentType: "image/png", size: 4 })).status).toBe(201);
    const blocked = await json("/sessions", "POST", { contentType: "image/png", size: 4 });
    expect(blocked.status).toBe(429);
    expect((await blocked.json() as { code: string }).code).toBe("TOO_MANY_OPEN_UPLOADS");
    // Someone else is unaffected; and once those expire the person can start again.
    state.user = "user-b";
    expect((await json("/sessions", "POST", { contentType: "image/png", size: 4 })).status).toBe(201);
    state.user = "user-a";
    state.now += UPLOAD_SESSION_TTL_MS + 1;
    expect((await json("/sessions", "POST", { contentType: "image/png", size: 4 })).status).toBe(201);
  });

  it("sweep work is bounded per call", async () => {
    for (let i = 0; i < 30; i += 1) {
      storage.objects.set(`${ownerSessionsDir("user-c")}/${crypto.randomUUID()}/p000000`, Buffer.from("x"));
    }
    const first = await sweepOwnerSessions(storage, "user-c", 0);
    expect(first.removed).toBe(20);
    const second = await sweepOwnerSessions(storage, "user-c", 0);
    expect(second.removed).toBe(10);
  });
});
