/**
 * QA-0074: accounts without a password (Sign in with Apple / Google) must be
 * able to confirm deletion without depending on an emailed code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { passwordEnabled: false, externalAccounts: [] as Array<{ provider: string; providerUserId: string }> },
  sessionCreatedAt: 0,
  appleSub: "apple-sub-1",
  appleFails: false,
  mailerConfigured: false,
}));

vi.mock("drizzle-orm", () => {
  const passthrough = (...args: unknown[]) => args;
  return { and: passthrough, eq: passthrough, isNull: passthrough, isNotNull: passthrough, desc: passthrough, sql: () => "" };
});
vi.mock("@workspace/db", () => ({
  accountDeletionCodes: {}, users: {},
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: { getUser: async () => state.user },
    sessions: { getSession: async () => ({ createdAt: state.sessionCreatedAt }) },
  },
}));
vi.mock("../mailer", () => ({ isMailerConfigured: () => state.mailerConfigured, sendAccountDeletionCodeEmail: async () => true }));
vi.mock("../appleAuth", async () => {
  class AppleTokenError extends Error { constructor(public reason: string) { super(reason); } }
  return {
    AppleTokenError,
    verifyAppleIdentityToken: async () => {
      if (state.appleFails) throw new AppleTokenError("bad_signature");
      return { sub: state.appleSub, email: null };
    },
  };
});

import { factorAgeIsRecent, getReauthOptions, verifyDeletionReauth } from "../accountDeletion";

const NOW = new Date("2026-10-06T12:00:00Z");

beforeEach(() => {
  state.user = { passwordEnabled: false, externalAccounts: [{ provider: "oauth_apple", providerUserId: "apple-sub-1" }] };
  state.sessionCreatedAt = NOW.getTime() - 60 * 60_000;
  state.appleSub = "apple-sub-1";
  state.appleFails = false;
  state.mailerConfigured = false;
});

describe("SSO re-authentication for deletion (QA-0074)", () => {
  it("accepts a fresh Sign in with Apple for the linked Apple ID", async () => {
    expect(await verifyDeletionReauth("user_1", { appleIdentityToken: "tok" }, { now: NOW })).toEqual({ ok: true });
  });

  it("refuses a different Apple ID or a bad token", async () => {
    state.appleSub = "someone-else";
    expect(await verifyDeletionReauth("user_1", { appleIdentityToken: "tok" }, { now: NOW }))
      .toMatchObject({ ok: false, code: "APPLE_MISMATCH" });
    state.appleSub = "apple-sub-1";
    state.appleFails = true;
    expect(await verifyDeletionReauth("user_1", { appleIdentityToken: "tok" }, { now: NOW }))
      .toMatchObject({ ok: false, code: "APPLE_REAUTH_FAILED" });
  });

  it("refuses Apple re-auth on an account with no Apple sign-in", async () => {
    state.user = { passwordEnabled: false, externalAccounts: [{ provider: "oauth_google", providerUserId: "g1" }] };
    expect(await verifyDeletionReauth("user_1", { appleIdentityToken: "tok" }, { now: NOW }))
      .toMatchObject({ ok: false, code: "APPLE_NOT_LINKED" });
  });

  it("accepts a sign-in from the last 10 minutes (Clerk fva)", async () => {
    expect(await verifyDeletionReauth("user_1", {}, { factorVerificationAge: [2, -1], now: NOW })).toEqual({ ok: true });
    expect(await verifyDeletionReauth("user_1", {}, { factorVerificationAge: [45, -1], now: NOW }))
      .toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
  });

  it("falls back to the session start when the token has no fva", async () => {
    state.sessionCreatedAt = NOW.getTime() - 3 * 60_000;
    expect(await verifyDeletionReauth("user_1", {}, { sessionId: "sess_1", now: NOW })).toEqual({ ok: true });
    state.sessionCreatedAt = NOW.getTime() - 30 * 60_000;
    expect(await verifyDeletionReauth("user_1", {}, { sessionId: "sess_1", now: NOW }))
      .toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
  });

  it("never lets a recent sign-in replace a password", async () => {
    state.user = { passwordEnabled: true, externalAccounts: [] };
    expect(await verifyDeletionReauth("user_1", {}, { factorVerificationAge: [0, -1], now: NOW }))
      .toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
  });

  it("offers Apple and sign-in-again even when email is not configured", async () => {
    expect(await getReauthOptions("user_1", { factorVerificationAge: [60, -1], now: NOW }))
      .toEqual({ apple: true, recentSignIn: false, emailCode: false });
  });

  it("reads Clerk's factor age safely", () => {
    expect(factorAgeIsRecent(null)).toBe(false);
    expect(factorAgeIsRecent([-1, -1])).toBe(false);
    expect(factorAgeIsRecent([10, -1])).toBe(true);
    expect(factorAgeIsRecent([11, -1])).toBe(false);
  });
});
