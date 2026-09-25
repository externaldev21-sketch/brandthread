import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  campaignRow: null as any,
  accountRow: null as any,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  function selectChain(table: any) {
    return {
      from: (fromTable: any) => ({
        where: () => ({
          limit: async () => {
            if (fromTable === actual.metaCampaigns) return state.campaignRow ? [state.campaignRow] : [];
            if (fromTable === actual.metaAdAccounts) return state.accountRow ? [state.accountRow] : [];
            return [];
          },
        }),
      }),
    };
  }

  return {
    ...actual,
    db: {
      ...actual.db,
      select: () => selectChain(actual.metaCampaigns),
      update: (table: any) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            state.updates.push(values);
            // Keep the in-memory campaign row in sync so subsequent reads in
            // the same launch (there are none today, but keeps this robust)
            // see the latest values.
            if (table === actual.metaCampaigns && state.campaignRow) {
              state.campaignRow = { ...state.campaignRow, ...values };
            }
            return undefined;
          },
        }),
      }),
    },
  };
});

vi.mock("../metaGraph", () => ({
  MetaGraphError: class MetaGraphError extends Error {
    status: number;
    userMessage: string;
    constructor(params: { message: string; status: number; userMessage: string }) {
      super(params.message);
      this.status = params.status;
      this.userMessage = params.userMessage;
    }
  },
  createCampaign: vi.fn(),
  createAdSet: vi.fn(),
  createAdCreative: vi.fn(),
  createAd: vi.fn(),
  uploadAdImage: vi.fn(),
  uploadAdVideo: vi.fn(),
}));

vi.mock("../metaCrypto", () => ({
  decryptToken: vi.fn(() => "decrypted-access-token"),
}));

vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) {
      return `https://storage.example.com${path}`;
    }
  },
}));

function baseCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    sellerId: "seller-1",
    adAccountRecordId: "account-1",
    promoteKind: "product",
    promoteRefId: "product-1",
    objective: "sales",
    metaObjective: "OUTCOME_SALES",
    primaryText: "Buy now",
    headline: "Great product",
    ctaType: "SHOP_NOW",
    destinationUrl: "https://brandthread.app/p/1",
    mediaKind: "photos",
    mediaObjectPaths: ["/objects/meta-ads/campaign-1/img.jpg"],
    budgetType: "daily",
    budgetCents: 2000,
    startTime: null,
    endTime: null,
    advantagePlus: true,
    placements: {},
    targetingSpec: {},
    status: "draft",
    rejectionReason: null,
    idempotencyKey: "key-1",
    metaCampaignId: null,
    metaAdSetId: null,
    metaCreativeId: null,
    metaAdId: null,
    ...overrides,
  };
}

function baseAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "account-1",
    sellerId: "seller-1",
    accessTokenEncrypted: "v1:iv:tag:ct",
    status: "connected",
    adAccountId: "act_123",
    pageId: "page-1",
    instagramActorId: "ig-1",
    pixelId: "pixel-1",
    ...overrides,
  };
}

beforeEach(() => {
  state.campaignRow = null;
  state.accountRow = null;
  state.updates = [];
  vi.clearAllMocks();
});

describe("launchCampaign", () => {
  it("creates all four Meta objects in order for a fresh campaign and persists each id", async () => {
    state.campaignRow = baseCampaign();
    state.accountRow = baseAccount();

    const metaGraph = await import("../metaGraph");
    (metaGraph.createCampaign as any).mockResolvedValue({ id: "meta-campaign-1" });
    (metaGraph.createAdSet as any).mockResolvedValue({ id: "meta-adset-1" });
    (metaGraph.uploadAdImage as any).mockResolvedValue({ imageHash: "hash-1" });
    (metaGraph.createAdCreative as any).mockResolvedValue({ id: "meta-creative-1" });
    (metaGraph.createAd as any).mockResolvedValue({ id: "meta-ad-1" });

    const { launchCampaign } = await import("../metaAdsLaunch");
    const result = await launchCampaign("campaign-1");

    expect(result).toEqual({ status: "in_review", metaAdId: "meta-ad-1" });
    expect(metaGraph.createCampaign).toHaveBeenCalledTimes(1);
    expect(metaGraph.createAdSet).toHaveBeenCalledTimes(1);
    expect(metaGraph.createAdCreative).toHaveBeenCalledTimes(1);
    expect(metaGraph.createAd).toHaveBeenCalledTimes(1);

    // Each created id was persisted as it was created.
    expect(state.updates.some((u) => u.metaCampaignId === "meta-campaign-1")).toBe(true);
    expect(state.updates.some((u) => u.metaAdSetId === "meta-adset-1")).toBe(true);
    expect(state.updates.some((u) => u.metaCreativeId === "meta-creative-1")).toBe(true);
    expect(state.updates.some((u) => u.metaAdId === "meta-ad-1" && u.status === "in_review")).toBe(true);
  });

  it("skips campaign + ad set creation on a retried launch that already has those ids", async () => {
    state.campaignRow = baseCampaign({
      metaCampaignId: "meta-campaign-existing",
      metaAdSetId: "meta-adset-existing",
      status: "launching",
    });
    state.accountRow = baseAccount();

    const metaGraph = await import("../metaGraph");
    (metaGraph.uploadAdImage as any).mockResolvedValue({ imageHash: "hash-1" });
    (metaGraph.createAdCreative as any).mockResolvedValue({ id: "meta-creative-1" });
    (metaGraph.createAd as any).mockResolvedValue({ id: "meta-ad-1" });

    const { launchCampaign } = await import("../metaAdsLaunch");
    const result = await launchCampaign("campaign-1");

    expect(result).toEqual({ status: "in_review", metaAdId: "meta-ad-1" });
    expect(metaGraph.createCampaign).not.toHaveBeenCalled();
    expect(metaGraph.createAdSet).not.toHaveBeenCalled();
    expect(metaGraph.createAdCreative).toHaveBeenCalledTimes(1);
    expect(metaGraph.createAd).toHaveBeenCalledTimes(1);
  });

  it("marks the campaign failed with a plain-English rejectionReason on a MetaGraphError, and throws", async () => {
    state.campaignRow = baseCampaign();
    state.accountRow = baseAccount();

    const metaGraph = await import("../metaGraph");
    (metaGraph.createCampaign as any).mockResolvedValue({ id: "meta-campaign-1" });
    (metaGraph.createAdSet as any).mockRejectedValue(
      new metaGraph.MetaGraphError({
        message: "raw meta error",
        status: 400,
        userMessage: "Your audience settings aren't valid — try widening your audience.",
      }),
    );

    const { launchCampaign, LaunchError } = await import("../metaAdsLaunch");

    await expect(launchCampaign("campaign-1")).rejects.toBeInstanceOf(LaunchError);
    await expect(launchCampaign("campaign-1")).rejects.toMatchObject({
      userMessage: "Your audience settings aren't valid — try widening your audience.",
    });

    const failedUpdate = state.updates.find((u) => u.status === "failed");
    expect(failedUpdate).toMatchObject({
      status: "failed",
      rejectionReason: "Your audience settings aren't valid — try widening your audience.",
    });
  });
});
