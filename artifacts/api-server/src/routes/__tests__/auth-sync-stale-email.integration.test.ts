import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Regression: a brand-new account with a brand-new (to Clerk) email was told
// "An account with this email already exists" because a local users row from a
// deleted Clerk user still carried that email. Only a live owner may block it.

const state = vi.hoisted(() => ({
  selfId: "",
  clerkUsers: new Map<string, { id: string; emailAddresses: { emailAddress: string }[] }>(),
  failLookups: false,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.selfId }),
  clerkClient: {
    users: {
      getUser: vi.fn(async (id: string) => {
        if (state.failLookups && id !== state.selfId) throw Object.assign(new Error("Clerk down"), { status: 503 });
        const user = state.clerkUsers.get(id);
        if (!user) throw Object.assign(new Error("Not Found"), { status: 404, errors: [{ code: "resource_not_found" }] });
        return { ...user, firstName: "New", lastName: "Person", imageUrl: "", primaryEmailAddressId: null };
      }),
    },
  },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.selfId;
    next();
  },
}));

vi.mock("../loyalty", () => ({ awardLoyaltyPointsOnce: vi.fn(async () => undefined) }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendWelcomeEmail: vi.fn(async () => true) }));

const suffix = crypto.randomBytes(6).toString("hex");
const created: string[] = [];
let server: Server;
let base = "";

async function seedHolder(clerkId: string, email: string) {
  created.push(clerkId);
  await db.insert(users).values({ clerkId, email, name: "Holder", displayName: "Holder", role: "owner", accountType: "buyer" });
}

async function syncAs(clerkId: string, email: string) {
  state.selfId = clerkId;
  created.push(clerkId);
  state.clerkUsers.set(clerkId, { id: clerkId, emailAddresses: [{ emailAddress: email }] });
  const response = await fetch(`${base}/api/auth/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "New Person" }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  const { default: authRouter } = await import("../auth");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { warn: () => {}, error: () => {}, info: () => {} }; next(); });
  app.use("/api/auth", authRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (created.length) await db.delete(users).where(inArray(users.clerkId, created));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/auth/sync with an email a local row still carries", () => {
  it("creates the new account when the old Clerk user was deleted, and keeps the old row", async () => {
    const email = `stale-deleted-${suffix}@test.local`;
    const ghost = `stale-ghost-${suffix}`;
    await seedHolder(ghost, email); // no Clerk user behind it

    const res = await syncAs(`stale-new-${suffix}`, email);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);

    const [old] = await db.select().from(users).where(eq(users.clerkId, ghost));
    expect(old).toBeDefined();
    expect(old!.email).toMatch(/@released\.brandthread\.invalid$/);
  });

  it("creates the new account when the old Clerk user moved to a different email", async () => {
    const email = `stale-moved-${suffix}@test.local`;
    const mover = `stale-mover-${suffix}`;
    await seedHolder(mover, email);
    state.clerkUsers.set(mover, { id: mover, emailAddresses: [{ emailAddress: `elsewhere-${suffix}@test.local` }] });

    const res = await syncAs(`stale-new2-${suffix}`, email);
    expect(res.status).toBe(201);
  });

  it("still answers EMAIL_TAKEN when a live account owns the email", async () => {
    const email = `live-owner-${suffix}@test.local`;
    const owner = `live-owner-${suffix}`;
    await seedHolder(owner, email);
    state.clerkUsers.set(owner, { id: owner, emailAddresses: [{ emailAddress: email }] });

    const res = await syncAs(`live-new-${suffix}`, email);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
    const [kept] = await db.select().from(users).where(eq(users.clerkId, owner));
    expect(kept!.email).toBe(email);
  });

  it("never releases an email when Clerk can't be reached", async () => {
    const email = `outage-${suffix}@test.local`;
    const holder = `outage-holder-${suffix}`;
    await seedHolder(holder, email);
    state.failLookups = true;
    try {
      const res = await syncAs(`outage-new-${suffix}`, email);
      expect(res.status).toBe(409);
    } finally {
      state.failLookups = false;
    }
    const [kept] = await db.select().from(users).where(eq(users.clerkId, holder));
    expect(kept!.email).toBe(email);
  });

  it("a brand-new email with no local row just creates the account", async () => {
    const res = await syncAs(`fresh-${suffix}`, `fresh-${suffix}@test.local`);
    expect(res.status).toBe(201);
  });
});
