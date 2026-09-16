/**
 * Signup identity regression coverage.
 *
 * The mobile onboarding flow has to provision the local user before saving
 * seller-only fields. These tests exercise the same route boundary so a
 * future auth/onboarding change cannot silently restore a generated profile
 * or turn the brand write into a no-op for a first-time account.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({
  userId: "",
  clerkUser: {
    id: "",
    emailAddresses: [{ emailAddress: "" }],
    firstName: "OAuth",
    lastName: "Fallback",
    imageUrl: "https://images.test/avatar.png",
  },
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUser: vi.fn(async () => state.clerkUser),
    },
  },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = state.userId;
    next();
  },
}));

vi.mock("./loyalty", () => ({
  awardLoyaltyPointsOnce: vi.fn(async () => undefined),
}));

vi.mock("../lib/brandthreadEmail", () => ({
  sendWelcomeEmail: vi.fn(async () => undefined),
}));

import authRouter from "./auth";

const suffix = crypto.randomBytes(4).toString("hex");
const buyerId = `signup-identity-buyer-${suffix}`;
const sellerId = `signup-identity-seller-${suffix}`;
const incompleteSellerId = `signup-identity-incomplete-${suffix}`;

let server: Server;
let baseUrl = "";

async function request(userId: string, method: string, path: string, body?: unknown) {
  state.userId = userId;
  state.clerkUser = {
    ...state.clerkUser,
    id: userId,
    emailAddresses: [{ emailAddress: `${userId}@test.local` }],
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsedBody: any;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected ${response.status} response from ${method} ${path}: ${text.slice(0, 200)}`);
  }
  return { status: response.status, body: parsedBody };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use("/api/auth", authRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, buyerId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await db.delete(users).where(eq(users.clerkId, incompleteSellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("signup identity synchronization", () => {
  it("uses the onboarding name and buyer role on a first-time local sync", async () => {
    const result = await request(buyerId, "POST", "/api/auth/sync", {
      name: "  Avery   Stone ",
    });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      clerkId: buyerId,
      name: "Avery Stone",
      displayName: "Avery Stone",
      accountType: null,
      onboardingComplete: false,
    });
    expect(result.body.name).not.toBe("OAuth Fallback");

    const [localUser] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, buyerId))
      .limit(1);
    expect(localUser).toMatchObject({
      clerkId: buyerId,
      name: "Avery Stone",
      displayName: "Avery Stone",
      accountType: null,
    });

    const profile = await request(buyerId, "PATCH", "/api/auth/profile", {
      name: "Avery Stone",
      displayName: "Avery Stone",
      username: `avery_${suffix}`,
      accountType: "buyer",
    });
    expect(profile.status).toBe(200);
    const switchedProfile = await request(buyerId, "PATCH", "/api/auth/profile", {
      displayName: "Wrong Account",
      accountType: "seller",
      expectedClerkId: sellerId,
    });
    expect(switchedProfile.status).toBe(409);
    expect(switchedProfile.body.code).toBe("ACCOUNT_CONTEXT_CHANGED");
    const preferences = await request(
      buyerId,
      "PATCH",
      "/api/auth/onboarding/buyer-preferences",
      { styleInterests: ["Minimal", "Vintage"], expectedClerkId: buyerId },
    );
    expect(preferences.status).toBe(200);
    expect(preferences.body).toEqual({ ok: true });
    const completed = await request(
      buyerId,
      "POST",
      "/api/auth/onboarding/complete",
      { accountType: "buyer", expectedClerkId: buyerId },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.onboardingComplete).toBe(true);

    const retried = await request(
      buyerId,
      "POST",
      "/api/auth/onboarding/complete",
      { accountType: "buyer", expectedClerkId: buyerId },
    );
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({
      accountType: "buyer",
      onboardingComplete: true,
    });

    const switchedAccount = await request(
      buyerId,
      "PATCH",
      "/api/auth/onboarding/buyer-preferences",
      { styleInterests: ["Luxury"], expectedClerkId: sellerId },
    );
    expect(switchedAccount.status).toBe(409);
    expect(switchedAccount.body.code).toBe("ACCOUNT_CONTEXT_CHANGED");
  });

  it("requires the local seller user before saving the onboarding brand name", async () => {
    const beforeSync = await request(sellerId, "PATCH", "/api/auth/onboarding", {
      brandName: "Night Shift Studio",
      brandStage: "idea",
    });
    expect(beforeSync.status).toBe(404);
    expect(beforeSync.body).toEqual({
      error: "User not found — call POST /auth/sync first",
    });

    const sync = await request(sellerId, "POST", "/api/auth/sync", {
      name: "Mila Chen",
    });
    expect(sync.status).toBe(201);
    expect(sync.body).toMatchObject({
      clerkId: sellerId,
      name: "Mila Chen",
      accountType: null,
    });

    const onboarding = await request(sellerId, "PATCH", "/api/auth/onboarding", {
      brandName: "Night Shift Studio",
      brandStage: "idea",
    });
    expect(onboarding.status).toBe(200);
    expect(onboarding.body).toMatchObject({
      clerkId: sellerId,
      name: "Mila Chen",
      accountType: null,
      brandName: "Night Shift Studio",
      brandStage: "idea",
      onboardingComplete: false,
    });
    const profile = await request(sellerId, "PATCH", "/api/auth/profile", {
      name: "Mila Chen",
      displayName: "Mila Chen",
      username: `mila_${suffix}`,
      accountType: "seller",
    });
    expect(profile.status).toBe(200);

    const completed = await request(
      sellerId,
      "POST",
      "/api/auth/onboarding/complete",
      { accountType: "seller" },
    );
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      clerkId: sellerId,
      accountType: "seller",
      onboardingComplete: true,
    });
  });

  it("rejects skipped setup, missing seller fields, and completed-account role changes", async () => {
    const sync = await request(incompleteSellerId, "POST", "/api/auth/sync", {
      name: "Incomplete Seller",
    });
    expect(sync.status).toBe(201);

    const direct = await request(
      incompleteSellerId,
      "POST",
      "/api/auth/onboarding/complete",
      { accountType: "seller" },
    );
    expect(direct.status).toBe(409);
    expect(direct.body.code).toBe("ONBOARDING_ROLE_MISMATCH");

    const profile = await request(incompleteSellerId, "PATCH", "/api/auth/profile", {
      displayName: "Incomplete Seller",
      username: `incomplete_${suffix}`,
      accountType: "seller",
    });
    expect(profile.status).toBe(200);
    const missingBrand = await request(
      incompleteSellerId,
      "POST",
      "/api/auth/onboarding/complete",
      { accountType: "seller" },
    );
    expect(missingBrand.status).toBe(409);
    expect(missingBrand.body.code).toBe("ONBOARDING_PROFILE_INCOMPLETE");

    const roleChange = await request(
      sellerId,
      "POST",
      "/api/auth/onboarding/complete",
      { accountType: "buyer" },
    );
    expect(roleChange.status).toBe(409);
    expect(roleChange.body.code).toBe("ONBOARDING_ROLE_MISMATCH");
  });
});