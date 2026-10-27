import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  campaignRow: null as any,
  accountRow: null as any,
  updates: [] as Array<Record<string, unknown>>,
}));

// vi.importActual below loads the real @workspace/db module (for its schema
// table objects), which throws at import time if DATABASE_URL is unset —
// this file never actually connects (db.select/update are replaced below),
// so a placeholder is enough. Must run before the hoisted vi.mock factory.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

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
      this.metaErrorCode = (params as any).metaErrorCode;
    }
    metaErrorCode?: number;
    get requiresReconnect() { return this.metaErrorCode === 190; }
  },
  createCampaign: vi.fn(),
  createAdSet: vi.fn(),
  createAdCreative: vi.fn(),
  createAd: vi.fn(),
  uploadAdImage: vi.fn(),
  uploadAdVideo: vi.fn(),
  updateCampaignStatus: vi.fn(),
  getLongLivedToken: vi.fn(),
  debugToken: vi.fn(),
}));

vi.mock("../metaCrypto", () => ({
  decryptToken: vi.fn(() => "decrypted-access-token"),
  encryptToken: vi.fn((p: string) => `enc:${p}`),
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

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  state.campaignRow = null;
  state.accountRow = null;
  state.updates = [];
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.META_ADS_SANDBOX;
});

async function mockHappyChain() {
  const metaGraph = await import("../metaGraph");
  (metaGraph.createCampaign as any).mockResolvedValue({ id: "meta-campaign-1" });
  (metaGraph.createAdSet as any).mockResolvedValue({ id: "meta-adset-1" });
  (metaGraph.uploadAdImage as any).mockResolvedValue({ imageHash: "hash-1" });
  (metaGraph.createAdCreative as any).mockResolvedValue({ id: "meta-creative-1" });
  (metaGraph.createAd as any).mockResolvedValue({ id: "meta-ad-1" });
  (metaGraph.updateCampaignStatus as any).mockResolvedValue(undefined);
  return metaGraph;
}

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

  it("builds campaign PAUSED → ad set/ad ACTIVE, then switches the campaign on last", async () => {
    state.campaignRow = baseCampaign();
    state.accountRow = baseAccount();
    const metaGraph = await mockHappyChain();

    const { launchCampaign } = await import("../metaAdsLaunch");
    await launchCampaign("campaign-1");

    expect((metaGraph.createCampaign as any).mock.calls[0][2]).toMatchObject({ objective: "OUTCOME_SALES", status: "PAUSED" });
    expect((metaGraph.createAdSet as any).mock.calls[0][2]).toMatchObject({
      status: "ACTIVE",
      dailyBudgetCents: 2000,
      optimizationGoal: "OFFSITE_CONVERSIONS",
      pixelId: "pixel-1",
      promotedObject: { custom_event_type: "PURCHASE" },
    });
    expect((metaGraph.createAd as any).mock.calls[0][2]).toMatchObject({ status: "ACTIVE" });
    expect(metaGraph.updateCampaignStatus).toHaveBeenCalledWith("decrypted-access-token", "meta-campaign-1", "ACTIVE");
    const activateOrder = (metaGraph.updateCampaignStatus as any).mock.invocationCallOrder[0];
    expect(activateOrder).toBeGreaterThan((metaGraph.createAd as any).mock.invocationCallOrder[0]);
  });

  it("sends future start/end as ISO and drops a start that has already passed", async () => {
    const future = new Date(Date.now() + 2 * 86_400_000);
    const end = new Date(Date.now() + 9 * 86_400_000);
    state.campaignRow = baseCampaign({ startTime: future, endTime: end });
    state.accountRow = baseAccount();
    let metaGraph = await mockHappyChain();
    const { launchCampaign } = await import("../metaAdsLaunch");
    await launchCampaign("campaign-1");
    expect((metaGraph.createAdSet as any).mock.calls[0][2]).toMatchObject({
      startTime: future.toISOString(), endTime: end.toISOString(),
    });

    vi.clearAllMocks();
    state.campaignRow = baseCampaign({ startTime: new Date(Date.now() - 86_400_000), endTime: end });
    metaGraph = await mockHappyChain();
    await launchCampaign("campaign-1");
    expect((metaGraph.createAdSet as any).mock.calls[0][2].startTime).toBeUndefined();
  });

  it("refuses to launch a campaign whose end date has passed, without calling Meta", async () => {
    state.campaignRow = baseCampaign({ endTime: new Date(Date.now() - 1000) });
    state.accountRow = baseAccount();
    const metaGraph = await mockHappyChain();
    const { launchCampaign } = await import("../metaAdsLaunch");
    await expect(launchCampaign("campaign-1")).rejects.toMatchObject({ userMessage: expect.stringMatching(/end date has passed/) });
    expect(metaGraph.createCampaign).not.toHaveBeenCalled();
  });

  it("uses the sandbox ad account when META_ADS_SANDBOX=1", async () => {
    process.env.META_ADS_SANDBOX = "1";
    process.env.META_SANDBOX_AD_ACCOUNT_ID = "act_sandbox_9";
    process.env.META_SANDBOX_ACCESS_TOKEN = "sandbox-token";
    state.campaignRow = baseCampaign();
    state.accountRow = baseAccount();
    const metaGraph = await mockHappyChain();
    const { launchCampaign } = await import("../metaAdsLaunch");
    await launchCampaign("campaign-1");
    expect((metaGraph.createCampaign as any).mock.calls[0].slice(0, 2)).toEqual(["sandbox-token", "act_sandbox_9"]);
    expect((metaGraph.createAd as any).mock.calls[0].slice(0, 2)).toEqual(["sandbox-token", "act_sandbox_9"]);
  });

  it("fails with a reconnect error and no Graph calls when the stored token has expired", async () => {
    state.campaignRow = baseCampaign();
    state.accountRow = baseAccount({ tokenExpiresAt: new Date(Date.now() - 1000) });
    const metaGraph = await mockHappyChain();
    const { launchCampaign } = await import("../metaAdsLaunch");
    await expect(launchCampaign("campaign-1")).rejects.toMatchObject({ code: "META_RECONNECT_REQUIRED" });
    expect(metaGraph.createCampaign).not.toHaveBeenCalled();
    expect(state.updates.some((u) => u.status === "needs_reauth")).toBe(true);
  });

  it("marks the connection needs_reauth when Meta rejects the token mid-launch (code 190)", async () => {
    state.campaignRow = baseCampaign();
    state.accountRow = baseAccount();
    const metaGraph = await mockHappyChain();
    (metaGraph.createCampaign as any).mockRejectedValue(
      new metaGraph.MetaGraphError({ message: "Error validating access token", status: 400, metaErrorCode: 190, userMessage: "x" } as any),
    );
    const { launchCampaign } = await import("../metaAdsLaunch");
    await expect(launchCampaign("campaign-1")).rejects.toMatchObject({ code: "META_RECONNECT_REQUIRED" });
    expect(state.updates.some((u) => u.status === "needs_reauth")).toBe(true);
    expect(state.updates.some((u) => u.status === "failed")).toBe(true);
  });
});
