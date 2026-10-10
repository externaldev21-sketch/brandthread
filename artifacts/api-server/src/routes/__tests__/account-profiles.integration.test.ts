/**
 * One login = at most one buyer profile + one seller profile.
 *
 * Real Postgres; Clerk and auth are mocked only at the boundary. Covers:
 * the same login can't create a 2nd buyer or 2nd seller (route, PATCH
 * /profile, and the DB unique index), profiles stay separate users, switching
 * tokens only for your own profiles, per-person limits (trial, referral, AI
 * sample, daily Thread Cash), deleting one profile keeps the other, "Delete
 * login" deletes both, and mail for a linked profile reaches the login inbox.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, users, accountProfiles, referrals, threadCashStreaks } from "@workspace/db";

process.env.LINKED_PROFILE_EMAIL_DOMAIN = "linked.test";

const state = vi.hoisted(() => ({
  userId: "",
  clerk: new Map<string, { id: string; emailAddresses: { id: string; emailAddress: string }[]; primaryEmailAddressId: string; passwordEnabled: boolean }>(),
  created: [] as string[],
  deleted: [] as string[],
  revoked: [] as string[],
  tokensFor: [] as string[],
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = state.userId; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requirePlan: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUser: async (id: string) => {
        const u = state.clerk.get(id);
        if (!u) throw Object.assign(new Error("Not Found"), { status: 404 });
        return { ...u, firstName: "Ava", lastName: "Stone", imageUrl: "" };
      },
      createUser: async (params: { emailAddress: string[]; externalId: string }) => {
        const id = `user_linked_${crypto.randomBytes(6).toString("hex")}`;
        state.clerk.set(id, { id, emailAddresses: [{ id: `idn_${id}`, emailAddress: params.emailAddress[0] }], primaryEmailAddressId: `idn_${id}`, passwordEnabled: false });
        state.created.push(id);
        return { id };
      },
      deleteUser: async (id: string) => { state.deleted.push(id); state.clerk.delete(id); },
      verifyPassword: async ({ password }: { password: string }) => ({ verified: password === "correct horse" }),
    },
    signInTokens: {
      createSignInToken: async ({ userId }: { userId: string }) => { state.tokensFor.push(userId); return { token: `tok_${userId}` }; },
    },
    sessions: {
      getSessionList: async ({ userId }: { userId: string }) => ({ data: [{ id: `sess_${userId}` }] }),
      revokeSession: async (id: string) => { state.revoked.push(id); },
    },
  },
}));

vi.mock("../loyalty", () => ({ awardLoyaltyPointsOnce: vi.fn(async () => undefined) }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendWelcomeEmail: vi.fn(async () => true) }));

const suffix = crypto.randomBytes(5).toString("hex");
const buyerLogin = `acct-buyer-login-${suffix}`;
const sellerLogin = `acct-seller-login-${suffix}`;
const stranger = `acct-stranger-${suffix}`;
const allIds = () => [buyerLogin, sellerLogin, stranger, ...state.created];

let server: Server;
let base = "";

async function call(as: string, method: string, path: string, body?: unknown) {
  state.userId = as;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function seed(clerkId: string, accountType: "buyer" | "seller", email: string) {
  state.clerk.set(clerkId, { id: clerkId, emailAddresses: [{ id: `idn_${clerkId}`, emailAddress: email }], primaryEmailAddressId: `idn_${clerkId}`, passwordEnabled: true });
  await db.insert(users).values({
    clerkId, email, name: "Ava Stone", displayName: "Ava Stone", role: "owner",
    accountType, onboardingComplete: true, ageBand: "18_plus", username: `u_${crypto.randomBytes(8).toString("hex")}`,
  });
}

beforeAll(async () => {
  await seed(buyerLogin, "buyer", `${buyerLogin}@example.test`);
  await seed(sellerLogin, "seller", `${sellerLogin}@example.test`);
  await seed(stranger, "buyer", `${stranger}@example.test`);

  const [{ default: accountsRouter }, { default: authRouter }] = await Promise.all([
    import("../accounts"),
    import("../auth"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { warn: () => {}, error: () => {}, info: () => {} }; next(); });
  app.use("/api/accounts", accountsRouter);
  app.use("/api/auth", authRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server) return;
  const ids = allIds();
  await db.delete(accountProfiles).where(inArray(accountProfiles.loginClerkId, ids));
  await db.delete(referrals).where(inArray(referrals.inviteeId, ids));
  await db.delete(threadCashStreaks).where(inArray(threadCashStreaks.buyerId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let linkedSeller = "";

describe("one login = at most one buyer + one seller", () => {
  it("Start selling creates a separate seller profile under the same login, no new email or password", async () => {
    const res = await call(buyerLogin, "POST", "/api/accounts/profiles", { role: "seller" });
    expect(res.status).toBe(201);
    linkedSeller = res.body.profile.clerkId;
    expect(res.body.profile.role).toBe("seller");
    expect(res.body.signInToken).toBe(`tok_${linkedSeller}`);

    const [row] = await db.select().from(users).where(eq(users.clerkId, linkedSeller));
    expect(row!.accountType).toBe("seller");
    expect(row!.onboardingComplete).toBe(false);
    expect(row!.email).toMatch(/@linked\.test$/);
    expect(row!.username).toBeNull(); // its own @username, picked in onboarding
    expect(state.clerk.get(linkedSeller)!.passwordEnabled).toBe(false);

    const links = await db.select().from(accountProfiles).where(eq(accountProfiles.loginClerkId, buyerLogin));
    expect(links.map((l) => `${l.profileClerkId}:${l.role}`).sort()).toEqual([`${buyerLogin}:buyer`, `${linkedSeller}:seller`].sort());
  });

  it("the same login can't create a 2nd seller", async () => {
    const res = await call(buyerLogin, "POST", "/api/accounts/profiles", { role: "seller" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROFILE_ROLE_EXISTS");
    expect(res.body.error).toBe("This email already has a seller account. Switch to it.");
    expect(res.body.profileClerkId).toBe(linkedSeller);
  });

  it("the same login can't create a 2nd buyer, from either profile", async () => {
    const fromBuyer = await call(buyerLogin, "POST", "/api/accounts/profiles", { role: "buyer" });
    expect(fromBuyer.status).toBe(409);
    expect(fromBuyer.body.error).toBe("This email already has a buyer account. Switch to it.");
    const fromSeller = await call(linkedSeller, "POST", "/api/accounts/profiles", { role: "buyer" });
    expect(fromSeller.status).toBe(409);
    expect(fromSeller.body.profileClerkId).toBe(buyerLogin);
  });

  it("the DB itself refuses a 2nd live seller for one login", async () => {
    await expect(db.insert(accountProfiles).values({ loginClerkId: buyerLogin, profileClerkId: `${stranger}-x`, role: "seller" }))
      .rejects.toMatchObject({ cause: expect.objectContaining({ constraint: "account_profiles_login_role_unique" }) });
  });

  it("flipping a profile to the role its sibling holds is refused", async () => {
    const res = await call(linkedSeller, "PATCH", "/api/auth/profile", { accountType: "buyer" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROFILE_ROLE_EXISTS");
    const [row] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.clerkId, linkedSeller));
    expect(row!.accountType).toBe("seller");
  });

  it("a solo account keeps flipping its own role as before", async () => {
    const res = await call(stranger, "PATCH", "/api/auth/profile", { accountType: "seller" });
    expect(res.status).toBe(200);
    await call(stranger, "PATCH", "/api/auth/profile", { accountType: "buyer" });
  });

  it("Shop as a buyer works the same way from a seller login", async () => {
    const res = await call(sellerLogin, "POST", "/api/accounts/profiles", { role: "buyer" });
    expect(res.status).toBe(201);
    expect(res.body.profile.role).toBe("buyer");
  });

  it("lists only your own profiles, with the login marked", async () => {
    const res = await call(linkedSeller, "GET", "/api/accounts/profiles");
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.profiles.map((p: any) => [p.clerkId, p]));
    expect(Object.keys(byId).sort()).toEqual([buyerLogin, linkedSeller].sort());
    expect(byId[buyerLogin].isLogin).toBe(true);
    expect(byId[linkedSeller].isCurrent).toBe(true);
    expect(res.body.canAdd).toEqual({ buyer: false, seller: false });

    const solo = await call(stranger, "GET", "/api/accounts/profiles");
    expect(solo.body.profiles.map((p: any) => p.clerkId)).toEqual([stranger]);
    expect(solo.body.canAdd).toEqual({ buyer: false, seller: true });
  });

  it("switch tokens only for profiles of the same login", async () => {
    const own = await call(buyerLogin, "POST", `/api/accounts/profiles/${linkedSeller}/sign-in-token`);
    expect(own.status).toBe(200);
    expect(own.body.signInToken).toBe(`tok_${linkedSeller}`);
    const foreign = await call(stranger, "POST", `/api/accounts/profiles/${linkedSeller}/sign-in-token`);
    expect(foreign.status).toBe(404);
  });
});

describe("per-person limits are shared by linked profiles", () => {
  it("one free trial per person", async () => {
    const { personHadTrial, withPersonTrialRule } = await import("../../lib/personTrial");
    expect(await personHadTrial(linkedSeller)).toBe(false);
    await db.update(users).set({ subscriptionTrialStartedAt: new Date() }).where(eq(users.clerkId, buyerLogin));
    expect(await personHadTrial(linkedSeller)).toBe(true);
    expect(await personHadTrial(stranger)).toBe(false);
    await db.update(users).set({ subscriptionTrialStartedAt: null }).where(eq(users.clerkId, buyerLogin));

    const params = { mode: "subscription", subscription_data: { trial_period_days: 7, metadata: { a: 1 } } };
    expect(withPersonTrialRule(false, params).subscription_data).toEqual({ metadata: { a: 1 } });
    expect(withPersonTrialRule(true, params)).toBe(params);
  });

  it("one referral credit per person, and no referring your own other profile", async () => {
    const { applyReferralCode } = await import("../../lib/referrals/rewards");
    const code = `INV${suffix}`.toUpperCase();
    await db.update(users).set({ inviteCode: code }).where(eq(users.clerkId, buyerLogin));
    const self = await applyReferralCode({ inviteeId: linkedSeller, code });
    expect(self).toMatchObject({ ok: false, code: "SELF_REFERRAL" });

    await db.insert(referrals).values({ inviterId: stranger, inviteeId: buyerLogin, inviteCode: "STRANGER", source: "code" });
    const strangerCode = `STR${suffix}`.toUpperCase();
    await db.update(users).set({ inviteCode: strangerCode }).where(eq(users.clerkId, stranger));
    const again = await applyReferralCode({ inviteeId: linkedSeller, code: strangerCode });
    expect(again).toMatchObject({ ok: false, code: "ALREADY_APPLIED" });
  });

  it("the onboarding AI sample is keyed by person", async () => {
    const { personKeyFor } = await import("../../lib/accountProfiles");
    expect(await personKeyFor(linkedSeller)).toBe(buyerLogin);
    expect(await personKeyFor(buyerLogin)).toBe(buyerLogin);
    expect(await personKeyFor(stranger)).toBe(stranger);
  });

  it("one daily Thread Cash reward per person", async () => {
    const { default: threadCashRouter } = await import("../thread-cash");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.clerkUserId = state.userId; req.log = { warn: () => {}, error: () => {}, info: () => {} }; next(); });
    app.use("/tc", threadCashRouter);
    const tcServer: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const tcBase = `http://127.0.0.1:${(tcServer.address() as AddressInfo).port}`;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(threadCashStreaks).values({ buyerId: buyerLogin, currentStreak: 1, longestStreak: 1, lastCheckInDate: today, timezone: "UTC" } as any);
      state.userId = linkedSeller;
      const res = await fetch(`${tcBase}/tc/check-in`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: "UTC" }) });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("THREAD_CASH_CLAIMED_ON_LINKED_PROFILE");
    } finally {
      await new Promise<void>((resolve) => tcServer.close(() => resolve()));
    }
  });
});

describe("mail for a linked profile reaches the login inbox", () => {
  it("rewrites only linked placeholders", async () => {
    const { deliveryAddressFor } = await import("../../lib/profileDelivery");
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, linkedSeller));
    expect(await deliveryAddressFor(row!.email)).toBe(`${buyerLogin}@example.test`);
    expect(await deliveryAddressFor("someone@example.test")).toBe("someone@example.test");
  });
});

describe("deleting one profile keeps the other; Delete login deletes both", () => {
  beforeEach(() => { state.revoked = []; state.deleted = []; });

  it("deleting the login's own profile keeps the login (its sessions and Clerk user) for the seller profile", async () => {
    const res = await call(buyerLogin, "DELETE", "/api/auth/account", { confirmation: "DELETE", password: "correct horse" });
    expect(res.status).toBe(200);
    expect(state.revoked).toEqual([]); // the login still reaches the seller profile

    // Signing in during the grace period does not silently restore it.
    const sync = await call(buyerLogin, "POST", "/api/auth/sync", {});
    expect(sync.status).toBe(200);
    const [pending] = await db.select({ requested: users.deletionRequestedAt }).from(users).where(eq(users.clerkId, buyerLogin));
    expect(pending!.requested).not.toBeNull();

    // Grace ends: profile purged, login kept, role free again.
    await db.update(users).set({ deletionScheduledFor: new Date(Date.now() - 1000) }).where(eq(users.clerkId, buyerLogin));
    const { runAccountPurge } = await import("../../jobs/accountPurge");
    await runAccountPurge(new Date());
    expect(state.deleted).not.toContain(buyerLogin);
    const [link] = await db.select().from(accountProfiles).where(eq(accountProfiles.profileClerkId, buyerLogin));
    expect(link!.deletedAt).not.toBeNull();
    const [seller] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.clerkId, linkedSeller));
    expect(seller!.deletedAt).toBeNull();

    const gone = await call(buyerLogin, "POST", "/api/auth/sync", {});
    expect(gone.status).toBe(410);
    expect(gone.body.hasOtherProfiles).toBe(true);

    // Mail still reaches the person via the login's Clerk email.
    const { deliveryAddressFor } = await import("../../lib/profileDelivery");
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, linkedSeller));
    expect(await deliveryAddressFor(row!.email)).toBe(`${buyerLogin}@example.test`);

    // The buyer role can be created again under the same login.
    const again = await call(linkedSeller, "POST", "/api/accounts/profiles", { role: "buyer" });
    expect(again.status).toBe(201);
  });

  it("Delete login schedules every profile and revokes every session", async () => {
    const live = await db.select({ id: accountProfiles.profileClerkId }).from(accountProfiles)
      .where(and(eq(accountProfiles.loginClerkId, sellerLogin), isNull(accountProfiles.deletedAt)));
    expect(live).toHaveLength(2);
    const res = await call(sellerLogin, "DELETE", "/api/accounts/login", { confirmation: "DELETE", password: "correct horse" });
    expect(res.status).toBe(200);
    expect(res.body.profiles).toBe(2);
    const rows = await db.select({ requested: users.deletionRequestedAt }).from(users)
      .where(inArray(users.clerkId, live.map((l) => l.id)));
    expect(rows.every((r) => r.requested !== null)).toBe(true);
    expect(state.revoked.sort()).toEqual(live.map((l) => `sess_${l.id}`).sort());

    await db.update(users).set({ deletionScheduledFor: new Date(Date.now() - 1000) }).where(inArray(users.clerkId, live.map((l) => l.id)));
    const { runAccountPurge } = await import("../../jobs/accountPurge");
    await runAccountPurge(new Date());
    expect(state.deleted.sort()).toEqual(live.map((l) => l.id).sort());
  });

  it("Delete login needs the typed confirmation and re-auth", async () => {
    expect((await call(stranger, "DELETE", "/api/accounts/login", {})).status).toBe(400);
    expect((await call(stranger, "DELETE", "/api/accounts/login", { confirmation: "DELETE", password: "nope" })).status).toBeGreaterThanOrEqual(400);
  });
});
