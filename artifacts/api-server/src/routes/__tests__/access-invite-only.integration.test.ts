/**
 * Invite-only launch mode: feature flag, access routes, onboarding gate and
 * the waitlist admin. Runs against the isolated test database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, pool, users, adminInviteCodes, adminInviteCodeUses, accessWaitlistSignups, adminAuditLog,
} from "@workspace/db";

const state = vi.hoisted(() => ({ userId: "" }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId || null }),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!state.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = state.userId;
    next();
  },
}));
vi.mock("../loyalty", () => ({ awardLoyaltyPointsOnce: vi.fn(async () => undefined) }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock("../../lib/brandthreadAgent", () => ({ createWelcomeConversationOnce: vi.fn(async () => undefined) }));

import authRouter from "../auth";
import accessRouter from "../access";
import adminRouter from "../admin";

const P = `invonly-${crypto.randomBytes(4).toString("hex")}`;
const ADMIN = `${P}-admin`;
const FAN = `${P}-fan`;
const OLD = `${P}-old`;
const STAFF = `${P}-staff`;
const MEMBER = `${P}-member`;
let server: Server;
let baseUrl = "";

function freshIp() {
  const [x, y, z] = crypto.randomBytes(3);
  return `10.${x}.${y}.${z}`;
}

async function call(userId: string | null, method: string, path: string, body?: unknown, ip = freshIp()) {
  state.userId = userId ?? "";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function setFlag(enabled: boolean | null) {
  if (enabled === null) {
    await pool.query("DELETE FROM feature_flags WHERE key = 'inviteOnlySignup'");
    return;
  }
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ('inviteOnlySignup', $1, 'test')
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [enabled],
  );
}

async function seedUser(clerkId: string, extra: Partial<typeof users.$inferInsert> = {}) {
  await db.insert(users).values({
    clerkId, email: `${clerkId}@test.local`, name: "Test Person", displayName: "Test Person",
    username: clerkId.replace(/-/g, "_").slice(0, 28), accountType: "buyer", ...extra,
  }).onConflictDoNothing();
}

async function seedCode(over: Partial<typeof adminInviteCodes.$inferInsert> = {}) {
  const code = crypto.randomBytes(6).toString("hex").toUpperCase().slice(0, 8);
  const [row] = await db.insert(adminInviteCodes).values({ code, createdBy: ADMIN, ...over }).returning();
  return row!;
}

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }; next(); });
  app.use("/api/access", accessRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await seedUser(ADMIN, { role: "admin", onboardingComplete: true });
});

beforeEach(async () => { await setFlag(true); });

afterAll(async () => {
  await setFlag(null);
  const ids = (await db.select({ id: adminInviteCodes.id }).from(adminInviteCodes).where(like(adminInviteCodes.createdBy, `${P}-%`))).map((r) => r.id);
  await db.delete(adminInviteCodeUses).where(like(adminInviteCodeUses.userId, `${P}-%`));
  await db.delete(accessWaitlistSignups).where(like(accessWaitlistSignups.email, `${P}%`));
  if (ids.length) await db.delete(adminInviteCodes).where(inArray(adminInviteCodes.id, ids));
  await db.delete(adminAuditLog).where(like(adminAuditLog.actorClerkId, `${P}-%`)).catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("flag off (default)", () => {
  it("treats a missing flag row as off and onboarding completes without a code", async () => {
    await setFlag(null);
    await seedUser(`${P}-nobody`);
    expect((await call(`${P}-nobody`, "GET", "/api/access/status")).body).toEqual({ inviteOnly: false, redeemed: false, required: false });
    const done = await call(`${P}-nobody`, "POST", "/api/auth/onboarding/complete", { accountType: "buyer" });
    expect(done.status).toBe(200);
    expect(done.body.onboardingComplete).toBe(true);
  });

  it("explicit off behaves the same", async () => {
    await setFlag(false);
    await seedUser(`${P}-off`);
    expect((await call(`${P}-off`, "POST", "/api/auth/onboarding/complete", { accountType: "buyer" })).status).toBe(200);
  });
});

describe("flag on", () => {
  it("blocks first-time onboarding completion until a code is redeemed", async () => {
    await seedUser(FAN);
    expect((await call(FAN, "GET", "/api/access/status")).body).toEqual({ inviteOnly: true, redeemed: false, required: true });
    const blocked = await call(FAN, "POST", "/api/auth/onboarding/complete", { accountType: "buyer" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("INVITE_REQUIRED");
    expect((await db.select().from(users).where(eq(users.clerkId, FAN)))[0]!.onboardingComplete).toBe(false);

    const code = await seedCode({ maxUses: 5 });
    expect((await call(FAN, "POST", "/api/access/redeem", { code: code.code.toLowerCase() })).status).toBe(200);
    expect((await call(FAN, "GET", "/api/access/status")).body).toEqual({ inviteOnly: true, redeemed: true, required: false });
    const ok = await call(FAN, "POST", "/api/auth/onboarding/complete", { accountType: "buyer" });
    expect(ok.status).toBe(200);
    expect((await db.select().from(adminInviteCodes).where(eq(adminInviteCodes.id, code.id)))[0]!.uses).toBe(1);
  });

  it("redeeming again is idempotent and does not spend another use", async () => {
    const code = await seedCode({ maxUses: 5 });
    await seedUser(`${P}-twice`);
    await call(`${P}-twice`, "POST", "/api/access/redeem", { code: code.code });
    expect((await call(`${P}-twice`, "POST", "/api/access/redeem", { code: code.code })).status).toBe(200);
    expect((await db.select().from(adminInviteCodes).where(eq(adminInviteCodes.id, code.id)))[0]!.uses).toBe(1);
  });

  it("grandfathers accounts that already finished onboarding", async () => {
    await seedUser(OLD, { onboardingComplete: true });
    expect((await call(OLD, "GET", "/api/access/status")).body.required).toBe(false);
    expect((await call(OLD, "POST", "/api/auth/onboarding/complete", { accountType: "buyer" })).status).toBe(200);
  });

  it("lets platform staff through without a code", async () => {
    await seedUser(STAFF, { role: "admin" });
    expect((await call(STAFF, "GET", "/api/access/status")).body.required).toBe(false);
    expect((await call(STAFF, "POST", "/api/auth/onboarding/complete", { accountType: "buyer" })).status).toBe(200);
  });

  it("a member referral code does not unlock access", async () => {
    await seedUser(MEMBER);
    const res = await call(MEMBER, "POST", "/api/access/redeem", { code: "ZZZZ9999" });
    expect(res.status).toBe(400);
    expect((await call(MEMBER, "POST", "/api/auth/onboarding/complete", { accountType: "buyer" })).status).toBe(403);
  });
});

describe("validate and redeem", () => {
  it("gives one generic answer for every kind of bad code", async () => {
    const revoked = await seedCode({ disabledAt: new Date() });
    const expired = await seedCode({ expiresAt: new Date(Date.now() - 1000) });
    const used = await seedCode({ maxUses: 1, uses: 1 });
    const good = await seedCode();
    for (const c of [revoked.code, expired.code, used.code, "NOPE1234", "x", "!!", ""]) {
      const r = await call(null, "POST", "/api/access/validate", { code: c });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ valid: false });
    }
    expect((await call(null, "POST", "/api/access/validate", { code: good.code })).body).toEqual({ valid: true });
    expect((await call(null, "POST", "/api/access/validate", { code: `${good.code.slice(0, 4)}-${good.code.slice(4)}` })).body).toEqual({ valid: true });
  });

  it("refuses revoked, expired and used-up codes on redeem with the same error", async () => {
    await seedUser(`${P}-bad`);
    for (const row of [
      await seedCode({ disabledAt: new Date() }),
      await seedCode({ expiresAt: new Date(Date.now() - 1000) }),
      await seedCode({ maxUses: 1, uses: 1 }),
    ]) {
      const r = await call(`${P}-bad`, "POST", "/api/access/redeem", { code: row.code });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("INVALID_CODE");
    }
  });

  it("requires sign-in to redeem", async () => {
    expect((await call(null, "POST", "/api/access/redeem", { code: "ABCD2345" })).status).toBe(401);
  });

  it("never lets concurrent redemptions exceed max_uses", async () => {
    const code = await seedCode({ maxUses: 2 });
    const ids = Array.from({ length: 8 }, (_, i) => `${P}-race${i}`);
    for (const id of ids) await seedUser(id);
    const results = await Promise.all(ids.map((id) => call(id, "POST", "/api/access/redeem", { code: code.code })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 400)).toHaveLength(6);
    const [row] = await db.select().from(adminInviteCodes).where(eq(adminInviteCodes.id, code.id));
    expect(row!.uses).toBe(2);
    expect(await db.select().from(adminInviteCodeUses).where(eq(adminInviteCodeUses.codeId, code.id))).toHaveLength(2);
  });

  it("rate-limits validate per client", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call(null, "POST", "/api/access/validate", { code: "NOPE1234" }, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("rate-limits redeem per account", async () => {
    await seedUser(`${P}-hammer`);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call(`${P}-hammer`, "POST", "/api/access/redeem", { code: "NOPE1234" })).status);
    expect(statuses[0]).toBe(400);
    expect(statuses[11]).toBe(429);
  });
});

describe("waitlist", () => {
  it("joins idempotently and case-insensitively with an identical response", async () => {
    const email = `${P}-Wait@Test.Local`;
    const a = await call(null, "POST", "/api/access/waitlist", { email });
    const b = await call(null, "POST", "/api/access/waitlist", { email: email.toUpperCase() });
    expect(a).toEqual({ status: 200, body: { ok: true } });
    expect(b).toEqual(a);
    const rows = await db.select().from(accessWaitlistSignups).where(like(accessWaitlistSignups.email, `${P}-wait@%`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(email.toLowerCase());
  });

  it("rejects invalid emails", async () => {
    expect((await call(null, "POST", "/api/access/waitlist", { email: "not-an-email" })).status).toBe(400);
    expect((await call(null, "POST", "/api/access/waitlist", {})).status).toBe(400);
  });

  it("rate-limits joins per client", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await call(null, "POST", "/api/access/waitlist", { email: `${P}-rl${i}@test.local` }, ip)).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe("admin", () => {
  it("only platform admins can reach the waitlist admin", async () => {
    await seedUser(`${P}-plain`);
    expect((await call(`${P}-plain`, "GET", "/api/admin/access/waitlist")).status).toBe(403);
    expect((await call(null, "GET", "/api/admin/access/waitlist")).status).toBe(401);
  });

  it("generates, lists with usage, and revokes codes through the existing invite API", async () => {
    const made = await call(ADMIN, "POST", "/api/admin/invites", { count: 2, maxUses: 1, label: `${P} batch` });
    expect(made.status).toBe(201);
    const [first] = made.body.codes as string[];
    expect((await call(null, "POST", "/api/access/validate", { code: first })).body.valid).toBe(true);
    const list = await call(ADMIN, "GET", "/api/admin/invites");
    const row = list.body.items.find((i: any) => i.code === first);
    expect(row).toMatchObject({ uses: 0, maxUses: 1, status: "active" });
    expect((await call(ADMIN, "POST", `/api/admin/invites/${row.id}/disable`)).status).toBe(200);
    expect((await call(null, "POST", "/api/access/validate", { code: first })).body.valid).toBe(false);
    await db.delete(adminInviteCodes).where(inArray(adminInviteCodes.code, made.body.codes));
  });

  it("invites a waitlist entry with a single-use code, once", async () => {
    const email = `${P}-invitee@test.local`;
    await call(null, "POST", "/api/access/waitlist", { email });
    const pending = await call(ADMIN, "GET", "/api/admin/access/waitlist?status=pending");
    const entry = pending.body.items.find((i: any) => i.email === email);
    expect(entry.invitedAt).toBeNull();
    const invited = await call(ADMIN, "POST", `/api/admin/access/waitlist/${entry.id}/invite`);
    expect(invited.status).toBe(200);
    expect(invited.body.reused).toBe(false);
    const again = await call(ADMIN, "POST", `/api/admin/access/waitlist/${entry.id}/invite`);
    expect(again.body.code).toBe(invited.body.code);
    expect(again.body.reused).toBe(true);

    const after = await call(ADMIN, "GET", "/api/admin/access/waitlist?status=invited");
    expect(after.body.items.find((i: any) => i.email === email)).toMatchObject({ code: invited.body.code });
    expect(after.body.counts.invited).toBeGreaterThanOrEqual(1);

    // Single use: second person cannot reuse it.
    await seedUser(`${P}-invA`); await seedUser(`${P}-invB`);
    expect((await call(`${P}-invA`, "POST", "/api/access/redeem", { code: invited.body.code })).status).toBe(200);
    expect((await call(`${P}-invB`, "POST", "/api/access/redeem", { code: invited.body.code })).status).toBe(400);
    expect((await call(ADMIN, "POST", `/api/admin/access/waitlist/${crypto.randomUUID()}/invite`)).status).toBe(404);
    expect((await call(ADMIN, "POST", "/api/admin/access/waitlist/not-a-uuid/invite")).status).toBe(404);
  });
});
