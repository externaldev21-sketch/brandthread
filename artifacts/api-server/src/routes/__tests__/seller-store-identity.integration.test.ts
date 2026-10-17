import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, storefronts, users } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const suffix = crypto.randomBytes(5).toString("hex");
const me = `store-identity-me-${suffix}`;
const other = `store-identity-other-${suffix}`;
const fresh = `store-identity-fresh-${suffix}`;
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  authState.clerkUserId = me;
  await db.insert(users).values([
    { clerkId: me, email: `${me}@test.local`, name: "Me", displayName: "Me", role: "seller", accountType: "seller", brandName: `Mine ${suffix}`, username: `mine_${suffix}`, socialLinks: { website: "keep" } as any },
    { clerkId: other, email: `${other}@test.local`, name: "Other", displayName: "Other", role: "seller", accountType: "seller", brandName: `Taken Name ${suffix}`, username: `taken_${suffix}` },
    { clerkId: fresh, email: `${fresh}@test.local`, name: "Fresh", displayName: "Fresh", role: "seller", accountType: "seller" },
  ]);
  const { default: router } = await import("../seller-profile");
  const app = express();
  app.use(express.json());
  app.use("/api/seller", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(storefronts).where(inArray(storefronts.ownerId, [me, other]));
  await db.delete(users).where(inArray(users.clerkId, [me, other, fresh]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/seller${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

describe("GET /identity/check", () => {
  it("flags names and handles taken by someone else, case-insensitively", async () => {
    const r = await call("GET", `/identity/check?name=${encodeURIComponent(`TAKEN name ${suffix}`)}&handle=TAKEN_${suffix.toUpperCase()}`);
    expect(r.body.name).toMatchObject({ available: false, code: "NAME_TAKEN" });
    expect(r.body.handle).toMatchObject({ available: false, code: "USERNAME_TAKEN" });
  });

  it("does not flag the caller's own name and handle", async () => {
    const r = await call("GET", `/identity/check?name=${encodeURIComponent(`mine ${suffix}`)}&handle=mine_${suffix}`);
    expect(r.body.name.available).toBe(true);
    expect(r.body.handle.available).toBe(true);
  });

  it("reports reserved and blocked values", async () => {
    const r = await call("GET", "/identity/check?name=Brandthread&handle=admin");
    expect(r.body.name).toMatchObject({ available: false, code: "RESERVED" });
    expect(r.body.handle).toMatchObject({ available: false, code: "RESERVED" });
    const blocked = await call("GET", "/identity/check?handle=sh1tshop");
    expect(blocked.body.handle).toMatchObject({ available: false, code: "BLOCKED" });
    expect(blocked.body.name).toBeUndefined();
  });
});

describe("PUT /identity", () => {
  it("re-validates on save", async () => {
    expect((await call("PUT", "/identity", { brandName: "Fine Name", handle: "admin" })).status).toBe(400);
    expect((await call("PUT", "/identity", { brandName: "f u c k", handle: `fine_${suffix}` })).status).toBe(400);
    expect((await call("PUT", "/identity", { brandName: `taken name ${suffix}`, handle: `fine_${suffix}` })).status).toBe(409);
    expect((await call("PUT", "/identity", { brandName: "Fine Name", handle: `Taken_${suffix}` })).status).toBe(409);
  });

  it("saves the trimmed name and lowercase handle", async () => {
    const r = await call("PUT", "/identity", { brandName: `  Fresh   Label ${suffix} `, handle: `@Fresh_${suffix}` });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ brandName: `Fresh Label ${suffix}`, username: `fresh_${suffix}` });
    const [row] = await db.select({ username: users.username }).from(users).where(eq(users.clerkId, me));
    expect(row.username).toBe(`fresh_${suffix}`);
  });
});

describe("@handle change cooldown on PUT /identity", () => {
  it("blocks a second handle change inside 14 days, on save and on the live check", async () => {
    // The previous test changed the handle once and started the clock.
    const [row] = await db.select({ changedAt: users.usernameChangedAt }).from(users).where(eq(users.clerkId, me));
    expect(row.changedAt).toBeInstanceOf(Date);
    const check = await call("GET", `/identity/check?handle=again_${suffix}`);
    expect(check.body.handle).toMatchObject({ available: false, code: "USERNAME_COOLDOWN" });
    expect(typeof check.body.handle.nextChangeAt).toBe("string");
    const r = await call("PUT", "/identity", { brandName: `Fresh Label ${suffix}`, handle: `again_${suffix}` });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: "USERNAME_COOLDOWN", field: "handle" });
    const [after] = await db.select({ username: users.username }).from(users).where(eq(users.clerkId, me));
    expect(after.username).toBe(`fresh_${suffix}`);
  });

  it("keeping the same handle while renaming the store is not a change", async () => {
    const r = await call("PUT", "/identity", { brandName: `Renamed ${suffix}`, handle: `fresh_${suffix}` });
    expect(r.status).toBe(200);
  });

  it("allows the change again once 14 days have passed", async () => {
    await db.update(users).set({ usernameChangedAt: new Date(Date.now() - 15 * 86_400_000) }).where(eq(users.clerkId, me));
    const r = await call("PUT", "/identity", { brandName: `Renamed ${suffix}`, handle: `later_${suffix}` });
    expect(r.status).toBe(200);
    const [row] = await db.select({ changedAt: users.usernameChangedAt }).from(users).where(eq(users.clerkId, me));
    expect(Date.now() - row.changedAt!.getTime()).toBeLessThan(60_000);
  });

  it("lets a seller with no handle claim their first one during onboarding", async () => {
    authState.clerkUserId = fresh;
    try {
      const r = await call("PUT", "/identity", { brandName: `First Store ${suffix}`, handle: `first_${suffix}` });
      expect(r.status).toBe(200);
      expect(r.body.username).toBe(`first_${suffix}`);
    } finally {
      authState.clerkUserId = me;
    }
  });
});

describe("PUT /profile/accent", () => {
  it("stores allowlisted colors and exposes them on the profile", async () => {
    expect((await call("PUT", "/profile/accent", { color: "#c0c0c0" })).body).toEqual({ storeAccentColor: "#C0C0C0" });
    expect((await call("GET", "/profile")).body.storeAccentColor).toBe("#C0C0C0");
  });

  it("rejects colors outside the monochrome palette and clears on null", async () => {
    expect((await call("PUT", "/profile/accent", { color: "#ff0000" })).status).toBe(400);
    expect((await call("PUT", "/profile/accent", {})).status).toBe(400);
    expect((await call("PUT", "/profile/accent", { color: null })).body).toEqual({ storeAccentColor: null });
  });
});

describe("PUT /social-links", () => {
  it("normalises, merges and leaves other keys alone", async () => {
    const r = await call("PUT", "/social-links", { instagram: "@Studio.One", tiktok: "https://www.tiktok.com/@studio?lang=en" });
    expect(r.status).toBe(200);
    expect(r.body.socialLinks).toEqual({
      website: "keep",
      instagram: "https://www.instagram.com/studio.one",
      tiktok: "https://www.tiktok.com/@studio",
    });
  });

  it("clears a link with an empty value and rejects other domains", async () => {
    expect((await call("PUT", "/social-links", { instagram: "" })).body.socialLinks.instagram).toBeUndefined();
    const bad = await call("PUT", "/social-links", { tiktok: "https://evil.com/@studio" });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("tiktok");
  });
});

describe("PUT /social-links — removing every link", () => {
  it("persists clearing both Instagram and TikTok at once", async () => {
    await call("PUT", "/social-links", { instagram: "@both.gone", tiktok: "@both.gone" });
    const r = await call("PUT", "/social-links", { instagram: "", tiktok: "" });
    expect(r.status).toBe(200);
    expect(r.body.socialLinks.instagram).toBeUndefined();
    expect(r.body.socialLinks.tiktok).toBeUndefined();
    const profile = (await call("GET", "/profile")).body;
    expect(profile.socialLinks.instagram).toBeUndefined();
    expect(profile.socialLinks.tiktok).toBeUndefined();
  });
});

describe("PUT /profile/accent — public storefront theme", () => {
  it("writes the accent into storefronts.theme, which the public store renders", async () => {
    expect((await call("PUT", "/profile/accent", { color: "#4a4a4a" })).status).toBe(200);
    const [sf] = await db.select().from(storefronts).where(eq(storefronts.ownerId, me)).limit(1);
    expect((sf.theme as any).primaryColor).toBe("#4A4A4A");
    expect((sf.theme as any).accentColor).toBe("#4A4A4A");
  });
});

describe("POST /onboarding/data", () => {
  it("keeps the seller's goals on the storefront for the setup checklist", async () => {
    // seller_goals is added by the router's startup migration; make sure it exists.
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_goals JSONB`);
    const r = await call("POST", "/onboarding/data", { goals: ["Ship orders", "Grow sales", 7], brandStage: "launched" });
    expect(r.status).toBe(200);
    const [sf] = await db.select().from(storefronts).where(eq(storefronts.ownerId, me)).limit(1);
    expect((sf.onboarding as any).goals).toEqual(["Ship orders", "Grow sales"]);
    expect((sf.onboarding as any).brandStage).toBe("launched");
  });
});
