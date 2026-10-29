/**
 * Two launches of the same campaign at once (double tap, or a client retry
 * while the first is still talking to Meta) must build ONE Meta campaign.
 * Without the claim both saw metaCampaignId = null, each created and
 * switched on a full chain, and the seller paid for two ads.
 */
import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, metaAdAccounts, metaCampaigns } from "@workspace/db";

const graph = vi.hoisted(() => ({ campaigns: 0 }));

vi.mock("../metaCrypto", () => ({
  decryptToken: () => "seller-token",
  encryptToken: (p: string) => `enc:${p}`,
}));
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://storage.example.test${path}`; }
  },
}));
vi.mock("../metaGraph", async (orig) => ({
  ...(await orig<typeof import("../metaGraph")>()),
  createCampaign: vi.fn(async () => {
    graph.campaigns += 1;
    await new Promise((r) => setTimeout(r, 50)); // Meta round trip
    return { id: `meta-campaign-${graph.campaigns}` };
  }),
  createAdSet: vi.fn(async () => ({ id: "meta-adset" })),
  uploadAdImage: vi.fn(async () => ({ imageHash: "hash" })),
  createAdCreative: vi.fn(async () => ({ id: "meta-creative" })),
  createAd: vi.fn(async () => ({ id: "meta-ad" })),
  updateCampaignStatus: vi.fn(async () => undefined),
}));

const { launchCampaign, LAUNCH_LEASE_MS } = await import("../metaAdsLaunch");

const sfx = crypto.randomBytes(4).toString("hex");
const sellerId = `meta-launch-audit-${sfx}`;
let accountId = "";

async function draftCampaign(overrides: Partial<typeof metaCampaigns.$inferInsert> = {}) {
  if (!accountId) {
    const [account] = await db.insert(metaAdAccounts).values({
      sellerId, accessTokenEncrypted: "v1:x:y:z", status: "connected", adAccountId: "act_1", pageId: "page_1",
      tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning();
    accountId = account.id;
  }
  const [row] = await db.insert(metaCampaigns).values({
    sellerId, adAccountRecordId: accountId, promoteKind: "store", objective: "traffic", metaObjective: "OUTCOME_TRAFFIC",
    destinationUrl: "https://brandthread.app/s", mediaObjectPaths: ["/objects/a.jpg"], budgetCents: 2000,
    idempotencyKey: `k-${sfx}-${crypto.randomUUID()}`, ...overrides,
  }).returning();
  return row;
}

beforeEach(() => { graph.campaigns = 0; });

afterAll(async () => {
  await db.delete(metaCampaigns).where(eq(metaCampaigns.sellerId, sellerId));
  await db.delete(metaAdAccounts).where(eq(metaAdAccounts.sellerId, sellerId));
});

describe("launchCampaign concurrency", () => {
  it("builds one Meta campaign when two launches race", async () => {
    const campaign = await draftCampaign();
    const results = await Promise.allSettled([launchCampaign(campaign.id), launchCampaign(campaign.id)]);
    expect(graph.campaigns).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.userMessage).toMatch(/already launching/);
    const [row] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, campaign.id));
    expect(row).toMatchObject({ status: "in_review", metaCampaignId: "meta-campaign-1", metaAdId: "meta-ad" });
  });

  it("resumes a launch that died mid-chain once its lease is stale", async () => {
    const campaign = await draftCampaign({
      status: "launching", metaCampaignId: "meta-campaign-old",
      updatedAt: new Date(Date.now() - LAUNCH_LEASE_MS - 60_000),
    });
    await expect(launchCampaign(campaign.id)).resolves.toMatchObject({ status: "in_review" });
    expect(graph.campaigns).toBe(0); // reused the id it already had
  });
});
