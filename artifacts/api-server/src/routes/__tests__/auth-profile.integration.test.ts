import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({
  userId: "",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    next();
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  state.userId = `auth-profile-test-${crypto.randomBytes(8).toString("hex")}`;
  await db.insert(users).values({
    clerkId: state.userId,
    email: `${state.userId}@test.local`,
    name: "Profile Test Seller",
    displayName: "Profile Test Seller",
    role: "seller",
    accountType: "seller",
    brandName: "Original Brand",
    bio: "Original bio",
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
  await db.delete(users).where(eq(users.clerkId, state.userId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function patchProfile(body: unknown) {
  const response = await fetch(`${base}/api/auth/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

describe("PATCH /api/auth/profile", () => {
  it("saves the authenticated seller's brand name and bio", async () => {
    const result = await patchProfile({
      brandName: "  Threaded Studio  ",
      bio: "Thoughtful essentials for everyday wear.",
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      clerkId: state.userId,
      brandName: "Threaded Studio",
      bio: "Thoughtful essentials for everyday wear.",
    });

    const [saved] = await db
      .select({ brandName: users.brandName, bio: users.bio })
      .from(users)
      .where(eq(users.clerkId, state.userId))
      .limit(1);
    expect(saved).toEqual({
      brandName: "Threaded Studio",
      bio: "Thoughtful essentials for everyday wear.",
    });
  });

  it("rejects an empty brand name without changing the saved profile", async () => {
    const result = await patchProfile({
      brandName: "   ",
      bio: "This bio must not be saved with an invalid brand name.",
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "brandName cannot be empty" });

    const [saved] = await db
      .select({ brandName: users.brandName, bio: users.bio })
      .from(users)
      .where(eq(users.clerkId, state.userId))
      .limit(1);
    expect(saved).toEqual({
      brandName: "Threaded Studio",
      bio: "Thoughtful essentials for everyday wear.",
    });
  });
});