import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routesSource = fs.readFileSync(
  path.resolve(__dirname, "..", "index.ts"),
  "utf8",
);
const liveSource = fs.readFileSync(
  path.resolve(__dirname, "..", "live.ts"),
  "utf8",
);
const manufacturersSource = fs.readFileSync(
  path.resolve(__dirname, "..", "manufacturers.ts"),
  "utf8",
);

const analyticsSource = fs.readFileSync(path.resolve(__dirname, "..", "analytics.ts"), "utf8");
const insightsSource = fs.readFileSync(path.resolve(__dirname, "..", "analytics-insights.ts"), "utf8");

describe("paid route mounts", () => {
  it("keeps every paid route behind an explicit minimum plan", () => {
    expect(routesSource).toContain(
      'router.use("/logo",            tc, requirePlan("growth"), aiSafetyGuard("logo"), logoRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/mockup",          tc, requirePlan("growth"), aiSafetyGuard("mockup"), mockupRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/photography",     tc, requirePlan("growth"), aiSafetyGuard("photography"), photographyRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/bg-removal",      tc, requirePlan("growth"), aiSafetyGuard("bg-removal"), bgRemovalRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/lifestyle",       tc, requirePlan("growth"), aiSafetyGuard("lifestyle"), lifestyleRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/techpack",        tc, requirePlan("growth"), aiSafetyGuard("techpack", { mode: "chat", scan: "all" }), techpackRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/manufacturers",   tc, manufacturersRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/team",                      teamRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/live",                      tc, liveRouter);',
    );
    // Buying a boost or a Featured slot: Growth+ (planCatalogue.ts → boosts).
    expect(routesSource).toContain(
      'router.use("/boosts",                    tc, featureGate("boosts", { only: [{ method: "POST", path: "/" }] }), boostsRouter);',
    );
    expect(routesSource).toContain('featureGate("boosts", { only: [{ method: "POST", path: "/" }] }), featuredSlotsRouter);');
  });

  it("gates starting growth tools (not managing them) on the server", () => {
    expect(routesSource).toContain('featureGate("drops", { only: [{ method: "POST", path: "/" }] }), dropsRouter');
    // Giveaways and Shopify sync aren't tier differences in Dev's plan tiers.
    expect(routesSource).toContain('router.use("/seller/giveaways",          tc, sellerGiveawaysRouter);');
    expect(routesSource).toContain('router.use("/shopify",         tc, shopifyRouter);');
    expect(routesSource).toContain('featureGate("custom_domain", { only: [{ method: "POST", path: "/domains" }] }), storeRouter');
    expect(routesSource).toContain('featureGate("manufacturer_hub", { only: [{ method: "POST", path: "/", when: (req) => req.body?.orderType === "bulk" }] }), sampleOrdersRouter');
    expect(routesSource).toContain('{ method: "POST", path: "/quote-requests", when: (req) => req.body?.type !== "sample" }, { method: "POST", path: "/rfqs" }] }), sellerHubRouter');
    expect(routesSource).toContain('tc, pushBroadcastAllowance, sellerPushBroadcastsRouter');
  });

  it("gates hosting a live behind the live_hosting plan without blocking buyers from watching", () => {
    expect(liveSource).toContain('const hostPlan = featureGate("live_hosting", { extra: checkLiveAllowance });');
    expect(liveSource).toContain('router.post("/start", requireAuth, hostPlan,');
    expect(liveSource).toContain('router.post("/:id/end", requireAuth, hostPlan,');
    expect(liveSource).toContain('router.patch("/:id/products", requireAuth, hostPlan,');
    // Viewer routes carry no plan gate.
    expect(liveSource).toContain('router.get("/feed", async');
    expect(liveSource).toContain('router.get("/active", async');
    expect(liveSource).toContain('router.post("/:id/join", requireAuth, async');
    expect(liveSource).toContain('router.post("/:id/comment", requireAuth, async');
  });

  it("gates seller manufacturer actions without blocking manufacturer onboarding", () => {
    expect(manufacturersSource).toContain(
      'const requireGrowthSeller = [requireAuth, teamContext(), featureGate("manufacturer_hub")] as const;',
    );
    expect(manufacturersSource).toContain(
      'router.post("/invite-tokens", ...requireGrowthSeller',
    );
    expect(manufacturersSource).toContain(
      'router.get("/threads/:threadId/messages", ...requireGrowthSeller',
    );
    expect(manufacturersSource).toContain(
      'router.get("/invite-tokens/resolve/:token", async',
    );
    expect(manufacturersSource).toContain(
      'router.post("/register-via-invite/:token", async',
    );
  });

  it("reads the analytics level from the plan config", () => {
    expect(analyticsSource).toContain('router.get("/advanced", featureGate("advanced_analytics"),');
    expect(analyticsSource).toContain('router.get("/customers", featureGate("advanced_analytics"),');
    expect(insightsSource).toContain('router.get("/advanced", featureGate("advanced_analytics"),');
    expect(insightsSource).toContain('router.post("/export", featureGate("analytics_export"),');
    expect(analyticsSource + insightsSource).not.toContain('requirePlan("pro")');
  });
});
