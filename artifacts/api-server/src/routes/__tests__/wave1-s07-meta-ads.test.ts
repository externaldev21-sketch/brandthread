/**
 * Wave 1 / s07 audit regressions for routes/meta-ads.ts:
 *  - draft PATCH validates budget/budgetType/mediaKind like POST /campaigns
 *  - malformed campaign ids are a 404, not a uuid-cast 500
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, metaAdAccounts, metaCampaigns } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `w1-s07-meta-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = sellerId; next(); },
}));

let server: Server;
let base = "";
let accountId = "";
let campaignId = "";

const request = (path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeAll(async () => {
  const [account] = await db.insert(metaAdAccounts).values({
    sellerId, accessTokenEncrypted: "", status: "connected",
  }).returning();
  accountId = account.id;
  const [campaign] = await db.insert(metaCampaigns).values({
    sellerId, adAccountRecordId: accountId, promoteKind: "store", objective: "traffic",
    metaObjective: "OUTCOME_TRAFFIC", destinationUrl: "https://example.test/store",
    budgetType: "daily", budgetCents: 1_000, idempotencyKey: `w1-s07-${suffix}`,
  }).returning();
  campaignId = campaign.id;

  const { default: router } = await import("../meta-ads");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/meta-ads", router);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(metaCampaigns).where(eq(metaCampaigns.sellerId, sellerId));
  await db.delete(metaAdAccounts).where(eq(metaAdAccounts.sellerId, sellerId));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("PATCH /meta-ads/campaigns/:id (draft)", () => {
  it("rejects a non-positive or non-integer budget", async () => {
    for (const budgetCents of [-500, 0, 12.5, "1000"]) {
      const response = await request(`/api/meta-ads/campaigns/${campaignId}`, "PATCH", { budgetCents });
      expect(response.status).toBe(400);
    }
    const [row] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, campaignId));
    expect(row.budgetCents).toBe(1_000);
  });

  it("rejects unknown budgetType and mediaKind values", async () => {
    expect((await request(`/api/meta-ads/campaigns/${campaignId}`, "PATCH", { budgetType: "weekly" })).status).toBe(400);
    expect((await request(`/api/meta-ads/campaigns/${campaignId}`, "PATCH", { mediaKind: "gif" })).status).toBe(400);
    const [row] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, campaignId));
    expect(row.budgetType).toBe("daily");
    expect(row.mediaKind).toBe("photos");
  });

  it("still applies a valid edit", async () => {
    const response = await request(`/api/meta-ads/campaigns/${campaignId}`, "PATCH", { budgetCents: 2_500, headline: "New" });
    expect(response.status).toBe(200);
    const body = await response.json() as { campaign: { budgetCents: number; headline: string } };
    expect(body.campaign.budgetCents).toBe(2_500);
    expect(body.campaign.headline).toBe("New");
  });
});

describe("malformed campaign ids", () => {
  it("answers 404 for GET, PATCH and duplicate", async () => {
    expect((await request("/api/meta-ads/campaigns/not-a-uuid")).status).toBe(404);
    expect((await request("/api/meta-ads/campaigns/not-a-uuid", "PATCH", { headline: "x" })).status).toBe(404);
    expect((await request("/api/meta-ads/campaigns/not-a-uuid/duplicate", "POST", {})).status).toBe(404);
  });
});
