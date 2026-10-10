import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory counters instead of Redis/Postgres, so this runs without a DB.
const counters = vi.hoisted(() => new Map<string, number>());
const authState = vi.hoisted(() => ({ userId: "user-1" as string | null }));

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: authState.userId }) }));
vi.mock("../../lib/rateLimitStore", () => ({
  consumeRateLimitRedis: async (key: string, windowMs: number) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    return { count, resetAt: new Date(Date.now() + windowMs) };
  },
}));
vi.mock("@workspace/db", () => ({
  db: {
    execute: async (query: { queryChunks?: unknown[] }) => {
      // consumeRateLimitBucket (used for the per-IP ceiling): count per key.
      const key = JSON.stringify(query.queryChunks ?? []).slice(0, 400);
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { rows: [{ request_count: count, expires_at: new Date(Date.now() + 60_000) }] };
    },
  },
}));

import { RATE_LIMIT_POLICIES, appRateLimiter, rateLimitPolicyFor } from "../rateLimit";
import { UPLOAD_SESSION_MAX_CHUNKS } from "../../lib/uploadSessions";

beforeEach(() => {
  counters.clear();
  authState.userId = "user-1";
});

describe("upload session rate limiting", () => {
  it("gives chunk PUTs their own policy and counts only create + hand-off as uploads", () => {
    expect(rateLimitPolicyFor("PUT", "/api/upload-sessions/u1/chunks/3", true, "application/octet-stream")?.id).toBe("upload-chunk");
    expect(rateLimitPolicyFor("PUT", "/api/v1/upload-sessions/u1/chunks/0", true, "application/octet-stream")?.id).toBe("upload-chunk");
    expect(rateLimitPolicyFor("PUT", "/api/posts/uploads/u1/chunks/0", true, "application/octet-stream")?.id).toBe("upload-chunk");
    expect(rateLimitPolicyFor("POST", "/api/upload-sessions", true, "application/json")?.id).toBe("upload");
    expect(rateLimitPolicyFor("POST", "/api/v1/posts/uploads", true, "application/json")?.id).toBe("upload");
    // Hand-off: empty body, X-Upload-Id header, to the destination route.
    expect(rateLimitPolicyFor("POST", "/api/products/images", true, undefined, true)?.id).toBe("upload");
    expect(rateLimitPolicyFor("POST", "/api/profile/avatar-video", true, undefined, true)?.id).toBe("upload");
    // Status / complete / abandon are not uploads.
    expect(rateLimitPolicyFor("GET", "/api/upload-sessions/u1", true)?.id).toBe("authenticated-read");
    expect(rateLimitPolicyFor("POST", "/api/upload-sessions/u1/complete", true, "application/json")?.id).toBe("mutation");
    expect(rateLimitPolicyFor("DELETE", "/api/upload-sessions/u1", true)?.id).toBe("mutation");
  });

  it("sizes the chunk budget for several max-size sessions with retries", () => {
    const policy = RATE_LIMIT_POLICIES["upload-chunk"];
    expect(policy.limit).toBeGreaterThanOrEqual(UPLOAD_SESSION_MAX_CHUNKS * 3);
    // Two 100 MB videos at 8 MB chunks, every chunk retried once: 52 requests.
    expect(2 * Math.ceil((100 * 1024 * 1024) / (8 * 1024 * 1024)) * 2).toBeLessThan(policy.limit);
  });

  it("lets a user upload two 100 MB videos with retries without touching the upload budget", async () => {
    const app = express();
    app.use(appRateLimiter);
    app.all("/{*rest}", (_req, res) => res.status(200).json({ ok: true }));
    const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const chunksPerVideo = Math.ceil((100 * 1024 * 1024) / (8 * 1024 * 1024));
      const statuses: number[] = [];
      for (let video = 0; video < 2; video += 1) {
        statuses.push((await fetch(`${base}/api/upload-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          for (let i = 0; i < chunksPerVideo; i += 1) {
            statuses.push((await fetch(`${base}/api/upload-sessions/s${video}/chunks/${i}`, {
              method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: "x",
            })).status);
          }
        }
        statuses.push((await fetch(`${base}/api/products/images`, { method: "POST", headers: { "X-Upload-Id": `s${video}` } })).status);
      }
      expect(statuses.every((s) => s === 200)).toBe(true);
      const uploadKey = [...counters.keys()].find((k) => k.startsWith("upload:user:user-1"));
      const chunkKey = [...counters.keys()].find((k) => k.startsWith("upload-chunk:user:user-1"));
      expect(counters.get(uploadKey!)).toBe(4); // 2 creates + 2 hand-offs
      expect(counters.get(chunkKey!)).toBe(chunksPerVideo * 4);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("still stops a client that floods chunk PUTs", async () => {
    const app = express();
    app.use(appRateLimiter);
    app.all("/{*rest}", (_req, res) => res.status(200).end());
    const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      counters.set("upload-chunk:user:user-1", RATE_LIMIT_POLICIES["upload-chunk"].limit);
      const res = await fetch(`${base}/api/upload-sessions/s/chunks/0`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: "x" });
      expect(res.status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
