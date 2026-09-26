/**
 * Meta (Facebook + Instagram) Ads API
 *
 * GET    /meta-ads/connection                          — connection status (never returns the token)
 * GET    /meta-ads/oauth/start                         — build the Meta OAuth dialog URL
 * GET    /meta-ads/oauth/callback                       — OAuth redirect target; 302s back into the app
 * GET    /meta-ads/businesses                          — list connected token's Meta businesses
 * GET    /meta-ads/businesses/:businessId/ad-accounts   — list ad accounts for a business
 * GET    /meta-ads/businesses/:businessId/pages         — list pages (+ linked IG) for a business
 * POST   /meta-ads/connection/select                    — persist business/ad-account/page selection
 * DELETE /meta-ads/connection                           — disconnect (local only, see comment below)
 * GET    /meta-ads/targeting-search                     — proxy Meta's interest/geo targeting search
 * POST   /meta-ads/campaigns                            — create a draft campaign
 * GET    /meta-ads/campaigns                            — list seller's campaigns + latest insights
 * GET    /meta-ads/campaigns/:id                        — one campaign + insights
 * PATCH  /meta-ads/campaigns/:id                        — edit a draft, or budget/endTime on a live campaign
 * GET    /meta-ads/campaigns/:id/preview                — inline creative preview (no persisted object)
 * POST   /meta-ads/campaigns/:id/launch                 — launch onto Meta (idempotent, see metaAdsLaunch.ts)
 * POST   /meta-ads/campaigns/:id/refresh-insights        — pull + upsert latest insights
 * POST   /meta-ads/campaigns/:id/pause                   — pause on Meta + locally
 * POST   /meta-ads/campaigns/:id/resume                  — resume on Meta + locally
 * POST   /meta-ads/campaigns/:id/duplicate                — clone a draft's editable fields
 * POST   /meta-ads/conversion-events                     — server-relay a Conversions API event
 */
import express, { Router } from "express";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, metaAdAccounts, metaCampaignInsights, metaCampaigns, metaConversionEvents } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { decryptToken, encryptToken, hasMetaTokenEncryptionKey } from "../lib/metaCrypto";
import {
  MetaGraphError,
  exchangeCodeForToken,
  generatePreviews,
  getInsights,
  getLongLivedToken,
  getMe,
  getOrCreatePixel,
  listAdAccounts,
  listBusinesses,
  listPages,
  targetingSearch,
  updateAdSetBudget,
  updateCampaignStatus,
  sendConversionEvent,
} from "../lib/metaGraph";
import { launchCampaign, LaunchError } from "../lib/metaAdsLaunch";

const router = Router();
router.use(requireAuth);

function sellerId(req: express.Request): string {
  return (req as any).clerkUserId as string;
}

// ─── OAuth state signing (HMAC, no server-side session table) ─────────────

function stateSecret(): Buffer | null {
  const secret = process.env.META_OAUTH_STATE_SECRET;
  return secret ? crypto.createHmac("sha256", secret).update("meta-ads-oauth-state-v1").digest() : null;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough to complete the Meta dialog

function signOAuthState(sellerIdValue: string): string | null {
  const key = stateSecret();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ sellerId: sellerIdValue, issuedAt: Date.now(), nonce: randomUUID() }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyOAuthState(state: string): { sellerId: string } | null {
  const key = stateSecret();
  if (!key) return null;
  const lastDot = state.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = state.slice(0, lastDot);
  const sig = state.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sellerId: string;
      issuedAt: number;
    };
    if (Date.now() - parsed.issuedAt > OAUTH_STATE_TTL_MS) return null;
    return { sellerId: parsed.sellerId };
  } catch {
    return null;
  }
}

function oauthErrorRedirect(message: string): string {
  return `brandthread://meta-ads-connect?oauth=error&message=${encodeURIComponent(message)}`;
}

// ─── GET /connection ────────────────────────────────────────────────────────

router.get("/connection", async (req, res) => {
  const owner = sellerId(req);
  const [row] = await db.select().from(metaAdAccounts).where(eq(metaAdAccounts.sellerId, owner)).limit(1);
  if (!row) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: row.status === "connected",
    status: row.status,
    businessName: row.businessName,
    adAccountName: row.adAccountName,
    adAccountCurrency: row.adAccountCurrency,
    pageName: row.pageName,
    instagramUsername: row.instagramUsername,
    tokenExpiresAt: row.tokenExpiresAt,
    // accessTokenEncrypted is NEVER returned to the client.
  });
});

// ─── GET /oauth/start ───────────────────────────────────────────────────────

router.get("/oauth/start", async (req, res) => {
  const owner = sellerId(req);
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !redirectUri) {
    res.status(503).json({ error: "Meta Ads is not configured." });
    return;
  }
  const state = signOAuthState(owner);
  if (!state) {
    res.status(503).json({ error: "Meta Ads is not configured." });
    return;
  }

  const version = process.env.META_GRAPH_API_VERSION?.trim() || "v21.0";
  const scope = [
    "ads_management",
    "ads_read",
    "business_management",
    "pages_show_list",
    "pages_read_engagement",
    "instagram_basic",
    "pages_manage_ads",
  ].join(",");

  const authUrl = `https://www.facebook.com/${version}/dialog/oauth?${new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope,
    response_type: "code",
  }).toString()}`;

  res.json({ authUrl });
});

// ─── GET /oauth/callback ────────────────────────────────────────────────────
// Top-level browser redirect target — always responds with a 302 to a
// brandthread:// deep link, never a JSON error body, since no XHR caller
// reads this response directly.

router.get("/oauth/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!state || typeof state !== "string") {
    res.redirect(302, oauthErrorRedirect("Missing OAuth state."));
    return;
  }
  const verified = verifyOAuthState(state);
  if (!verified) {
    res.redirect(302, oauthErrorRedirect("Your Meta connection request expired — please try again."));
    return;
  }
  if (!code || typeof code !== "string") {
    res.redirect(302, oauthErrorRedirect("Meta did not return an authorization code."));
    return;
  }

  const redirectUri = process.env.META_REDIRECT_URI;
  if (!redirectUri || !hasMetaTokenEncryptionKey()) {
    res.redirect(302, oauthErrorRedirect("Meta Ads is not configured."));
    return;
  }

  try {
    const shortLived = await exchangeCodeForToken({ code, redirectUri });
    const longLived = await getLongLivedToken(shortLived.accessToken);
    const me = await getMe(longLived.accessToken);

    const tokenExpiresAt = new Date(Date.now() + longLived.expiresIn * 1000);

    await db
      .insert(metaAdAccounts)
      .values({
        sellerId: verified.sellerId,
        metaUserId: me.id,
        metaUserName: me.name,
        accessTokenEncrypted: encryptToken(longLived.accessToken),
        tokenExpiresAt,
        scopes: [
          "ads_management",
          "ads_read",
          "business_management",
          "pages_show_list",
          "pages_read_engagement",
          "instagram_basic",
          "pages_manage_ads",
        ],
        status: "pending_selection",
      })
      .onConflictDoUpdate({
        target: metaAdAccounts.sellerId,
        set: {
          metaUserId: me.id,
          metaUserName: me.name,
          accessTokenEncrypted: encryptToken(longLived.accessToken),
          tokenExpiresAt,
          status: "pending_selection",
          lastError: null,
          disconnectedAt: null,
          updatedAt: new Date(),
        },
      });

    res.redirect(302, "brandthread://meta-ads-connect?oauth=success");
  } catch (err) {
    const message = err instanceof MetaGraphError
      ? err.userMessage
      : "Could not connect your Meta account. Please try again.";
    req.log?.error?.({ err }, "Meta OAuth callback failed");
    res.redirect(302, oauthErrorRedirect(message));
  }
});

// ─── Helpers to load the connected account + a decrypted token ────────────

async function loadConnectedAccount(owner: string) {
  const [row] = await db.select().from(metaAdAccounts).where(eq(metaAdAccounts.sellerId, owner)).limit(1);
  return row ?? null;
}

async function requireDecryptedToken(
  req: express.Request,
  res: express.Response,
): Promise<{ account: typeof metaAdAccounts.$inferSelect; accessToken: string } | null> {
  const owner = sellerId(req);
  const account = await loadConnectedAccount(owner);
  if (!account || !account.accessTokenEncrypted) {
    res.status(409).json({ error: "Connect your Meta account first." });
    return null;
  }
  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);
    return { account, accessToken };
  } catch {
    res.status(503).json({ error: "Meta Ads is not configured." });
    return null;
  }
}

// ─── GET /businesses ────────────────────────────────────────────────────────

router.get("/businesses", async (req, res) => {
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  try {
    const businesses = await listBusinesses(loaded.accessToken);
    res.json({ businesses });
  } catch (err) {
    handleMetaError(req, res, err, "Could not load your Meta businesses.");
  }
});

// ─── GET /businesses/:businessId/ad-accounts ───────────────────────────────

router.get("/businesses/:businessId/ad-accounts", async (req, res) => {
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  try {
    const adAccounts = await listAdAccounts(loaded.accessToken, req.params.businessId);
    res.json({ adAccounts });
  } catch (err) {
    handleMetaError(req, res, err, "Could not load ad accounts.");
  }
});

// ─── GET /businesses/:businessId/pages ─────────────────────────────────────

router.get("/businesses/:businessId/pages", async (req, res) => {
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  try {
    const pages = await listPages(loaded.accessToken, req.params.businessId);
    res.json({ pages });
  } catch (err) {
    handleMetaError(req, res, err, "Could not load your Facebook pages.");
  }
});

// ─── POST /connection/select ────────────────────────────────────────────────

router.post("/connection/select", express.json({ limit: "16kb" }), async (req, res) => {
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;

  const {
    businessId, businessName, adAccountId, adAccountName, adAccountCurrency,
    pageId, pageName, instagramActorId, instagramUsername,
  } = req.body as Record<string, unknown>;

  if (!businessId || !adAccountId || !pageId) {
    res.status(400).json({ error: "businessId, adAccountId and pageId are required" });
    return;
  }

  try {
    const pixel = await getOrCreatePixel(loaded.accessToken, adAccountId as string);

    const [updated] = await db
      .update(metaAdAccounts)
      .set({
        businessId: businessId as string,
        businessName: (businessName as string) ?? null,
        adAccountId: adAccountId as string,
        adAccountName: (adAccountName as string) ?? null,
        adAccountCurrency: (adAccountCurrency as string) ?? null,
        pageId: pageId as string,
        pageName: (pageName as string) ?? null,
        instagramActorId: (instagramActorId as string) ?? null,
        instagramUsername: (instagramUsername as string) ?? null,
        pixelId: pixel.id,
        status: "connected",
        connectedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(metaAdAccounts.sellerId, sellerId(req)))
      .returning();

    res.json({
      connected: true,
      status: updated.status,
      businessName: updated.businessName,
      adAccountName: updated.adAccountName,
      adAccountCurrency: updated.adAccountCurrency,
      pageName: updated.pageName,
      instagramUsername: updated.instagramUsername,
      tokenExpiresAt: updated.tokenExpiresAt,
    });
  } catch (err) {
    handleMetaError(req, res, err, "Could not finish connecting your Meta ad account.");
  }
});

// ─── DELETE /connection ─────────────────────────────────────────────────────
// Best-effort local disconnect only. Meta's long-lived user tokens have no
// simple single-call revoke that's worth the complexity here (revoking would
// require a separate DELETE /{user-id}/permissions call with its own error
// handling); clearing our copy of the token is sufficient since Meta expires
// it naturally and the seller can also revoke app access from their own
// Facebook settings at any time.

router.delete("/connection", async (req, res) => {
  const owner = sellerId(req);
  await db
    .update(metaAdAccounts)
    .set({
      accessTokenEncrypted: "",
      status: "disconnected",
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(metaAdAccounts.sellerId, owner));
  res.status(204).send();
});

// ─── GET /targeting-search ──────────────────────────────────────────────────

router.get("/targeting-search", async (req, res) => {
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  const { q, type } = req.query as { q?: string; type?: string };
  if (!q || (type !== "adinterest" && type !== "adgeolocation")) {
    res.status(400).json({ error: "q and type (adinterest|adgeolocation) are required" });
    return;
  }
  if (!loaded.account.adAccountId) {
    res.status(409).json({ error: "Select an ad account first." });
    return;
  }
  try {
    const results = await targetingSearch(loaded.accessToken, loaded.account.adAccountId, q, type);
    res.json({ results });
  } catch (err) {
    handleMetaError(req, res, err, "Could not search Meta's targeting options.");
  }
});

// ─── Campaign CRUD ──────────────────────────────────────────────────────────

const OBJECTIVE_TO_META: Record<string, string> = {
  sales: "OUTCOME_SALES",
  traffic: "OUTCOME_TRAFFIC",
  awareness: "OUTCOME_AWARENESS",
};

/**
 * Rough, budget-only reach estimate — NOT from Meta's `delivery_estimate`
 * edge. Meta's real delivery estimate needs a fully-formed targeting spec and
 * an existing ad set, which doesn't exist yet at draft-creation time here.
 * TODO: once a draft has a target ad set, wire the real
 * `/act_.../delivery_estimate` edge for a live number.
 */
function estimateReach(budgetCents: number): { low: number; high: number } {
  const dollars = budgetCents / 100;
  return { low: Math.floor(dollars * 40), high: Math.floor(dollars * 90) };
}

async function findOwnedCampaign(id: string, owner: string) {
  const [row] = await db
    .select()
    .from(metaCampaigns)
    .where(and(eq(metaCampaigns.id, id), eq(metaCampaigns.sellerId, owner)))
    .limit(1);
  return row ?? null;
}

router.post("/campaigns", express.json({ limit: "32kb" }), async (req, res) => {
  const owner = sellerId(req);
  const account = await loadConnectedAccount(owner);
  if (!account || account.status !== "connected") {
    res.status(409).json({ error: "Connect your Meta account first." });
    return;
  }

  const body = req.body as Record<string, any>;
  const { promoteKind, objective, budgetCents, destinationUrl } = body;

  if (!["product", "store", "video"].includes(promoteKind)) {
    res.status(400).json({ error: "promoteKind must be one of: product, store, video" });
    return;
  }
  if (!OBJECTIVE_TO_META[objective]) {
    res.status(400).json({ error: "objective must be one of: sales, traffic, awareness" });
    return;
  }
  if (!Number.isInteger(budgetCents) || budgetCents <= 0) {
    res.status(400).json({ error: "budgetCents must be a positive whole number" });
    return;
  }
  if (!destinationUrl || typeof destinationUrl !== "string") {
    res.status(400).json({ error: "destinationUrl is required" });
    return;
  }

  const [created] = await db
    .insert(metaCampaigns)
    .values({
      sellerId: owner,
      adAccountRecordId: account.id,
      localAdCampaignId: body.localAdCampaignId ?? null,
      promoteKind,
      promoteRefId: body.promoteRefId ?? null,
      objective,
      metaObjective: OBJECTIVE_TO_META[objective],
      primaryText: body.primaryText ?? null,
      headline: body.headline ?? null,
      ctaType: body.ctaType ?? "SHOP_NOW",
      destinationUrl,
      mediaKind: body.mediaKind === "video" ? "video" : "photos",
      mediaObjectPaths: Array.isArray(body.mediaObjectPaths) ? body.mediaObjectPaths : [],
      budgetType: body.budgetType === "lifetime" ? "lifetime" : "daily",
      budgetCents,
      startTime: body.startTime ? new Date(body.startTime) : null,
      endTime: body.endTime ? new Date(body.endTime) : null,
      advantagePlus: body.advantagePlus !== false,
      placements: body.placements ?? {},
      targetingSpec: body.targetingSpec ?? {},
      idempotencyKey: randomUUID(),
    })
    .returning();

  res.status(201).json({ campaign: created, estimatedReach: estimateReach(budgetCents) });
});

router.get("/campaigns", async (req, res) => {
  const owner = sellerId(req);
  const rows = await db
    .select()
    .from(metaCampaigns)
    .where(eq(metaCampaigns.sellerId, owner))
    .orderBy(desc(metaCampaigns.createdAt))
    .limit(50);

  const campaigns = await Promise.all(rows.map(async (row) => {
    const [insights] = await db
      .select()
      .from(metaCampaignInsights)
      .where(eq(metaCampaignInsights.campaignId, row.id))
      .limit(1);
    return { ...row, insights: insights ?? null };
  }));

  res.json({ campaigns });
});

router.get("/campaigns/:id", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const [insights] = await db
    .select()
    .from(metaCampaignInsights)
    .where(eq(metaCampaignInsights.campaignId, campaign.id))
    .limit(1);
  res.json({ campaign: { ...campaign, insights: insights ?? null } });
});

router.patch("/campaigns/:id", express.json({ limit: "32kb" }), async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const body = req.body as Record<string, any>;

  if (campaign.status === "active" || campaign.status === "paused") {
    // Live campaigns: only budget/endTime may change, and the change is
    // pushed to Meta's ad set immediately.
    const updates: Partial<typeof metaCampaigns.$inferInsert> = { updatedAt: new Date() };
    if (body.budgetCents !== undefined) {
      if (!Number.isInteger(body.budgetCents) || body.budgetCents <= 0) {
        res.status(400).json({ error: "budgetCents must be a positive whole number" });
        return;
      }
      updates.budgetCents = body.budgetCents;
    }
    if (body.endTime !== undefined) {
      updates.endTime = body.endTime ? new Date(body.endTime) : null;
    }
    if (Object.keys(updates).length === 1) {
      res.json({ campaign });
      return;
    }

    if (campaign.metaAdSetId) {
      const loaded = await requireDecryptedToken(req, res);
      if (!loaded) return;
      try {
        await updateAdSetBudget(loaded.accessToken, campaign.metaAdSetId, {
          dailyBudgetCents: campaign.budgetType === "daily" ? updates.budgetCents : undefined,
          lifetimeBudgetCents: campaign.budgetType === "lifetime" ? updates.budgetCents : undefined,
          endTime: updates.endTime ? updates.endTime.toISOString() : undefined,
        });
      } catch (err) {
        handleMetaError(req, res, err, "Could not update the campaign on Meta.");
        return;
      }
    }

    const [updated] = await db
      .update(metaCampaigns)
      .set(updates)
      .where(and(eq(metaCampaigns.id, campaign.id), eq(metaCampaigns.sellerId, owner)))
      .returning();
    res.json({ campaign: updated });
    return;
  }

  if (campaign.status !== "draft" && campaign.status !== "failed") {
    res.status(409).json({ error: "Only draft, failed, active or paused campaigns can be edited" });
    return;
  }

  const editable = [
    "primaryText", "headline", "ctaType", "destinationUrl", "mediaKind", "mediaObjectPaths",
    "budgetType", "budgetCents", "advantagePlus", "placements", "targetingSpec", "promoteRefId",
  ] as const;
  const updates: Partial<typeof metaCampaigns.$inferInsert> = { updatedAt: new Date() };
  for (const key of editable) {
    if (body[key] !== undefined) (updates as any)[key] = body[key];
  }
  if (body.startTime !== undefined) updates.startTime = body.startTime ? new Date(body.startTime) : null;
  if (body.endTime !== undefined) updates.endTime = body.endTime ? new Date(body.endTime) : null;

  const [updated] = await db
    .update(metaCampaigns)
    .set(updates)
    .where(and(eq(metaCampaigns.id, campaign.id), eq(metaCampaigns.sellerId, owner)))
    .returning();

  res.json({
    campaign: updated,
    ...(updated.budgetCents !== undefined ? { estimatedReach: estimateReach(updated.budgetCents) } : {}),
  });
});

router.get("/campaigns/:id/preview", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  if (!loaded.account.adAccountId || !loaded.account.pageId) {
    res.status(409).json({ error: "Select an ad account and page first." });
    return;
  }

  const creativeSpec: Record<string, unknown> = {
    object_story_spec: {
      page_id: loaded.account.pageId,
      ...(loaded.account.instagramActorId ? { instagram_actor_id: loaded.account.instagramActorId } : {}),
      link_data: {
        message: campaign.primaryText,
        link: campaign.destinationUrl,
        name: campaign.headline,
        call_to_action: { type: campaign.ctaType, value: { link: campaign.destinationUrl } },
      },
    },
  };

  try {
    const previews = await generatePreviews(
      loaded.accessToken,
      loaded.account.adAccountId,
      creativeSpec,
      (req.query.adFormat as string) || "MOBILE_FEED_STANDARD",
    );
    res.json({ previews });
  } catch (err) {
    handleMetaError(req, res, err, "Could not build an ad preview.");
  }
});

router.post("/campaigns/:id/launch", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  try {
    const result = await launchCampaign(campaign.id);
    res.json(result);
  } catch (err) {
    if (err instanceof LaunchError) {
      res.status(422).json({ error: err.userMessage });
      return;
    }
    req.log?.error?.({ err, campaignId: campaign.id }, "Meta campaign launch failed unexpectedly");
    res.status(500).json({ error: "Could not launch this campaign. Please try again." });
  }
});

router.post("/campaigns/:id/refresh-insights", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!campaign.metaCampaignId) {
    res.status(409).json({ error: "Campaign has not been launched on Meta yet." });
    return;
  }
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;

  try {
    const insights = await getInsights(loaded.accessToken, campaign.metaCampaignId);
    const [row] = await db
      .insert(metaCampaignInsights)
      .values({ campaignId: campaign.id, ...insights, roas: insights.roas?.toString() ?? null, ctr: insights.ctr.toString(), fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: metaCampaignInsights.campaignId,
        set: {
          spendCents: insights.spendCents,
          impressions: insights.impressions,
          reach: insights.reach,
          clicks: insights.clicks,
          ctr: insights.ctr.toString(),
          cpcCents: insights.cpcCents,
          purchases: insights.purchases,
          purchaseValueCents: insights.purchaseValueCents,
          roas: insights.roas?.toString() ?? null,
          fetchedAt: new Date(),
        },
      })
      .returning();

    await db.update(metaCampaigns).set({ lastSyncedAt: new Date() }).where(eq(metaCampaigns.id, campaign.id));

    res.json({ insights: row });
  } catch (err) {
    handleMetaError(req, res, err, "Could not refresh insights from Meta.");
  }
});

router.post("/campaigns/:id/pause", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!campaign.metaCampaignId) {
    res.status(409).json({ error: "Campaign has not been launched on Meta yet." });
    return;
  }
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  try {
    await updateCampaignStatus(loaded.accessToken, campaign.metaCampaignId, "PAUSED");
    const [updated] = await db
      .update(metaCampaigns)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(metaCampaigns.id, campaign.id))
      .returning();
    res.json({ campaign: updated });
  } catch (err) {
    handleMetaError(req, res, err, "Could not pause this campaign on Meta.");
  }
});

router.post("/campaigns/:id/resume", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!campaign.metaCampaignId) {
    res.status(409).json({ error: "Campaign has not been launched on Meta yet." });
    return;
  }
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  try {
    await updateCampaignStatus(loaded.accessToken, campaign.metaCampaignId, "ACTIVE");
    const [updated] = await db
      .update(metaCampaigns)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(metaCampaigns.id, campaign.id))
      .returning();
    res.json({ campaign: updated });
  } catch (err) {
    handleMetaError(req, res, err, "Could not resume this campaign on Meta.");
  }
});

router.post("/campaigns/:id/duplicate", async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const [created] = await db
    .insert(metaCampaigns)
    .values({
      sellerId: owner,
      adAccountRecordId: campaign.adAccountRecordId,
      localAdCampaignId: campaign.localAdCampaignId,
      promoteKind: campaign.promoteKind,
      promoteRefId: campaign.promoteRefId,
      objective: campaign.objective,
      metaObjective: campaign.metaObjective,
      primaryText: campaign.primaryText,
      headline: campaign.headline,
      ctaType: campaign.ctaType,
      destinationUrl: campaign.destinationUrl,
      mediaKind: campaign.mediaKind,
      mediaObjectPaths: campaign.mediaObjectPaths,
      budgetType: campaign.budgetType,
      budgetCents: campaign.budgetCents,
      startTime: campaign.startTime,
      endTime: campaign.endTime,
      advantagePlus: campaign.advantagePlus,
      placements: campaign.placements,
      targetingSpec: campaign.targetingSpec,
      idempotencyKey: randomUUID(),
      // meta*Id fields intentionally omitted — this is a fresh, unlaunched draft.
    })
    .returning();

  res.status(201).json({ campaign: created });
});

// ─── POST /conversion-events ────────────────────────────────────────────────

const ALLOWED_EVENT_NAMES = new Set(["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]);

router.post("/conversion-events", express.json({ limit: "8kb" }), async (req, res) => {
  const owner = sellerId(req);
  const { eventId, eventName, occurredAt, productId, valueCents, currency } = req.body as Record<string, any>;

  if (!eventId || !ALLOWED_EVENT_NAMES.has(eventName) || !occurredAt) {
    res.status(400).json({ error: "eventId, a valid eventName, and occurredAt are required" });
    return;
  }

  // Always respond quickly — insert the log row (deduped) first, and treat
  // any Meta relay failure as best-effort so a Meta outage never blocks the
  // caller (the mobile client already fired its own client-side Pixel event
  // with the same eventId, which is what Meta's own dedup relies on).
  try {
    await db.insert(metaConversionEvents).values({
      sellerId: owner,
      eventId,
      eventName,
      occurredAt: new Date(occurredAt),
      productId: productId ?? null,
      valueCents: typeof valueCents === "number" ? valueCents : null,
      currency: currency ?? "USD",
    }).onConflictDoNothing();
  } catch (err) {
    req.log?.error?.({ err }, "Failed to record Meta conversion event");
  }

  const account = await loadConnectedAccount(owner);
  if (!account || account.status !== "connected" || !account.pixelId || !account.accessTokenEncrypted) {
    res.json({ ok: true });
    return;
  }

  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);
    const result = await sendConversionEvent(accessToken, account.pixelId, {
      eventName,
      eventId,
      eventTime: Math.floor(new Date(occurredAt).getTime() / 1000),
      userData: {
        client_ip_address: req.ip,
        client_user_agent: req.headers["user-agent"] as string | undefined,
      },
      customData: {
        ...(productId ? { content_ids: [productId] } : {}),
        ...(typeof valueCents === "number" ? { value: valueCents / 100, currency: currency ?? "USD" } : {}),
      },
    });
    await db
      .update(metaConversionEvents)
      .set({ sentToMeta: true, metaResponseStatus: `ok:${result.eventsReceived}` })
      .where(and(
        eq(metaConversionEvents.sellerId, owner),
        eq(metaConversionEvents.eventId, eventId),
        eq(metaConversionEvents.eventName, eventName),
      ));
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.userMessage : String((err as Error)?.message ?? err);
    await db
      .update(metaConversionEvents)
      .set({ sentToMeta: false, metaResponseStatus: message })
      .where(and(
        eq(metaConversionEvents.sellerId, owner),
        eq(metaConversionEvents.eventId, eventId),
        eq(metaConversionEvents.eventName, eventName),
      ));
  }

  res.json({ ok: true });
});

// ─── Shared error mapping ───────────────────────────────────────────────────

function handleMetaError(req: express.Request, res: express.Response, err: unknown, fallback: string): void {
  if (err instanceof MetaGraphError) {
    req.log?.error?.({ err, metaErrorCode: err.metaErrorCode }, "Meta Graph API call failed");
    res.status(err.status === 401 || err.status === 403 ? err.status : 502).json({ error: err.userMessage });
    return;
  }
  req.log?.error?.({ err }, fallback);
  res.status(502).json({ error: fallback });
}

export default router;
