import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, pushTokens, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));

const USER = `ptz-${crypto.randomBytes(5).toString("hex")}`;
let server: Server;
let base = "";

async function register(body: Record<string, unknown>) {
  const r = await fetch(`${base}/api/push/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": USER },
    body: JSON.stringify(body),
  });
  return r.status;
}
const storedTimezone = async () =>
  (await db.select({ tz: users.timezone }).from(users).where(eq(users.clerkId, USER)))[0]?.tz;

beforeAll(async () => {
  await db.insert(users).values({ clerkId: USER, email: `${USER}@test.local`, name: USER, role: "buyer", accountType: "buyer" });
  const { default: pushRouter } = await import("../push");
  const app = express();
  app.use(express.json());
  app.use("/api/push", pushRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(pushTokens).where(eq(pushTokens.userId, USER));
  await db.delete(users).where(eq(users.clerkId, USER));
});

describe("POST /api/push/register timezone", () => {
  it("stores a valid IANA timezone, ignores an invalid one, and keeps working without one", async () => {
    expect(await register({ token: `ExponentPushToken[${USER}]`, platform: "expo" })).toBe(200);
    expect(await storedTimezone()).toBeNull();

    expect(await register({ token: `ExponentPushToken[${USER}]`, platform: "expo", timezone: "Europe/London" })).toBe(200);
    expect(await storedTimezone()).toBe("Europe/London");

    expect(await register({ token: `ExponentPushToken[${USER}]`, platform: "expo", timezone: "Not/AZone" })).toBe(200);
    expect(await register({ token: `ExponentPushToken[${USER}]`, platform: "expo", timezone: 12 })).toBe(200);
    expect(await storedTimezone()).toBe("Europe/London");
  });
});
