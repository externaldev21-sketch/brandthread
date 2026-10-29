/**
 * Wave-1 audit (slice s01) — routes/affiliate-creator.ts
 *
 *  - POST /invites/:id/accept|decline with a malformed id is a 404 (the id is
 *    a uuid column; it used to reach Postgres and 500).
 *  - POST /payout-account/onboard: when a concurrent onboard saved its Stripe
 *    account first, the link is for the SAVED account, never for an orphan
 *    account that isn't linked to the creator.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const CREATOR = `w1s01-creator-${sfx}`;

const fake = vi.hoisted(() => ({
  onAccountCreate: null as null | (() => Promise<void>),
  createdAccounts: [] as string[],
  linkedAccounts: [] as string[],
}));

vi.mock("../../lib/stripe", () => {
  const client = {
    accounts: {
      create: async () => {
        if (fake.onAccountCreate) { const h = fake.onAccountCreate; fake.onAccountCreate = null; await h(); }
        const id = `acct_new_${fake.createdAccounts.length + 1}`;
        fake.createdAccounts.push(id);
        return { id };
      },
      retrieve: async () => ({ charges_enabled: true, payouts_enabled: true, details_submitted: true }),
    },
    accountLinks: {
      create: async (p: { account: string }) => {
        fake.linkedAccounts.push(p.account);
        return { url: `https://connect.stripe.test/${p.account}` };
      },
    },
  };
  return { requireStripe: () => client, stripe: client };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = CREATOR; next(); },
}));

let server: Server;
let base = "";
const prevFlag = process.env.AFFILIATE_PAYOUTS_ENABLED;

beforeAll(async () => {
  process.env.AFFILIATE_PAYOUTS_ENABLED = "true";
  await db.insert(users).values({ clerkId: CREATOR, email: `${CREATOR}@test.local`, name: "Creator" });
  const { default: router } = await import("../affiliate-creator");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use("/api/affiliate", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/affiliate`;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.AFFILIATE_PAYOUTS_ENABLED;
  else process.env.AFFILIATE_PAYOUTS_ENABLED = prevFlag;
  await db.delete(users).where(eq(users.clerkId, CREATOR));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { fake.onAccountCreate = null; fake.createdAccounts.length = 0; fake.linkedAccounts.length = 0; });

describe("POST /invites/:id/accept|decline", () => {
  it("is a 404 for a malformed invite id, never a 500", async () => {
    for (const action of ["accept", "decline"]) {
      const res = await fetch(`${base}/invites/not-a-uuid/${action}`, { method: "POST" });
      expect(res.status).toBe(404);
    }
  });
});

describe("POST /payout-account/onboard", () => {
  it("onboards the account a concurrent request saved, not an unlinked one", async () => {
    await db.update(users).set({ stripeAccountId: null }).where(eq(users.clerkId, CREATOR));
    // The other request's account lands between our read and our write.
    fake.onAccountCreate = async () => {
      await db.update(users).set({ stripeAccountId: "acct_saved_first" }).where(eq(users.clerkId, CREATOR));
    };
    const res = await fetch(`${base}/payout-account/onboard`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(fake.linkedAccounts).toEqual(["acct_saved_first"]);
    const [row] = await db.select({ id: users.stripeAccountId }).from(users).where(eq(users.clerkId, CREATOR));
    expect(row.id).toBe("acct_saved_first");
  });

  it("creates, saves and onboards a new account when the creator has none", async () => {
    await db.update(users).set({ stripeAccountId: null }).where(eq(users.clerkId, CREATOR));
    const res = await fetch(`${base}/payout-account/onboard`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(fake.linkedAccounts).toEqual(["acct_new_1"]);
    const [row] = await db.select({ id: users.stripeAccountId }).from(users).where(eq(users.clerkId, CREATOR));
    expect(row.id).toBe("acct_new_1");
  });
});
