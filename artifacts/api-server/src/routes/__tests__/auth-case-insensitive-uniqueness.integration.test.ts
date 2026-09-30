import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Case-insensitive username/email uniqueness (migration 109): 'GalleryDesires'
// and 'gallerydesires' can't both exist, and one email can't back two
// accounts regardless of casing.

const state = vi.hoisted(() => ({
  selfId: "",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.selfId;
    next();
  },
}));

let server: Server;
let base = "";
const otherId = `ci-uniq-other-${crypto.randomBytes(8).toString("hex")}`;
const otherUsername = `GalleryDesires_${crypto.randomBytes(4).toString("hex")}`;
const otherEmail = `Gallery.Desires+${crypto.randomBytes(4).toString("hex")}@Example.COM`;

beforeAll(async () => {
  state.selfId = `ci-uniq-self-${crypto.randomBytes(8).toString("hex")}`;

  // "Other" account already owns a mixed-case username and email.
  await db.insert(users).values({
    clerkId: otherId,
    email: otherEmail.toLowerCase(), // writers always store lowercase (authProfile.ts)
    name: "Other Seller",
    displayName: "Other Seller",
    username: otherUsername.toLowerCase(),
    role: "seller",
    accountType: "seller",
  });

  // "Self" — the account under test, initially with no username.
  await db.insert(users).values({
    clerkId: state.selfId,
    email: `${state.selfId}@test.local`,
    name: "Self Seller",
    displayName: "Self Seller",
    role: "seller",
    accountType: "seller",
  });

  const { default: authRouter } = await import("../auth");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, [state.selfId, otherId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function patchProfile(body: unknown) {
  const response = await fetch(`${base}/api/auth/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function checkUsername(username: string) {
  const response = await fetch(`${base}/api/auth/username/check?username=${encodeURIComponent(username)}`);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function checkEmail(email: string) {
  const response = await fetch(`${base}/api/auth/email/check?email=${encodeURIComponent(email)}`);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("case-insensitive username uniqueness", () => {
  it("GET /username/check flags a different-cased existing username as taken", async () => {
    const { status, body } = await checkUsername(otherUsername.toUpperCase());
    expect(status).toBe(200);
    expect(body.available).toBe(false);
  });

  it("PATCH /profile rejects a different-cased username someone else already owns, with 409 USERNAME_TAKEN", async () => {
    const { status, body } = await patchProfile({ username: otherUsername.toUpperCase() });
    expect(status).toBe(409);
    expect(body.code).toBe("USERNAME_TAKEN");
  });

  it("PATCH /profile still lets self claim and later re-save its own username unchanged", async () => {
    const mine = `self_${crypto.randomBytes(4).toString("hex")}`;
    const first = await patchProfile({ username: mine });
    expect(first.status).toBe(200);

    const second = await patchProfile({ username: mine.toUpperCase() });
    expect(second.status).toBe(200);
    expect(second.body.username).toBe(mine.toLowerCase());
  });
});

describe("case-insensitive email uniqueness", () => {
  it("GET /email/check flags a different-cased existing email as taken", async () => {
    const { status, body } = await checkEmail(otherEmail.toUpperCase());
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.code).toBe("EMAIL_TAKEN");
  });

  it("GET /email/check reports a genuinely free email as available", async () => {
    const free = `free-${crypto.randomBytes(8).toString("hex")}@example.com`;
    const { status, body } = await checkEmail(free);
    expect(status).toBe(200);
    expect(body.available).toBe(true);
  });
});
