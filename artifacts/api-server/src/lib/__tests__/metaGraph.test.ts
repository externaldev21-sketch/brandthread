import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("metaGraph error mapping", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers Meta's error_user_msg when present", async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(400, { error: { message: "raw", error_user_msg: "Please fix your ad.", code: 100 } }),
    );
    const { getMe, MetaGraphError } = await import("../metaGraph");
    await expect(getMe("token")).rejects.toMatchObject({ userMessage: "Please fix your ad." });
    try {
      await getMe("token");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaGraphError);
    }
  });

  it("maps code 190 (expired token) to a plain-English reconnect message", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(401, { error: { message: "raw", code: 190 } }));
    const { getMe } = await import("../metaGraph");
    await expect(getMe("token")).rejects.toMatchObject({
      userMessage: "Your Meta connection expired — please reconnect.",
      status: 401,
      metaErrorCode: 190,
    });
  });

  it("maps code 100 with an invalid-targeting subcode to an audience message", async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(400, { error: { message: "raw", code: 100, error_subcode: 1487056 } }),
    );
    const { getMe } = await import("../metaGraph");
    await expect(getMe("token")).rejects.toMatchObject({
      userMessage: "Your audience settings aren't valid — try widening your audience.",
    });
  });

  it("maps code 368 (restricted ad account) to a policy message", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(400, { error: { message: "raw", code: 368 } }));
    const { getMe } = await import("../metaGraph");
    await expect(getMe("token")).rejects.toMatchObject({
      userMessage: "This ad account is restricted by Meta — check your Meta Business Suite for details.",
    });
  });

  it("maps a low-budget subcode to a budget message", async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(400, { error: { message: "raw", code: 100, error_subcode: 1885183 } }),
    );
    const { getMe } = await import("../metaGraph");
    await expect(getMe("token")).rejects.toMatchObject({
      userMessage: "Your daily or lifetime budget is too low for this ad set — try increasing it.",
    });
  });

  it("falls back to error.message for unmapped codes", async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(400, { error: { message: "Some obscure Meta failure", code: 999999 } }),
    );
    const { getMe } = await import("../metaGraph");
    await expect(getMe("token")).rejects.toMatchObject({ userMessage: "Some obscure Meta failure" });
  });

  it("falls back to a generic message when the body isn't valid JSON", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => { throw new Error("not json"); },
    });
    const { getMe } = await import("../metaGraph");
    await expect(getMe("token")).rejects.toMatchObject({
      userMessage: "Something went wrong talking to Meta. Please try again.",
    });
  });
});

describe("metaGraph.getInsights", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses actions/action_values into purchases, purchaseValueCents and roas", async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            spend: "50.00",
            impressions: "1000",
            reach: "900",
            clicks: "20",
            ctr: "2.0",
            cpc: "2.50",
            actions: [
              { action_type: "link_click", value: "20" },
              { action_type: "omni_purchase", value: "3" },
            ],
            action_values: [
              { action_type: "omni_purchase", value: "150.00" },
            ],
          },
        ],
      }),
    );
    const { getInsights } = await import("../metaGraph");
    const result = await getInsights("token", "campaign-1");
    expect(result).toMatchObject({
      spendCents: 5000,
      impressions: 1000,
      reach: 900,
      clicks: 20,
      cpcCents: 250,
      purchases: 3,
      purchaseValueCents: 15000,
      roas: 3, // 15000 / 5000
    });
  });

  it("returns roas null and zeroed fields when there is no insights row yet", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(200, { data: [] }));
    const { getInsights } = await import("../metaGraph");
    const result = await getInsights("token", "campaign-1");
    expect(result).toMatchObject({
      spendCents: 0,
      impressions: 0,
      purchases: 0,
      purchaseValueCents: 0,
      roas: null,
    });
  });
});

// ─── Exact Graph calls (mocked fetch) ───────────────────────────────────────

describe("metaGraph request shapes", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.META_APP_ID = "app-1";
    process.env.META_APP_SECRET = "secret-1";
    delete process.env.META_GRAPH_API_VERSION;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  const calls = () => (global.fetch as any).mock.calls as Array<[string, RequestInit | undefined]>;
  const postBody = (i: number) => JSON.parse(String(calls()[i][1]?.body));
  const proofFor = async (token: string) =>
    (await import("node:crypto")).createHmac("sha256", "secret-1").update(token).digest("hex");

  it("pins every call to the default Graph API version unless META_GRAPH_API_VERSION overrides it", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(200, { id: "1", name: "A" }));
    const { getMe, META_GRAPH_API_VERSION_DEFAULT } = await import("../metaGraph");
    expect(META_GRAPH_API_VERSION_DEFAULT).toMatch(/^v\d+\.0$/);
    await getMe("tok");
    expect(calls()[0][0]).toContain(`https://graph.facebook.com/${META_GRAPH_API_VERSION_DEFAULT}/me?`);
    process.env.META_GRAPH_API_VERSION = "v99.0";
    await getMe("tok");
    expect(calls()[1][0]).toContain("https://graph.facebook.com/v99.0/me?");
  });

  it("builds the Login dialog URL with the requested scopes, or a Login for Business config_id", async () => {
    const { buildOAuthDialogUrl, META_OAUTH_SCOPES, graphVersion } = await import("../metaGraph");
    const url = new URL(buildOAuthDialogUrl({ appId: "app-1", redirectUri: "https://x.test/api/meta-ads/oauth/callback", state: "s.t" }));
    expect(url.origin + url.pathname).toBe(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "app-1",
      redirect_uri: "https://x.test/api/meta-ads/oauth/callback",
      state: "s.t",
      response_type: "code",
      scope: META_OAUTH_SCOPES.join(","),
    });
    expect(META_OAUTH_SCOPES).toEqual(expect.arrayContaining(["ads_management", "ads_read", "business_management", "pages_show_list"]));

    const withConfig = new URL(buildOAuthDialogUrl({ appId: "app-1", redirectUri: "https://x", state: "s", configId: "cfg-9" }));
    expect(withConfig.searchParams.get("config_id")).toBe("cfg-9");
    expect(withConfig.searchParams.has("scope")).toBe(false);
  });

  it("exchanges the code for a short-lived token, then fb_exchange_token for a long-lived one", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "short", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long", expires_in: 5_183_000 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long-2" }));
    const { exchangeCodeForToken, getLongLivedToken } = await import("../metaGraph");

    await expect(exchangeCodeForToken({ code: "the-code", redirectUri: "https://x/cb" }))
      .resolves.toEqual({ accessToken: "short", expiresIn: 3600 });
    const first = new URL(calls()[0][0]);
    expect(first.pathname).toMatch(/\/oauth\/access_token$/);
    expect(Object.fromEntries(first.searchParams)).toEqual({
      client_id: "app-1", client_secret: "secret-1", redirect_uri: "https://x/cb", code: "the-code",
    });

    await expect(getLongLivedToken("short")).resolves.toEqual({ accessToken: "long", expiresIn: 5_183_000 });
    const second = new URL(calls()[1][0]);
    expect(Object.fromEntries(second.searchParams)).toEqual({
      grant_type: "fb_exchange_token", client_id: "app-1", client_secret: "secret-1", fb_exchange_token: "short",
    });

    // No expires_in → null, never an assumed fresh 60 days.
    await expect(getLongLivedToken("long")).resolves.toEqual({ accessToken: "long-2", expiresIn: null });
  });

  it("reads expiry and granted scopes from debug_token using the app token", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(200, {
      data: { is_valid: true, expires_at: 1_800_000_000, scopes: ["ads_management", "ads_read"] },
    }));
    const { debugToken } = await import("../metaGraph");
    await expect(debugToken("user-tok")).resolves.toEqual({
      isValid: true, expiresAt: new Date(1_800_000_000 * 1000), scopes: ["ads_management", "ads_read"],
    });
    const url = new URL(calls()[0][0]);
    expect(url.pathname).toMatch(/\/debug_token$/);
    expect(url.searchParams.get("input_token")).toBe("user-tok");
    expect(url.searchParams.get("access_token")).toBe("app-1|secret-1");
  });

  it("adds appsecret_proof to token-bearing GETs and POSTs", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(200, { id: "x", data: [] }));
    const { listBusinesses, updateCampaignStatus } = await import("../metaGraph");
    await listBusinesses("tok-a");
    expect(new URL(calls()[0][0]).searchParams.get("appsecret_proof")).toBe(await proofFor("tok-a"));
    await updateCampaignStatus("tok-a", "c-1", "ACTIVE");
    expect(postBody(1)).toEqual({ status: "ACTIVE", access_token: "tok-a", appsecret_proof: await proofFor("tok-a") });
  });

  it("creates the campaign with an ODAX objective, no special ad categories and ad-set budgets", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(200, { id: "camp-1" }));
    const { createCampaign, graphVersion } = await import("../metaGraph");
    await expect(createCampaign("tok", "act_1", { name: "N", objective: "OUTCOME_TRAFFIC", status: "PAUSED" }))
      .resolves.toEqual({ id: "camp-1" });
    expect(calls()[0][0]).toBe(`https://graph.facebook.com/${graphVersion()}/act_1/campaigns`);
    expect(calls()[0][1]?.method).toBe("POST");
    expect(postBody(0)).toEqual({
      name: "N",
      objective: "OUTCOME_TRAFFIC",
      status: "PAUSED",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      access_token: "tok",
      appsecret_proof: await proofFor("tok"),
    });
  });

  it("creates the ad set with minor-unit budgets, ISO times and the pixel promoted object", async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(200, { id: "adset-1" }));
    const { createAdSet } = await import("../metaGraph");
    await createAdSet("tok", "act_1", {
      name: "S", campaignId: "camp-1", dailyBudgetCents: 2500, billingEvent: "IMPRESSIONS",
      optimizationGoal: "OFFSITE_CONVERSIONS", startTime: "2026-11-01T07:00:00.000Z", endTime: "2026-11-10T06:59:59.000Z",
      targeting: { geo_locations: { countries: ["US"] } }, advantagePlus: true, status: "ACTIVE",
      pixelId: "px-1", promotedObject: { custom_event_type: "PURCHASE" },
    });
    const body = postBody(0);
    expect(calls()[0][0]).toMatch(/\/act_1\/adsets$/);
    expect(body).toMatchObject({
      name: "S",
      campaign_id: "camp-1",
      daily_budget: 2500,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      start_time: "2026-11-01T07:00:00.000Z",
      end_time: "2026-11-10T06:59:59.000Z",
      targeting: { geo_locations: { countries: ["US"] } },
      status: "ACTIVE",
      promoted_object: { pixel_id: "px-1", custom_event_type: "PURCHASE" },
    });
    expect(body).not.toHaveProperty("lifetime_budget");
  });

  it("creates the creative with instagram_user_id and the ad pointing at it", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(jsonResponse(200, { id: "cr-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "ad-1" }));
    const { createAdCreative, createAd } = await import("../metaGraph");
    await createAdCreative("tok", "act_1", {
      name: "C", pageId: "page-1", instagramActorId: "ig-1", primaryText: "Hi", headline: "H",
      ctaType: "SHOP_NOW", destinationUrl: "https://brandthread.app/p/1", imageHash: "hash-1",
    });
    expect(postBody(0)).toMatchObject({
      name: "C",
      object_story_spec: {
        page_id: "page-1",
        instagram_user_id: "ig-1",
        link_data: {
          message: "Hi", link: "https://brandthread.app/p/1", name: "H", image_hash: "hash-1",
          call_to_action: { type: "SHOP_NOW", value: { link: "https://brandthread.app/p/1" } },
        },
      },
    });
    expect(postBody(0).object_story_spec).not.toHaveProperty("instagram_actor_id");

    await createAd("tok", "act_1", { name: "A", adsetId: "adset-1", creativeId: "cr-1", status: "ACTIVE" });
    expect(calls()[1][0]).toMatch(/\/act_1\/ads$/);
    expect(postBody(1)).toMatchObject({ name: "A", adset_id: "adset-1", creative: { creative_id: "cr-1" }, status: "ACTIVE" });
  });

  it("flags every code-190 error (expired 463, invalidated 467) as needing a reconnect", async () => {
    const { MetaGraphError } = await import("../metaGraph");
    for (const subcode of [463, 467, undefined]) {
      expect(new MetaGraphError({ message: "x", status: 400, metaErrorCode: 190, metaErrorSubcode: subcode, userMessage: "x" }).requiresReconnect).toBe(true);
    }
    expect(new MetaGraphError({ message: "x", status: 400, metaErrorCode: 100, userMessage: "x" }).requiresReconnect).toBe(false);
  });
});
