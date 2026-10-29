/**
 * End-to-end launch against the real metaGraph.ts with fetch mocked: asserts
 * the exact Graph calls (order, URLs, payloads) one launch makes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ campaignRow: null as any, accountRow: null as any }));

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...actual,
    db: {
      ...actual.db,
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            limit: async () => (table === actual.metaCampaigns ? [state.campaignRow] : [state.accountRow]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: state.campaignRow.id }] }),
        }),
      }),
    },
  };
});

vi.mock("../metaCrypto", () => ({
  decryptToken: vi.fn(() => "seller-token"),
  encryptToken: vi.fn((p: string) => `enc:${p}`),
}));

vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) {
      return `https://storage.example.com${path}`;
    }
  },
}));

import { launchCampaign } from "../metaAdsLaunch";
import { graphVersion } from "../metaGraph";

const ORIGINAL_ENV = { ...process.env };

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  process.env.META_APP_SECRET = "";
  delete process.env.META_ADS_SANDBOX;
  const start = new Date(Date.now() + 2 * 86_400_000);
  state.campaignRow = {
    id: "c-1", sellerId: "s-1", adAccountRecordId: "a-1", promoteKind: "product", promoteRefId: "p-1",
    objective: "traffic", metaObjective: "OUTCOME_TRAFFIC", primaryText: "New drop", headline: "Hoodie",
    ctaType: "SHOP_NOW", destinationUrl: "https://brandthread.app/store/product/p-1",
    mediaKind: "photos", mediaObjectPaths: ["/objects/img.jpg"], budgetType: "lifetime", budgetCents: 15_000,
    startTime: start, endTime: new Date(start.getTime() + 7 * 86_400_000), advantagePlus: true, placements: {},
    targetingSpec: { countries: ["US", "CA"], ageMin: 21, ageMax: 40 }, status: "draft", idempotencyKey: "k",
    metaCampaignId: null, metaAdSetId: null, metaCreativeId: null, metaAdId: null,
  };
  state.accountRow = {
    id: "a-1", status: "connected", accessTokenEncrypted: "v1:x", tokenExpiresAt: new Date(Date.now() + 40 * 86_400_000),
    adAccountId: "act_42", pageId: "page-7", instagramActorId: "ig-8", pixelId: "px-1",
  };
  vi.spyOn(global, "fetch")
    .mockResolvedValueOnce(ok({ id: "camp-1" }))
    .mockResolvedValueOnce(ok({ id: "adset-1" }))
    .mockResolvedValueOnce(ok({ images: { "img.jpg": { hash: "hash-1" } } }))
    .mockResolvedValueOnce(ok({ id: "creative-1" }))
    .mockResolvedValueOnce(ok({ id: "ad-1" }))
    .mockResolvedValueOnce(ok({ success: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("launchCampaign → Graph API", () => {
  it("makes campaign → ad set → image → creative → ad → activate calls with exact payloads", async () => {
    const result = await launchCampaign("c-1");
    expect(result).toEqual({ status: "in_review", metaAdId: "ad-1" });

    const calls = (global.fetch as any).mock.calls as Array<[string, RequestInit]>;
    const base = `https://graph.facebook.com/${graphVersion()}`;
    expect(calls.map(([url]) => url)).toEqual([
      `${base}/act_42/campaigns`,
      `${base}/act_42/adsets`,
      `${base}/act_42/adimages`,
      `${base}/act_42/adcreatives`,
      `${base}/act_42/ads`,
      `${base}/camp-1`,
    ]);
    const bodies = calls.map(([, init]) => JSON.parse(String(init.body)));

    expect(bodies[0]).toEqual({
      name: "Brandthread — Hoodie", objective: "OUTCOME_TRAFFIC", status: "PAUSED",
      special_ad_categories: [], is_adset_budget_sharing_enabled: false, access_token: "seller-token",
    });
    expect(bodies[1]).toEqual({
      name: "Brandthread ad set — c-1",
      campaign_id: "camp-1",
      lifetime_budget: 15_000,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      start_time: state.campaignRow.startTime.toISOString(),
      end_time: state.campaignRow.endTime.toISOString(),
      targeting: { geo_locations: { countries: ["US", "CA"] }, age_min: 21, age_max: 40 },
      status: "ACTIVE",
      access_token: "seller-token",
    });
    expect(bodies[2]).toEqual({ url: "https://storage.example.com/objects/img.jpg", access_token: "seller-token" });
    expect(bodies[3].object_story_spec).toEqual({
      page_id: "page-7",
      instagram_user_id: "ig-8",
      link_data: {
        message: "New drop", link: "https://brandthread.app/store/product/p-1", name: "Hoodie", image_hash: "hash-1",
        call_to_action: { type: "SHOP_NOW", value: { link: "https://brandthread.app/store/product/p-1" } },
      },
    });
    expect(bodies[4]).toEqual({
      name: "Brandthread ad — c-1", adset_id: "adset-1", creative: { creative_id: "creative-1" },
      status: "ACTIVE", access_token: "seller-token",
    });
    expect(bodies[5]).toEqual({ status: "ACTIVE", access_token: "seller-token" });
    expect(calls.every(([, init]) => init.method === "POST")).toBe(true);
  });
});
