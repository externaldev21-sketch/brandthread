/** GET /api/account-status and /reports: strikes derived from actioned reports, and your own reports. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray, or } from "drizzle-orm";
import { db, reports } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = user;
    next();
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const OWNER = `as-owner-${suffix}`;
const REPORTER = `as-reporter-${suffix}`;
const OTHER = `as-other-${suffix}`;
let server: Server;
let base = "";

const get = async (user: string | null, path: string) => {
  const res = await fetch(`${base}/api/account-status${path}`, { headers: user ? { "x-test-user": user } : {} });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  const now = Date.now();
  await db.insert(reports).values([
    // Two people reported the same comment; the moderator removed it once → one strike.
    { reporterId: REPORTER, targetType: "comment", targetId: `c1-${suffix}`, reason: "harassment", status: "actioned",
      resolutionAction: "remove_content", targetOwnerId: OWNER, resolvedAt: new Date(now - 2 * 86_400_000) },
    { reporterId: OTHER, targetType: "comment", targetId: `c1-${suffix}`, reason: "harassment", status: "actioned",
      resolutionAction: "remove_content", targetOwnerId: OWNER, resolvedAt: new Date(now - 2 * 86_400_000) },
    // Dismissed: no strike.
    { reporterId: REPORTER, targetType: "post", targetId: `p1-${suffix}`, targetLabel: "Summer drop", reason: "spam",
      status: "dismissed", resolutionAction: "dismiss", targetOwnerId: OWNER, resolvedAt: new Date(now - 86_400_000) },
    // Expired strike (120 days ago).
    { reporterId: OTHER, targetType: "product", targetId: `l1-${suffix}`, reason: "scam", status: "actioned",
      resolutionAction: "remove_content", targetOwnerId: OWNER, resolvedAt: new Date(now - 120 * 86_400_000) },
    // Still pending.
    { reporterId: REPORTER, targetType: "profile", targetId: `u1-${suffix}`, reason: "scam", status: "pending", targetOwnerId: OTHER },
  ]);
  const { default: router } = await import("../account-status");
  const app = express();
  app.use("/api/account-status", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(reports).where(or(inArray(reports.reporterId, [REPORTER, OTHER]), inArray(reports.targetOwnerId, [OWNER, OTHER])));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/account-status", () => {
  it("401 signed out", async () => {
    expect((await get(null, "/")).status).toBe(401);
  });

  it("counts one active strike per actioned item and keeps expired ones in history", async () => {
    const { status, body } = await get(OWNER, "/");
    expect(status).toBe(200);
    expect(body).toMatchObject({ standing: "at_risk", activeStrikes: 1, strikeLimit: 3, windowDays: 90 });
    expect(body.strikes.map((s: any) => [s.title, s.active])).toEqual([["Comment removed", true], ["Listing removed", false]]);
  });

  it("is in good standing for someone with no strikes", async () => {
    expect((await get(REPORTER, "/")).body.standing).toBe("good");
  });
});

describe("GET /api/account-status/reports", () => {
  it("lists only what you reported, newest first, with the outcome", async () => {
    const { body } = await get(REPORTER, "/reports");
    const rows = body.reports.map((r: any) => [r.targetType, r.statusLabel]);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([["Comment", "We took action"], ["Post", "No violation found"], ["Profile", "In review"]]));
    expect(body.reports.find((r: any) => r.targetType === "Post").targetLabel).toBe("Summer drop");
  });
});
