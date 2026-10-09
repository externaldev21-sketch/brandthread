import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { isUsernameUniqueViolation } from "../../lib/dbErrors";

// Usernames get the same reserved-handle + profanity screening store handles
// do (lib/storeIdentity.ts validateHandle) on every write path and on the
// availability check; a unique violation from the check-then-update race is
// a 409, never a 500.

const state = vi.hoisted(() => ({ selfId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.selfId;
    next();
  },
}));

let server: Server;
let base = "";
const selfId = `uname-screen-self-${crypto.randomBytes(6).toString("hex")}`;
const legacyId = `uname-screen-legacy-${crypto.randomBytes(6).toString("hex")}`;
// An account that picked a now-reserved handle before the rules existed.
const legacyName = `support`;

beforeAll(async () => {
  state.selfId = selfId;
  await db.delete(users).where(eq(users.username, legacyName));
  await db.insert(users).values([
    { clerkId: selfId, email: `${selfId}@test.local`, name: "Self", displayName: "Self", role: "buyer", accountType: "buyer" },
    { clerkId: legacyId, email: `${legacyId}@test.local`, name: "Legacy", displayName: "Legacy", role: "buyer", accountType: "buyer", username: legacyName },
  ]);
  const { default: authRouter } = await import("../auth");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/auth", authRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  state.selfId = selfId;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, [selfId, legacyId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function send(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}/api/auth${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("username screening", () => {
  it("/username/check reports reserved and profane handles as unavailable with a reason", async () => {
    const reserved = await send("GET", "/username/check?username=Admin");
    expect(reserved.body).toMatchObject({ available: false, code: "USERNAME_RESERVED", error: "That username is reserved." });
    const impersonation = await send("GET", "/username/check?username=brandthread_help");
    expect(impersonation.body).toMatchObject({ available: false, code: "USERNAME_RESERVED" });
    const profane = await send("GET", "/username/check?username=fuuuck_boy");
    expect(profane.body).toMatchObject({ available: false, code: "USERNAME_NOT_ALLOWED", error: "That username is not allowed." });
    const ok = await send("GET", `/username/check?username=sunny_${crypto.randomBytes(3).toString("hex")}`);
    expect(ok.body).toEqual({ available: true });
    // Innocent words containing a short slur stay allowed (storeIdentity rules).
    const classy = await send("GET", `/username/check?username=classic_${crypto.randomBytes(3).toString("hex")}`);
    expect(classy.body).toEqual({ available: true });
  });

  it("PATCH /profile refuses reserved and profane usernames", async () => {
    const reserved = await send("PATCH", "/profile", { username: "moderator" });
    expect(reserved.status).toBe(400);
    expect(reserved.body).toMatchObject({ code: "USERNAME_RESERVED" });
    const profane = await send("PATCH", "/profile", { username: "sh1t_lord" });
    expect(profane.status).toBe(400);
    expect(profane.body).toMatchObject({ code: "USERNAME_NOT_ALLOWED" });
    const [row] = await db.select({ username: users.username }).from(users).where(eq(users.clerkId, selfId));
    expect(row.username).toBeNull();
  });

  it("PATCH /onboarding refuses reserved and profane usernames", async () => {
    const reserved = await send("PATCH", "/onboarding", { brandName: "My Brand", username: "official" });
    expect(reserved.status).toBe(400);
    expect(reserved.body).toMatchObject({ code: "USERNAME_RESERVED" });
    const profane = await send("PATCH", "/onboarding", { brandName: "My Brand", username: "bitchy_fits" });
    expect(profane.status).toBe(400);
    expect(profane.body).toMatchObject({ code: "USERNAME_NOT_ALLOWED" });
  });

  it("an account keeps a handle it already owns even if it is now reserved", async () => {
    state.selfId = legacyId;
    const check = await send("GET", `/username/check?username=${legacyName}`);
    expect(check.body).toEqual({ available: true });
    const save = await send("PATCH", "/profile", { username: legacyName, bio: "still me" });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
  });
});

describe("username unique-violation race", () => {
  function raceError(constraint: string) {
    return Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint });
  }

  it("classifies both the case-insensitive index and the column constraint", () => {
    expect(isUsernameUniqueViolation(raceError("users_username_ci_unique"))).toBe(true);
    expect(isUsernameUniqueViolation(raceError("users_username_unique"))).toBe(true);
    expect(isUsernameUniqueViolation({ cause: { code: "23505", constraint: "users_username_key" } })).toBe(true);
    expect(isUsernameUniqueViolation(raceError("users_email_ci_unique"))).toBe(false);
    expect(isUsernameUniqueViolation({ code: "23503", constraint: "users_username_ci_unique" })).toBe(false);
  });

  for (const constraint of ["users_username_ci_unique", "users_username_unique"]) {
    it(`maps a 23505 on ${constraint} during PATCH /profile and /onboarding to 409`, async () => {
      const failingUpdate = () => ({
        set: () => ({ where: () => ({ returning: () => Promise.reject(raceError(constraint)) }) }),
      });
      vi.spyOn(db, "update").mockImplementation(failingUpdate as any);
      const name = `racer_${crypto.randomBytes(3).toString("hex")}`;
      const profile = await send("PATCH", "/profile", { username: name });
      expect(profile.status).toBe(409);
      expect(profile.body).toMatchObject({ code: "USERNAME_TAKEN" });
      const onboarding = await send("PATCH", "/onboarding", { brandName: "My Brand", username: name });
      expect(onboarding.status).toBe(409);
      expect(onboarding.body).toMatchObject({ code: "USERNAME_TAKEN" });
    });
  }
});
