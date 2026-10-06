/**
 * Public web account-deletion request. The database, mailer, rate limiter and
 * the deletion handler are all mocked: this file never touches a real account.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  deletionConfirmLink,
  generateDeletionToken,
  hashDeletionToken,
  isWellFormedDeletionToken,
  runHandlerCapturing,
} from "../../lib/accountDeletionRequests";

const state = vi.hoisted(() => ({
  mailer: true,
  account: null as null | { clerkId: string },
  latestRequest: null as null | { createdAt: Date },
  claim: null as null | { id: string; clerkId: string },
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; link: string }>,
  handlerCalls: [] as Array<Record<string, any>>,
  handlerResult: { status: 200, body: { ok: true } as Record<string, unknown> },
  selectCount: 0,
}));

function chain(result: () => unknown) {
  const c: any = {};
  for (const m of ["from", "where", "orderBy", "limit", "set", "values"]) c[m] = () => c;
  c.returning = () => Promise.resolve(result());
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return c;
}

vi.mock("@workspace/db", () => ({
  users: { clerkId: "clerkId", email: "email", deletedAt: "deletedAt" },
  accountDeletionRequests: {
    email: "email", createdAt: "createdAt", tokenHash: "tokenHash", status: "status", expiresAt: "expiresAt", id: "id", clerkId: "clerkId",
  },
  db: {
    select: () => {
      state.selectCount += 1;
      const first = state.selectCount % 2 === 1;
      return chain(() => (first ? (state.account ? [state.account] : []) : (state.latestRequest ? [state.latestRequest] : [])));
    },
    insert: () => ({ values: (v: Record<string, unknown>) => { state.inserts.push(v); return Promise.resolve(); } }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.updates.push(v);
        return chain(() => (v.status === "processing" ? (state.claim ? [state.claim] : []) : []));
      },
    }),
  },
}));

vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../lib/mailer", () => ({
  isMailerConfigured: () => state.mailer,
  sendAccountDeletionEmail: vi.fn(async (o: { to: string; link: string }) => { state.emails.push(o); return true; }),
}));
vi.mock("../auth", () => ({
  accountDeletionHandler: async (req: any, res: any) => {
    state.handlerCalls.push({ clerkUserId: req.clerkUserId, body: req.body });
    res.status(state.handlerResult.status).json(state.handlerResult.body);
  },
}));

import router from "../account-deletion-public";

let server: Server;
let base = "";

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}/api/public/account-deletion${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { warn() {}, error() {}, info() {} }; next(); });
  app.use("/api/public/account-deletion", router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  Object.assign(state, {
    mailer: true, account: null, latestRequest: null, claim: null, inserts: [], updates: [], emails: [],
    handlerCalls: [], handlerResult: { status: 200, body: { ok: true } }, selectCount: 0,
  });
});

const goodToken = "a".repeat(64);

describe("token helpers", () => {
  it("issues unguessable tokens and stores only a hash", () => {
    const token = generateDeletionToken();
    expect(isWellFormedDeletionToken(token)).toBe(true);
    expect(hashDeletionToken(token)).not.toContain(token);
    expect(hashDeletionToken(token)).toHaveLength(64);
    expect(generateDeletionToken()).not.toBe(token);
    expect(isWellFormedDeletionToken("short")).toBe(false);
    expect(deletionConfirmLink("https://brandthread.app", token)).toBe(`https://brandthread.app/account-deletion?token=${token}`);
  });

  it("captures an express handler result", async () => {
    const out = await runHandlerCapturing((_req, res) => res.status(409).json({ code: "DELETION_BLOCKED" }), {});
    expect(out).toEqual({ status: 409, body: { code: "DELETION_BLOCKED" } });
  });
});

describe("POST /request", () => {
  it("answers identically for unknown and known emails and only mails known ones", async () => {
    const unknown = await post("/request", { email: "nobody@example.test" });
    expect(state.emails).toHaveLength(0);

    state.selectCount = 0;
    state.account = { clerkId: "user_test_1" };
    const known = await post("/request", { email: "Owner@Example.test" });
    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].to).toBe("owner@example.test");
    const token = state.emails[0].link.split("token=")[1];
    expect(state.inserts[0]).toMatchObject({ email: "owner@example.test", clerkId: "user_test_1", tokenHash: hashDeletionToken(token) });
    expect(JSON.stringify(state.inserts[0])).not.toContain(token);
    expect(state.handlerCalls).toHaveLength(0); // requesting never deletes anything
  });

  it("does not send a second email inside the cooldown", async () => {
    state.account = { clerkId: "user_test_1" };
    state.latestRequest = { createdAt: new Date() };
    await post("/request", { email: "owner@example.test" });
    expect(state.emails).toHaveLength(0);
  });

  it("reports a typed error when mail is not configured", async () => {
    state.mailer = false;
    const res = await post("/request", { email: "owner@example.test" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("MAIL_NOT_CONFIGURED");
  });

  it("rejects an invalid email", async () => {
    expect((await post("/request", { email: "nope" })).status).toBe(400);
  });
});

describe("POST /confirm", () => {
  it("requires the exact DELETE confirmation and a well-formed token", async () => {
    expect((await post("/confirm", { token: goodToken, confirmation: "delete" })).status).toBe(400);
    expect((await post("/confirm", { token: "bad", confirmation: "DELETE" })).status).toBe(400);
    expect(state.handlerCalls).toHaveLength(0);
  });

  it("rejects an unknown, expired or already used link without deleting", async () => {
    state.claim = null;
    const res = await post("/confirm", { token: goodToken, confirmation: "DELETE" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
    expect(state.handlerCalls).toHaveLength(0);
  });

  it("runs the existing deletion for the verified owner and marks the request completed", async () => {
    state.claim = { id: "req_1", clerkId: "user_test_1" };
    const res = await post("/confirm", { token: goodToken, confirmation: "DELETE" });
    expect(res.status).toBe(200);
    expect(state.handlerCalls).toEqual([{ clerkUserId: "user_test_1", body: { confirmation: "DELETE" } }]);
    expect(state.updates.map((u) => u.status)).toEqual(["processing", "completed"]);
  });

  it("passes blockers through and releases the claim so the owner can retry", async () => {
    state.claim = { id: "req_1", clerkId: "user_test_1" };
    state.handlerResult = { status: 409, body: { code: "DELETION_BLOCKED", error: "Settle the items below before deleting your account.", blockers: [] } };
    const res = await post("/confirm", { token: goodToken, confirmation: "DELETE" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DELETION_BLOCKED");
    expect(state.updates.map((u) => u.status)).toEqual(["processing", "pending"]);
  });
});
