/** Real deletion handlers with mocked storage/providers: never deletes a real account. */
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scheduled: new Set<string>(), blocked: false, invalid: false, failSchedule: false,
  pending: false, claim: true, failCompletion: false, responseSent: false,
  revocations: [] as { id: string; code: unknown; afterResponse: boolean }[],
}));
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  function chain(result: () => unknown) {
    const c: any = {};
    for (const key of ["from", "where", "limit", "orderBy"]) c[key] = () => c;
    c.returning = () => Promise.resolve(result());
    c.then = (resolve: any, reject: any) => Promise.resolve().then(result).then(resolve, reject);
    return c;
  }
  return {
    ...schema,
    db: {
      select: () => chain(() => [{ id: "account", deletedAt: null,
        deletionRequestedAt: state.pending ? new Date() : null,
        deletionScheduledFor: state.pending ? new Date() : null }]),
      update: () => ({ set: (value: any) => chain(() => {
        if (value.status === "completed" && state.failCompletion) throw new Error("bookkeeping failed");
        return value.status === "processing" && state.claim ? [{ id: "link", clerkId: "user" }] : [];
      }) }),
    },
  };
});
vi.mock("@clerk/express", () => ({ clerkClient: { users: {} }, getAuth: () => ({}) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = "user"; next(); },
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/accountDeletion", () => ({
  DELETION_GRACE_DAYS: 30,
  hasDeletionConfirmation: (body: any) => body?.confirmation === "DELETE",
  isPendingDeletion: (account: any) => !!account.deletionRequestedAt,
  verifyDeletionReauth: async () => state.invalid
    ? { ok: false, status: 401, error: "reauth required" } : { ok: true },
  getDeletionBlockers: async () => state.blocked ? ["open order"] : [],
  scheduleAccountDeletion: async (id: string) => {
    if (state.failSchedule) throw new Error("database failed");
    if (state.scheduled.has(id)) return null;
    state.scheduled.add(id);
    return new Date("2027-01-01");
  },
  revokeAllSessions: async () => 0,
}));
vi.mock("../../lib/accountDeletionBilling", () => ({ getDeletionSubscription: async () => null }));
vi.mock("../../lib/accountProfiles", () => ({
  isLoginWithLiveSiblings: async () => false,
  groupProfiles: async () => ({ login: "user", profiles: [{ profileClerkId: "seller", deletedAt: null }] }),
}));
vi.mock("../../lib/appleSignInRevoke", () => ({
  revokeAppleSignInAfterDeletion: async (id: string, code: unknown) => {
    state.revocations.push({ id, code, afterResponse: state.responseSent });
  },
}));
vi.mock("../loyalty", () => ({ awardLoyaltyPointsOnce: vi.fn() }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("../../lib/mailer", () => ({
  isMailerConfigured: () => true, sendAccountDeletionEmail: vi.fn(),
}));

import authRouter from "../auth";
import accountsRouter from "../accounts";
import publicRouter from "../account-deletion-public";
let server: Server;
let base: string;
beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    req.log = { warn() {}, error() {}, info() {} };
    const json = res.json.bind(res);
    res.json = (body) => { state.responseSent = true; return json(body); };
    next();
  });
  app.use("/auth", authRouter);
  app.use("/accounts", accountsRouter);
  app.use("/public", publicRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });
beforeEach(() => {
  Object.assign(state, { scheduled: new Set(), blocked: false, invalid: false, failSchedule: false,
    pending: false, claim: true, failCompletion: false, responseSent: false, revocations: [] });
});
async function call(path: string, body: Record<string, unknown> = { confirmation: "DELETE" }) {
  return fetch(`${base}${path}`, {
    method: path === "/public/confirm" ? "POST" : "DELETE",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
describe("Apple revocation on every deletion path", () => {
  it("authenticated deletion uses the code after success and never repeats on retry", async () => {
    const body = { confirmation: "DELETE", appleAuthorizationCode: "fresh-code" };
    expect((await call("/auth/account", body)).status).toBe(200);
    expect((await call("/auth/account", body)).status).toBe(200);
    expect(state.revocations).toEqual([{ id: "user", code: "fresh-code", afterResponse: true }]);
  });
  it("recent-sign-in/email-code deletion invokes the Clerk fallback", async () => {
    expect((await call("/auth/account", { confirmation: "DELETE", code: "123456" })).status).toBe(200);
    expect(state.revocations).toEqual([{ id: "user", code: undefined, afterResponse: true }]);
  });
  it("concurrent requests only revoke for the successful scheduling claim", async () => {
    const results = await Promise.all([call("/auth/account"), call("/auth/account")]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(state.revocations).toHaveLength(1);
  });
  it("a restored account can initiate a new revocation on a later deletion", async () => {
    expect((await call("/auth/account")).status).toBe(200);
    state.scheduled.clear(); // Models restoreAccount clearing the deletion claim.
    expect((await call("/auth/account")).status).toBe(200);
    expect(state.revocations).toHaveLength(2);
  });
  it("Delete login covers the login and profiles once, with the code only for its owner", async () => {
    const body = { confirmation: "DELETE", appleAuthorizationCode: "fresh-code" };
    expect((await call("/accounts/login", body)).status).toBe(200);
    expect((await call("/accounts/login", body)).status).toBe(200);
    expect(state.revocations).toEqual([
      { id: "user", code: "fresh-code", afterResponse: true },
      { id: "seller", code: null, afterResponse: true },
    ]);
  });
  it("public email confirmation uses the real handler and revokes only after its final response", async () => {
    expect((await call("/public/confirm", { token: "a".repeat(64), confirmation: "DELETE" })).status).toBe(200);
    expect(state.revocations).toEqual([{ id: "user", code: undefined, afterResponse: true }]);
    state.claim = false;
    expect((await call("/public/confirm", { token: "a".repeat(64), confirmation: "DELETE" })).status).toBe(400);
    expect(state.revocations).toHaveLength(1);
  });
  it("does not revoke when public bookkeeping fails", async () => {
    state.failCompletion = true;
    expect((await call("/public/confirm", { token: "a".repeat(64), confirmation: "DELETE" })).status).toBe(500);
    expect(state.revocations).toEqual([]);
  });
  it.each(["/auth/account", "/accounts/login", "/public/confirm"])("does not revoke blocked deletions on %s", async (path) => {
    state.blocked = true;
    expect((await call(path, { confirmation: "DELETE", token: "a".repeat(64) })).status).toBe(409);
    expect(state.revocations).toEqual([]);
  });
  it.each(["/auth/account", "/accounts/login"])("does not revoke failed identity checks on %s", async (path) => {
    state.invalid = true;
    expect((await call(path)).status).toBe(401);
    expect(state.revocations).toEqual([]);
  });
  it.each(["/auth/account", "/accounts/login"])("does not revoke failed scheduling on %s", async (path) => {
    state.failSchedule = true;
    expect((await call(path)).status).toBe(502);
    expect(state.revocations).toEqual([]);
  });
  it("does not revoke already pending deletion requests", async () => {
    state.pending = true;
    expect((await call("/auth/account")).status).toBe(200);
    expect(state.revocations).toEqual([]);
  });
});
