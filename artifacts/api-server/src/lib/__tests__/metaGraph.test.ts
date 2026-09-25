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
