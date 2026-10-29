/**
 * Meta (Facebook + Instagram) Ads API
 *
 * GET    /meta-ads/connection                          — connection status (never returns the token)
 * GET    /meta-ads/oauth/start                         — build the Meta OAuth dialog URL
 * GET    /meta-ads/oauth/callback                       — OAuth redirect target (unauthenticated, separate
 *                                                         router); 302s the code back into the app
 * POST   /meta-ads/oauth/complete                       — app hands back code+state; token exchange happens here
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
 * GET    /meta-ads/campaigns/:id/reach-estimate          — Meta's own delivery_estimate for the draft
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
import { db, metaAdAccounts, metaCampaignInsights, metaCampaigns } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { encryptToken, hasMetaTokenEncryptionKey } from "../lib/metaCrypto";
import {
  META_OAUTH_SCOPES,
  META_REQUIRED_SCOPES,
  MetaGraphError,
  buildOAuthDialogUrl,
  debugToken,
  exchangeCodeForToken,
  generatePreviews,
  getDeliveryEstimate,
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
} from "../lib/metaGraph";
import { buildTargeting, launchCampaign, LaunchError, OBJECTIVE_TO_OPTIMIZATION_GOAL } from "../lib/metaAdsLaunch";
import {
  MetaReconnectRequiredError,
  RECONNECT_MESSAGE,
  connectionState,
  getFreshAccessToken,
  markNeedsReconnect,
  marketingTarget,
  metaSandbox,
} from "../lib/metaConnection";
import { validateMetaSchedule } from "../lib/metaAdsSchedule";
import { relayConversionEvent } from "../lib/metaCapiRelay";

const router = Router();
router.use(requireAuth);

/** Error codes the app branches on (see lib/api.ts metaAds). */
const NOT_CONNECTED_CODE = "META_NOT_CONNECTED";
const RECONNECT_CODE = "META_RECONNECT_REQUIRED";

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
    if (typeof parsed.sellerId !== "string" || !Number.isFinite(parsed.issuedAt)) return null;
    if (Date.now() - parsed.issuedAt > OAUTH_STATE_TTL_MS) return null;
    return { sellerId: parsed.sellerId };
  } catch {
    return null;
  }
}

function oauthErrorRedirect(message: string): string {
  return `brandthread://meta-ads-connect?oauth=error&message=${encodeURIComponent(message)}`;
}

/** Fields of the stored connection the app may see — never the token. */
function connectionPayload(row: typeof metaAdAccounts.$inferSelect) {
  const state = connectionState(row);
  return {
    // `state` is the field the app branches on; `connected` / `status` are kept for older builds.
    state,
    configured: true,
    connected: state === "connected",
    status: state === "needs_reconnect" ? "needs_reauth" : row.status,
    sandbox: metaSandbox() !== null,
    businessName: row.businessName,
    adAccountName: row.adAccountName,
    adAccountCurrency: row.adAccountCurrency,
    pageName: row.pageName,
    instagramUsername: row.instagramUsername,
    tokenExpiresAt: row.tokenExpiresAt,
    ...(state === "needs_reconnect" ? { reconnectReason: row.lastError ?? RECONNECT_MESSAGE } : {}),
    // accessTokenEncrypted is NEVER returned to the client.
  };
}

// ─── GET /connection ────────────────────────────────────────────────────────
// Always 200 with an explicit `state`: 'not_configured' | 'not_connected' |
// 'pending_selection' | 'connected' | 'needs_reconnect'. A failed request
// (network / 5xx) therefore can never be mistaken for "not connected".

router.get("/connection", async (req, res) => {
  if (!hasMetaTokenEncryptionKey()) {
    res.json({
      state: "not_configured",
      connected: false,
      configured: false,
      configurationError: "Meta / Instagram is not configured.",
    });
    return;
  }
  const owner = sellerId(req);
  let row = await loadConnectedAccount(owner);
  if (!row || connectionState(row) === "not_connected") {
    res.json({ state: "not_connected", configured: true, connected: false, sandbox: metaSandbox() !== null });
    return;
  }
  // Extends a token in its last week (or flags it expired) before reporting.
  try {
    await getFreshAccessToken(row);
  } catch {
    // Reconnect (row now marked) or a key problem — the re-read below reports it.
  }
  row = (await loadConnectedAccount(owner)) ?? row;
  res.json(connectionPayload(row));
});

// ─── GET /oauth/start ───────────────────────────────────────────────────────

router.get("/oauth/start", async (req, res) => {
  const owner = sellerId(req);
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !process.env.META_APP_SECRET || !redirectUri || !hasMetaTokenEncryptionKey()) {
    res.status(503).json({ error: "Meta Ads is not configured." });
    return;
  }
  const state = signOAuthState(owner);
  if (!state) {
    res.status(503).json({ error: "Meta Ads is not configured." });
    return;
  }

  const authUrl = buildOAuthDialogUrl({
    appId,
    redirectUri,
    state,
    configId: process.env.META_LOGIN_CONFIG_ID?.trim() || undefined,
  });

  res.json({ authUrl });
});

// ─── POST /oauth/complete ───────────────────────────────────────────────────
// The callback below only bounces Meta's `code` + `state` into the app; the
// signed-in app posts them here. The state's seller must be the caller, so a
// Meta login link started by someone else can never attach the caller's (or
// a victim's) Meta account to the wrong Brandthread store.

router.post("/oauth/complete", express.json({ limit: "8kb" }), async (req, res) => {
  const { code, state } = (req.body ?? {}) as { code?: unknown; state?: unknown };
  if (typeof code !== "string" || !code || typeof state !== "string" || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }
  const verified = verifyOAuthState(state);
  if (!verified || verified.sellerId !== sellerId(req)) {
    res.status(400).json({ error: "Your Meta connection request expired — please try again." });
    return;
  }
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!redirectUri || !hasMetaTokenEncryptionKey()) {
    res.status(503).json({ error: "Meta Ads is not configured." });
    return;
  }

  try {
    // code → short-lived token → long-lived (~60 day) token.
    const shortLived = await exchangeCodeForToken({ code, redirectUri });
    const longLived = await getLongLivedToken(shortLived.accessToken);
    const me = await getMe(longLived.accessToken);

    // Meta's own record of the token: real expiry + what the seller granted
    // (permissions can be unticked in the Login dialog). Best effort — fall
    // back to the exchange's expires_in and the requested scopes.
    let granted: string[] = [...META_OAUTH_SCOPES];
    let tokenExpiresAt = new Date(Date.now() + (longLived.expiresIn ?? 5_184_000 /* ~60 days */) * 1000);
    try {
      const info = await debugToken(longLived.accessToken);
      if (info.scopes.length > 0) granted = info.scopes;
      if (info.expiresAt) tokenExpiresAt = info.expiresAt;
    } catch (err) {
      req.log?.warn?.({ err }, "Meta debug_token failed; using exchange defaults");
    }
    const missing = META_REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
    if (missing.length > 0) {
      res.status(422).json({
        error: "Brandthread needs permission to manage your ads, businesses and Pages. Connect again and keep every permission switched on.",
        missingScopes: missing,
      });
      return;
    }

    const encrypted = encryptToken(longLived.accessToken);
    await db
      .insert(metaAdAccounts)
      .values({
        sellerId: verified.sellerId,
        metaUserId: me.id,
        metaUserName: me.name,
        accessTokenEncrypted: encrypted,
        tokenExpiresAt,
        scopes: granted,
        status: "pending_selection",
      })
      .onConflictDoUpdate({
        target: metaAdAccounts.sellerId,
        set: {
          metaUserId: me.id,
          metaUserName: me.name,
          accessTokenEncrypted: encrypted,
          tokenExpiresAt,
          scopes: granted,
          status: "pending_selection",
          lastError: null,
          disconnectedAt: null,
          updatedAt: new Date(),
        },
      });

    const row = await loadConnectedAccount(verified.sellerId);
    res.json(row ? connectionPayload(row) : { state: "pending_selection", configured: true, connected: false, status: "pending_selection" });
  } catch (err) {
    await handleMetaError(req, res, err, "Could not connect your Meta account. Please try again.");
  }
});

// ─── Helpers to load the connected account + a decrypted token ────────────

async function loadConnectedAccount(owner: string) {
  const [row] = await db.select().from(metaAdAccounts).where(eq(metaAdAccounts.sellerId, owner)).limit(1);
  return row ?? null;
}

/**
 * Loads the caller's connection and a usable token, or answers for them:
 * 409 META_NOT_CONNECTED, 409 META_RECONNECT_REQUIRED (expired / revoked),
 * 503 when the server can't decrypt tokens.
 */
async function requireDecryptedToken(
  req: express.Request,
  res: express.Response,
): Promise<{ account: typeof metaAdAccounts.$inferSelect; accessToken: string } | null> {
  const owner = sellerId(req);
  const account = await loadConnectedAccount(owner);
  if (!account || connectionState(account) === "not_connected") {
    res.status(409).json({ error: "Connect your Meta account first.", code: NOT_CONNECTED_CODE });
    return null;
  }
  try {
    const accessToken = await getFreshAccessToken(account);
    return { account, accessToken };
  } catch (err) {
    if (err instanceof MetaReconnectRequiredError) {
      res.status(409).json({ error: err.userMessage, code: RECONNECT_CODE });
      return null;
    }
    res.status(503).json({ error: "Meta Ads is not configured." });
    return null;
  }
}

/**
 * Same as requireDecryptedToken, then swaps in the sandbox ad account/token
 * when META_ADS_SANDBOX=1. For Marketing API calls on the ad account only —
 * business/page listing always uses the seller's own token.
 */
async function requireMarketingTarget(
  req: express.Request,
  res: express.Response,
): Promise<{ account: typeof metaAdAccounts.$inferSelect; accessToken: string; adAccountId: string } | null> {
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return null;
  const target = marketingTarget(loaded.account, loaded.accessToken);
  if (!target.adAccountId) {
    res.status(409).json({
      error: target.sandbox ? "Meta sandbox mode is on but META_SANDBOX_AD_ACCOUNT_ID is not set." : "Select an ad account first.",
    });
    return null;
  }
  return { account: loaded.account, accessToken: target.accessToken, adAccountId: target.adAccountId };
}

// ─── GET /businesses ────────────────────────────────────────────────────────

router.get("/businesses", async (req, res) => {
  const loaded = await requireDecryptedToken(req, res);
  if (!loaded) return;
  try {
    const businesses = await listBusinesses(loaded.accessToken);
    res.json({ businesses });
  } catch (err) {
    await handleMetaError(req, res, err, "Could not load your Meta businesses.");
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
    await handleMetaError(req, res, err, "Could not load ad accounts.");
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
    await handleMetaError(req, res, err, "Could not load your Facebook pages.");
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
    const target = marketingTarget({ adAccountId: adAccountId as string }, loaded.accessToken);
    const pixel = await getOrCreatePixel(target.accessToken, target.adAccountId ?? (adAccountId as string));

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

    res.json(connectionPayload(updated));
  } catch (err) {
    await handleMetaError(req, res, err, "Could not finish connecting your Meta ad account.");
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
  const { q, type } = req.query as { q?: string; type?: string };
  if (!q || (type !== "adinterest" && type !== "adgeolocation")) {
    res.status(400).json({ error: "q and type (adinterest|adgeolocation) are required" });
    return;
  }
  const loaded = await requireMarketingTarget(req, res);
  if (!loaded) return;
  try {
    const results = await targetingSearch(loaded.accessToken, loaded.adAccountId, q, type);
    res.json({ results });
  } catch (err) {
    await handleMetaError(req, res, err, "Could not search Meta's targeting options.");
  }
});

// ─── Campaign CRUD ──────────────────────────────────────────────────────────

const OBJECTIVE_TO_META: Record<string, string> = {
  sales: "OUTCOME_SALES",
  traffic: "OUTCOME_TRAFFIC",
  awareness: "OUTCOME_AWARENESS",
};

/**
 * Daily spend Meta's delivery estimate is read at: a daily budget as-is; a
 * lifetime budget spread evenly over its scheduled days (or treated as one
 * day's spend when no end date is set yet).
 */
export function dailySpendCentsFor(campaign: {
  budgetType: string; budgetCents: number; startTime: Date | null; endTime: Date | null;
}, now = new Date()): number {
  if (campaign.budgetType !== "lifetime") return campaign.budgetCents;
  if (!campaign.endTime) return campaign.budgetCents;
  const start = campaign.startTime ?? now;
  const days = Math.max(1, Math.ceil((campaign.endTime.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  return Math.round(campaign.budgetCents / days);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findOwnedCampaign(id: string, owner: string) {
  // ids are uuid columns: a malformed id is simply "not found", not a DB error.
  if (!UUID_RE.test(id)) return null;
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
  const state = connectionState(account);
  if (!account || state !== "connected") {
    res.status(409).json(state === "needs_reconnect"
      ? { error: account?.lastError ?? RECONNECT_MESSAGE, code: RECONNECT_CODE }
      : { error: "Connect your Meta account first.", code: NOT_CONNECTED_CODE });
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
  const budgetType = body.budgetType === "lifetime" ? "lifetime" : "daily";
  const schedule = validateMetaSchedule({ startTime: body.startTime, endTime: body.endTime, budgetType });
  if (!schedule.ok) {
    res.status(400).json({ error: schedule.error });
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
      budgetType,
      budgetCents,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      advantagePlus: body.advantagePlus !== false,
      placements: body.placements ?? {},
      targetingSpec: body.targetingSpec ?? {},
      idempotencyKey: randomUUID(),
    })
    .returning();

  // Reach comes from Meta's own delivery estimate via
  // GET /campaigns/:id/reach-estimate — never a budget-only formula.
  res.status(201).json({ campaign: created });
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
      // A live flight keeps its start; only the new end is checked (future,
      // after the start, within the flight cap).
      const schedule = validateMetaSchedule({
        startTime: undefined,
        endTime: body.endTime,
        budgetType: campaign.budgetType,
      });
      if (!schedule.ok) {
        res.status(400).json({ error: schedule.error });
        return;
      }
      if (schedule.endTime && campaign.startTime && schedule.endTime.getTime() <= campaign.startTime.getTime()) {
        res.status(400).json({ error: "End date must be after the start date." });
        return;
      }
      updates.endTime = schedule.endTime;
    }
    if (Object.keys(updates).length === 1) {
      res.json({ campaign });
      return;
    }

    if (campaign.metaAdSetId) {
      const loaded = await requireMarketingTarget(req, res);
      if (!loaded) return;
      try {
        await updateAdSetBudget(loaded.accessToken, campaign.metaAdSetId, {
          dailyBudgetCents: campaign.budgetType === "daily" ? updates.budgetCents : undefined,
          lifetimeBudgetCents: campaign.budgetType === "lifetime" ? updates.budgetCents : undefined,
          endTime: updates.endTime ? updates.endTime.toISOString() : undefined,
        });
      } catch (err) {
        await handleMetaError(req, res, err, "Could not update the campaign on Meta.");
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
  // Same rules as POST /campaigns: a draft must stay launchable.
  if (body.budgetCents !== undefined && (!Number.isInteger(body.budgetCents) || body.budgetCents <= 0)) {
    res.status(400).json({ error: "budgetCents must be a positive whole number" });
    return;
  }
  if (body.budgetType !== undefined && body.budgetType !== "daily" && body.budgetType !== "lifetime") {
    res.status(400).json({ error: "budgetType must be daily or lifetime" });
    return;
  }
  if (body.mediaKind !== undefined && body.mediaKind !== "video" && body.mediaKind !== "photos") {
    res.status(400).json({ error: "mediaKind must be video or photos" });
    return;
  }
  if (body.destinationUrl !== undefined && (typeof body.destinationUrl !== "string" || !body.destinationUrl)) {
    res.status(400).json({ error: "destinationUrl is required" });
    return;
  }
  if (body.mediaObjectPaths !== undefined && !Array.isArray(body.mediaObjectPaths)) {
    res.status(400).json({ error: "mediaObjectPaths must be an array" });
    return;
  }
  const updates: Partial<typeof metaCampaigns.$inferInsert> = { updatedAt: new Date() };
  for (const key of editable) {
    if (body[key] !== undefined) (updates as any)[key] = body[key];
  }
  if (body.startTime !== undefined || body.endTime !== undefined || body.budgetType !== undefined) {
    // Validate the dates the draft will end up with, not just the fields sent.
    const schedule = validateMetaSchedule({
      startTime: body.startTime !== undefined ? body.startTime : campaign.startTime?.toISOString(),
      endTime: body.endTime !== undefined ? body.endTime : campaign.endTime?.toISOString(),
      budgetType: body.budgetType ?? campaign.budgetType,
    });
    if (!schedule.ok) {
      res.status(400).json({ error: schedule.error });
      return;
    }
    updates.startTime = schedule.startTime;
    updates.endTime = schedule.endTime;
  }

  const [updated] = await db
    .update(metaCampaigns)
    .set(updates)
    .where(and(eq(metaCampaigns.id, campaign.id), eq(metaCampaigns.sellerId, owner)))
    .returning();

  res.json({ campaign: updated });
});

// ─── GET /campaigns/:id/reach-estimate ──────────────────────────────────────
// Meta's own reach estimate (the ad account's delivery_estimate edge) for the
// draft's targeting, objective and budget. When there is no connected ad
// account, the server has no Meta credentials, or Meta can't estimate this
// audience, it answers 200 { estimate: { available: false, reason } } so the
// app shows "estimate unavailable" instead of a made-up range.

router.get("/campaigns/:id/reach-estimate", async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const unavailable = (reason: string) => res.json({ estimate: { available: false, reason } });
  const account = await loadConnectedAccount(owner);
  if (!account || connectionState(account) === "not_connected" || connectionState(account) === "pending_selection" || !account.adAccountId) {
    unavailable("Connect a Meta ad account to see Meta's reach estimate.");
    return;
  }
  let sellerToken: string;
  try {
    sellerToken = await getFreshAccessToken(account);
  } catch (err) {
    unavailable(err instanceof MetaReconnectRequiredError ? err.userMessage : "Meta Ads isn't configured on this server yet.");
    return;
  }
  const target = marketingTarget(account, sellerToken);
  if (!target.adAccountId) {
    unavailable("Meta sandbox mode is on but no sandbox ad account is set.");
    return;
  }
  const dailySpendCents = dailySpendCentsFor(campaign);
  try {
    const estimate = await getDeliveryEstimate(target.accessToken, target.adAccountId, {
      targeting: buildTargeting(campaign),
      optimizationGoal: OBJECTIVE_TO_OPTIMIZATION_GOAL[campaign.objective] ?? "LINK_CLICKS",
      dailySpendCents,
    });
    if (!estimate.ready || estimate.dailyReach === null) {
      unavailable("Meta hasn't produced a reach estimate for this audience yet. Try again in a moment.");
      return;
    }
    res.json({
      estimate: {
        available: true,
        source: "meta",
        dailyReach: estimate.dailyReach,
        dailySpendCents,
        audienceSizeLower: estimate.audienceSizeLower,
        audienceSizeUpper: estimate.audienceSizeUpper,
        currency: account.adAccountCurrency ?? null,
      },
    });
  } catch (err) {
    req.log?.warn?.({ err }, "Meta delivery estimate failed");
    if (err instanceof MetaGraphError && err.requiresReconnect) await markNeedsReconnect(account.id);
    unavailable(err instanceof MetaGraphError ? err.userMessage : "Meta's reach estimate is unavailable right now.");
  }
});

router.get("/campaigns/:id/preview", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const loaded = await requireMarketingTarget(req, res);
  if (!loaded) return;
  if (!loaded.account.pageId) {
    res.status(409).json({ error: "Select an ad account and page first." });
    return;
  }

  const creativeSpec: Record<string, unknown> = {
    object_story_spec: {
      page_id: loaded.account.pageId,
      ...(loaded.account.instagramActorId ? { instagram_user_id: loaded.account.instagramActorId } : {}),
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
      loaded.adAccountId,
      creativeSpec,
      (req.query.adFormat as string) || "MOBILE_FEED_STANDARD",
    );
    res.json({ previews });
  } catch (err) {
    await handleMetaError(req, res, err, "Could not build an ad preview.");
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
      if (err.code === RECONNECT_CODE) {
        res.status(409).json({ error: err.userMessage, code: RECONNECT_CODE });
        return;
      }
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
  const loaded = await requireMarketingTarget(req, res);
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
    await handleMetaError(req, res, err, "Could not refresh insights from Meta.");
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
  const loaded = await requireMarketingTarget(req, res);
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
    await handleMetaError(req, res, err, "Could not pause this campaign on Meta.");
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
  const loaded = await requireMarketingTarget(req, res);
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
    await handleMetaError(req, res, err, "Could not resume this campaign on Meta.");
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

// Older app builds post here signed in. The event is credited to the seller
// who owns the product, not the caller (the caller is the buyer — BT-325).
// New builds use the public POST /api/public/meta/conversion-events.
router.post("/conversion-events", express.json({ limit: "8kb" }), async (req, res) => {
  const result = await relayConversionEvent(req.body ?? {}, {
    viewerId: sellerId(req),
    ip: req.ip,
    userAgent: req.headers["user-agent"] as string | undefined,
  }).catch((err) => {
    req.log?.error?.({ err }, "Meta conversion relay failed");
    return { ok: true as const, sellers: [] };
  });
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

// ─── Shared error mapping ───────────────────────────────────────────────────

/**
 * Maps a failed Graph call onto a response the app can branch on. Never
 * answers 401: the app reads 401 as "signed out of Brandthread".
 *   - token expired / revoked (code 190) → row marked needs_reauth, 409 META_RECONNECT_REQUIRED
 *   - Meta rate limit                    → 429
 *   - Meta refused the request (4xx)     → 422 with Meta's plain-English reason
 *   - Meta down / unreachable            → 502
 */
async function handleMetaError(req: express.Request, res: express.Response, err: unknown, fallback: string): Promise<void> {
  if (err instanceof MetaGraphError) {
    req.log?.error?.({ err, metaErrorCode: err.metaErrorCode, metaErrorSubcode: err.metaErrorSubcode }, "Meta Graph API call failed");
    if (err.requiresReconnect) {
      const account = await loadConnectedAccount(sellerId(req)).catch(() => null);
      if (account) await markNeedsReconnect(account.id).catch(() => undefined);
      res.status(409).json({ error: RECONNECT_MESSAGE, code: RECONNECT_CODE });
      return;
    }
    if (err.status === 429 || err.metaErrorCode === 17 || err.metaErrorCode === 80004) {
      res.status(429).json({ error: err.userMessage });
      return;
    }
    if (err.status >= 400 && err.status < 500) {
      res.status(422).json({ error: err.userMessage });
      return;
    }
    res.status(502).json({ error: err.userMessage });
    return;
  }
  req.log?.error?.({ err }, fallback);
  res.status(502).json({ error: fallback });
}

// ─── OAuth redirect target (unauthenticated) ────────────────────────────────
// Meta redirects the seller's browser here with no Brandthread session, so
// this lives outside `router` (which requires auth) and is mounted ahead of
// it in routes/index.ts. It never exchanges the code itself: it checks the
// state signature/TTL and 302s code + state into the app, which completes
// via the authenticated POST /oauth/complete. Always a 302, never JSON.

export const metaAdsOauthCallbackRouter = Router();

metaAdsOauthCallbackRouter.get("/", (req, res) => {
  const { code, state, error, error_reason: errorReason } = req.query as Record<string, string | undefined>;

  if (!state || typeof state !== "string") {
    res.redirect(302, oauthErrorRedirect("Missing OAuth state."));
    return;
  }
  if (!verifyOAuthState(state)) {
    res.redirect(302, oauthErrorRedirect("Your Meta connection request expired — please try again."));
    return;
  }
  if (error) {
    res.redirect(302, oauthErrorRedirect(
      errorReason === "user_denied" || error === "access_denied"
        ? "You cancelled the Meta connection."
        : "Meta declined the connection. Please try again.",
    ));
    return;
  }
  if (!code || typeof code !== "string") {
    res.redirect(302, oauthErrorRedirect("Meta did not return an authorization code."));
    return;
  }
  res.redirect(302, `brandthread://meta-ads-connect?${new URLSearchParams({ oauth: "code", code, state }).toString()}`);
});

export default router;
