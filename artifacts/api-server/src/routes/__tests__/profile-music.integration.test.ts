/**
 * Profile song routes against the real database. With no provider in env the
 * feature is fully off; with the env set and the flag on, Apple Music is
 * stubbed at `fetch` (no network, no real key) and a pick round-trips.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { blocks, db, pool, users } from "@workspace/db";
import { resetProfileMusicFlagCache } from "../../lib/profileMusic";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));
vi.mock("../../lib/safety", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/safety")>()),
  optionalViewerId: (req: any) => req.header("x-test-user") ?? null,
}));

const suffix = crypto.randomBytes(6).toString("hex");
const me = `pm-me-${suffix}`;
const viewer = `pm-viewer-${suffix}`;
const blocked = `pm-blocked-${suffix}`;
let server: Server;
let base = "";
const realFetch = globalThis.fetch;

const SONG = {
  id: "1440833098",
  attributes: {
    name: "blue", artistName: "yung kai",
    artwork: { url: "https://is1-ssl.mzstatic.com/x/{w}x{h}bb.jpg" },
    previews: [{ url: "https://audio-ssl.itunes.apple.com/blue.m4a" }],
    url: "https://music.apple.com/us/song/blue/1440833098",
  },
};

async function call(path: string, user?: string, init: { method?: string; body?: unknown } = {}) {
  const res = await realFetch(`${base}/api/profile-music${path}`, {
    method: init.method ?? "GET",
    headers: { ...(user ? { "x-test-user": user } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function setFlag(enabled: boolean) {
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ('profileMusic', $1, '')
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`, [enabled]);
  resetProfileMusicFlagCache();
}

beforeAll(async () => {
  await db.insert(users).values([me, viewer, blocked].map((id) => ({
    clerkId: id, email: `${id}@test.local`, name: id, accountType: "buyer", role: "buyer",
  })));
  await db.insert(blocks).values({ blockerId: me, blockedId: blocked });
  const { default: router } = await import("../profile-music");
  const app = express();
  app.use(express.json());
  app.use("/api/profile-music", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetProfileMusicFlagCache();
});

afterAll(async () => {
  await setFlag(false);
  await db.delete(blocks).where(inArray(blocks.blockerId, [me]));
  await db.delete(users).where(inArray(users.clerkId, [me, viewer, blocked]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("with no licensed provider configured", () => {
  it("is off everywhere, even with the flag on", async () => {
    await setFlag(true);
    expect((await call("/config")).body).toEqual({ enabled: false });
    expect((await call("/search?q=blue", me)).status).toBe(503);
    expect((await call("/me", me, { method: "PUT", body: { trackId: "1440833098" } })).status).toBe(503);
    expect((await call(`/user/${me}`)).body).toEqual({ song: null });
  });

  it("still lets you remove a song", async () => {
    expect(await call("/me", me, { method: "PUT", body: { trackId: null } })).toEqual({ status: 200, body: { song: null } });
  });
});

describe("with Apple Music configured", () => {
  function configure() {
    vi.stubEnv("PROFILE_MUSIC_PROVIDER", "apple_music");
    vi.stubEnv("APPLE_MUSIC_DEVELOPER_TOKEN", "test-token");
    const apple = vi.fn(async (url: string, init: any) => {
      expect(init.headers.Authorization).toBe("Bearer test-token");
      if (url.includes("/search?")) return new Response(JSON.stringify({ results: { songs: { data: [SONG] } } }));
      if (url.endsWith(`/songs/${SONG.id}`)) return new Response(JSON.stringify({ data: [SONG] }));
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", apple);
    return apple;
  }

  it("stays off while the flag is off", async () => {
    configure();
    await setFlag(false);
    expect((await call("/config")).body).toEqual({ enabled: false });
  });

  it("searches, saves a pick from the provider's own data, and shows it", async () => {
    configure();
    await setFlag(true);
    expect((await call("/config")).body).toEqual({ enabled: true });
    const search = await call("/search?q=blue", me);
    expect(search.body.tracks).toHaveLength(1);
    expect(search.body.tracks[0]).toMatchObject({ id: SONG.id, title: "blue", artist: "yung kai" });

    const put = await call("/me", me, { method: "PUT", body: { trackId: SONG.id } });
    expect(put.status).toBe(200);
    expect(put.body.song.previewUrl).toBe("https://audio-ssl.itunes.apple.com/blue.m4a");

    expect((await call(`/user/${me}`, viewer)).body.song).toMatchObject({ title: "blue", artist: "yung kai" });
    expect((await call(`/user/${me}`)).body.song).toMatchObject({ title: "blue" });
  });

  it("rejects ids the provider doesn't know and non-numeric ids", async () => {
    configure();
    await setFlag(true);
    expect((await call("/me", me, { method: "PUT", body: { trackId: "999" } })).status).toBe(404);
    expect((await call("/me", me, { method: "PUT", body: { trackId: "../../me" } })).status).toBe(404);
    expect((await call("/me", me, { method: "PUT", body: { trackId: 5 } })).status).toBe(400);
  });

  it("hides the song across a block", async () => {
    configure();
    await setFlag(true);
    expect((await call(`/user/${me}`, blocked)).body).toEqual({ song: null });
  });
});
