/**
 * Password reset (Resend-backed, Clerk-settled) integration coverage.
 *
 * Real DB rows for `password_reset_codes`; Clerk and the mailer are mocked
 * only at the boundary. Covers: unknown-email non-leak, MAIL_NOT_CONFIGURED,
 * wrong code, expired code, single-use, and the happy path through to the
 * Clerk password update.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, passwordResetCodes } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const email = `password-reset-${suffix}@test.local`;
const clerkUserId = `password-reset-test-${suffix}`;

const state = vi.hoisted(() => ({
  mailerConfigured: true,
  lastSentCode: "",
  sendCalls: [] as Array<{ to: string; code: string }>,
  updateUserCalls: [] as Array<{ userId: string; password: string }>,
}));

vi.mock("../../lib/mailer", () => ({
  isMailerConfigured: () => state.mailerConfigured,
  sendPasswordResetEmail: vi.fn(async (options: { to: string; code: string }) => {
    state.lastSentCode = options.code;
    state.sendCalls.push(options);
    return true;
  }),
  sendVerifyEmailEmail: vi.fn(async () => true),
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null, sessionId: null }),
  clerkClient: {
    users: {
      getUserList: vi.fn(async ({ emailAddress }: { emailAddress: string[] }) => {
        const wanted = emailAddress[0];
        return { data: wanted === email ? [{ id: clerkUserId }] : [] };
      }),
      updateUser: vi.fn(async (userId: string, options: { password: string }) => {
        state.updateUserCalls.push({ userId, password: options.password });
        return { id: userId };
      }),
    },
  },
}));

let server: Server;
let base = "";

async function requestReset(body: unknown) {
  const response = await fetch(`${base}/api/auth/password-reset/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function confirmReset(body: unknown) {
  const response = await fetch(`${base}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  // The "authentication" rate-limit bucket is real, DB-backed, and keyed by
  // IP for these unauthenticated routes. Clear it first so a re-run within
  // the same 10-minute window (or a prior test file that also hit /auth/*)
  // never starts this file already partway to the limit.
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'authentication:%'`);

  const { default: authRouter } = await import("../auth");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use("/api/auth", authRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(passwordResetCodes).where(eq(passwordResetCodes.email, email));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.mailerConfigured = true;
  state.lastSentCode = "";
  state.sendCalls = [];
  state.updateUserCalls = [];
});

describe("POST /api/auth/password-reset/request", () => {
  it("responds with the same generic success shape for an unknown email", async () => {
    const result = await requestReset({ email: `nobody-${suffix}@test.local` });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
    expect(state.sendCalls).toHaveLength(0);
  });

  it("returns a typed MAIL_NOT_CONFIGURED error and never claims an email was sent", async () => {
    state.mailerConfigured = false;
    const result = await requestReset({ email });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe("MAIL_NOT_CONFIGURED");
    expect(state.sendCalls).toHaveLength(0);
  });

  it("issues and emails a hashed, single-use code for a known account", async () => {
    const result = await requestReset({ email });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
    expect(state.sendCalls).toHaveLength(1);
    expect(state.lastSentCode).toMatch(/^\d{6}$/);

    const [row] = await db.select().from(passwordResetCodes).where(eq(passwordResetCodes.email, email));
    expect(row).toBeTruthy();
    expect(row.codeHash).not.toBe(state.lastSentCode);
    expect(row.codeHash).toBe(crypto.createHash("sha256").update(state.lastSentCode).digest("hex"));
    expect(row.usedAt).toBeNull();
  });
});

describe("POST /api/auth/password-reset/confirm", () => {
  it("rejects a wrong code", async () => {
    await requestReset({ email });
    const wrongCode = state.lastSentCode === "111111" ? "222222" : "111111";
    const result = await confirmReset({ email, code: wrongCode, newPassword: "a-new-password" });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("INVALID_CODE");
    expect(state.updateUserCalls).toHaveLength(0);
  });

  it("rejects an expired code", async () => {
    await requestReset({ email });
    await db.update(passwordResetCodes)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(passwordResetCodes.email, email));

    const result = await confirmReset({ email, code: state.lastSentCode, newPassword: "a-new-password" });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("CODE_EXPIRED");
    expect(state.updateUserCalls).toHaveLength(0);
  });

  it("rejects weak passwords before touching the code", async () => {
    await requestReset({ email });
    const result = await confirmReset({ email, code: state.lastSentCode, newPassword: "short" });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("WEAK_PASSWORD");
    expect(state.updateUserCalls).toHaveLength(0);
  });

  it("resets the password through Clerk on the happy path, then rejects reuse of the same code", async () => {
    await requestReset({ email });
    const code = state.lastSentCode;

    const success = await confirmReset({ email, code, newPassword: "a-brand-new-password" });
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ ok: true });
    expect(state.updateUserCalls).toEqual([{ userId: clerkUserId, password: "a-brand-new-password" }]);

    const reuse = await confirmReset({ email, code, newPassword: "yet-another-password" });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe("INVALID_CODE");
    expect(state.updateUserCalls).toHaveLength(1);
  });
});
