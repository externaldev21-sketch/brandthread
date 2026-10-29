/**
 * Wave-1 audit (slice s02) — routes/auth.ts:
 *  - a password-reset code is burned after a handful of wrong guesses, so the
 *    6-digit space can't be swept from many IPs within the 15-minute TTL;
 *  - repeated query keys (?username=a&username=b) answer normally instead of
 *    crashing the handler with a 500.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, passwordResetCodes, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const email = `w1s02-reset-${suffix}@test.local`;
const clerkUserId = `w1s02-auth-${suffix}`;

const state = vi.hoisted(() => ({
  lastSentCode: "",
  updateUserCalls: [] as Array<{ userId: string; password: string }>,
  authUserId: null as string | null,
}));

vi.mock("../../lib/mailer", () => ({
  isMailerConfigured: () => true,
  sendPasswordResetEmail: vi.fn(async (options: { to: string; code: string }) => {
    state.lastSentCode = options.code;
    return true;
  }),
  sendVerifyEmailEmail: vi.fn(async () => true),
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.authUserId, sessionId: null }),
  clerkClient: {
    users: {
      getUserList: vi.fn(async ({ emailAddress }: { emailAddress: string[] }) =>
        ({ data: emailAddress[0] === email ? [{ id: clerkUserId }] : [] })),
      updateUser: vi.fn(async (userId: string, options: { password: string }) => {
        state.updateUserCalls.push({ userId, password: options.password });
        return { id: userId };
      }),
    },
  },
}));

let server: Server;
let base = "";

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'authentication:%'`);
  await db.insert(users).values({ clerkId: clerkUserId, email: `${clerkUserId}@test.local`, name: "W1 S02 Auth" });
  const { default: authRouter } = await import("../auth");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use("/api/auth", authRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const codes = await db.select({ id: passwordResetCodes.id }).from(passwordResetCodes).where(eq(passwordResetCodes.email, email));
  for (const c of codes) {
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key = ${`password-reset-attempt:${c.id}`}`);
  }
  await db.delete(passwordResetCodes).where(eq(passwordResetCodes.email, email));
  await db.delete(users).where(eq(users.clerkId, clerkUserId));
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'authentication:%'`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.lastSentCode = "";
  state.updateUserCalls = [];
  state.authUserId = null;
});

describe("password-reset confirm attempt cap", () => {
  it("burns the code after 5 wrong guesses, so even the right code no longer works", async () => {
    expect((await post("/password-reset/request", { email })).status).toBe(200);
    const right = state.lastSentCode;
    const wrong = right === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) {
      const res = await post("/password-reset/confirm", { email, code: wrong, newPassword: "a-new-password" });
      expect(res.body.code).toBe("INVALID_CODE");
    }
    const blocked = await post("/password-reset/confirm", { email, code: right, newPassword: "a-new-password" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe("TOO_MANY_ATTEMPTS");
    expect(state.updateUserCalls).toHaveLength(0);
    const [row] = await db.select().from(passwordResetCodes).where(eq(passwordResetCodes.email, email));
    expect(row.usedAt).not.toBeNull();
  });

  it("still accepts the right code after a typo", async () => {
    await db.delete(passwordResetCodes).where(eq(passwordResetCodes.email, email));
    await post("/password-reset/request", { email });
    const right = state.lastSentCode;
    const wrong = right === "000000" ? "000001" : "000000";
    expect((await post("/password-reset/confirm", { email, code: wrong, newPassword: "a-new-password" })).body.code).toBe("INVALID_CODE");
    const ok = await post("/password-reset/confirm", { email, code: right, newPassword: "a-new-password" });
    expect(ok.status).toBe(200);
    expect(state.updateUserCalls).toEqual([{ userId: clerkUserId, password: "a-new-password" }]);
  });
});

describe("repeated query keys", () => {
  it("username/check, email/check and account-types don't 500 on an array query", async () => {
    state.authUserId = clerkUserId;
    const u = await fetch(`${base}/api/auth/username/check?username=abc&username=def`);
    expect(u.status).toBe(200);
    expect(((await u.json()) as any).available).toBe(false);
    const e = await fetch(`${base}/api/auth/email/check?email=a@b.co&email=c@d.co`);
    expect(e.status).toBe(200);
    expect(((await e.json()) as any).available).toBe(false);
    const a = await fetch(`${base}/api/auth/account-types?clerkIds=x&clerkIds=y`);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ accountTypes: {} });
  });
});
