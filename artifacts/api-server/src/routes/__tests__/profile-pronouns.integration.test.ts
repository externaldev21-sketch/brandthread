import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));

const suffix = crypto.randomBytes(6).toString("hex");
const me = `pronouns-me-${suffix}`;
const viewer = `pronouns-viewer-${suffix}`;

let server: Server;
let base = "";

async function req(path: string, userId: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  auth.userId = me;
  await db.insert(users).values([me, viewer].map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: "Pronoun Test", username: u.replace(/-/g, "_"), role: "buyer", accountType: "buyer",
  })));
  const [{ default: authRouter }, { default: social }] = await Promise.all([import("../auth"), import("../social")]);
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/social", social);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, [me, viewer]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("profile pronouns", () => {
  it("saves trimmed pronouns and returns them on the own profile and the public profile", async () => {
    const saved = await req("/api/auth/profile", me, "PATCH", { pronouns: "  she/her  " });
    expect(saved.status).toBe(200);
    expect(saved.body.pronouns).toBe("she/her");
    expect((await req("/api/auth/me", me)).body.pronouns).toBe("she/her");
    const publicProfile = await req(`/api/social/profile/${me}`, viewer);
    expect(publicProfile.status).toBe(200);
    expect(publicProfile.body.pronouns).toBe("she/her");
  });

  it("leaves pronouns alone when the field is not sent", async () => {
    await req("/api/auth/profile", me, "PATCH", { bio: "hello" });
    const [row] = await db.select({ pronouns: users.pronouns }).from(users).where(eq(users.clerkId, me));
    expect(row.pronouns).toBe("she/her");
  });

  it("clears on an empty string or null", async () => {
    expect((await req("/api/auth/profile", me, "PATCH", { pronouns: "   " })).body.pronouns).toBeNull();
    await req("/api/auth/profile", me, "PATCH", { pronouns: "they/them" });
    expect((await req("/api/auth/profile", me, "PATCH", { pronouns: null })).body.pronouns).toBeNull();
    expect((await req(`/api/social/profile/${me}`, viewer)).body.pronouns).toBeNull();
  });

  it("rejects pronouns over 40 characters", async () => {
    const r = await req("/api/auth/profile", me, "PATCH", { pronouns: "x".repeat(41) });
    expect(r.status).toBe(400);
    const [row] = await db.select({ pronouns: users.pronouns }).from(users).where(eq(users.clerkId, me));
    expect(row.pronouns).toBeNull();
  });
});
