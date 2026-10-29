/**
 * Ad Campaign API
 *
 * POST   /api/ad-campaigns                         — create draft
 * GET    /api/ad-campaigns                         — list seller's campaigns
 * GET    /api/ad-campaigns/reach-model             — live reach inputs (CPM + audience) for the sliders
 * GET    /api/ad-campaigns/:id                     — get one (owner only)
 * PATCH  /api/ad-campaigns/:id                     — update draft (pre-payment)
 * DELETE /api/ad-campaigns/:id                     — cancel draft
 * POST   /api/ad-campaigns/:id/media               — upload one media file (raw body)
 * DELETE /api/ad-campaigns/:id/media/:index        — remove a media slot
 * POST   /api/ad-campaigns/:id/reorder-media       — reorder media slots
 * POST   /api/ad-campaigns/:id/pay                 — create (or reuse) Stripe Checkout Session
 * POST   /api/ad-campaigns/:id/pay/verify          — verify payment after redirect; activates idempotently
 * POST   /api/ad-campaigns/:id/pause               — pause an active campaign (stops serving)
 * POST   /api/ad-campaigns/:id/resume              — resume a paused campaign (budget left, before endsAt)
 * POST   /api/ad-campaigns/:id/stop                — stop for good (completed, seller_stopped) + refund the undelivered remainder
 * GET    /api/ad-campaigns/:id/results             — delivered results (impressions, reach, clicks, spend, …)
 *
 * Delivery into buyer feeds lives in routes/ads-serve.ts + lib/ads/.
 *
 * Activation is performed ONLY in two places:
 *   1. /pay/verify endpoint — poll after Checkout redirect, validates payment_status === "paid"
 *   2. Webhook handler     — checkout.session.completed / async_payment_succeeded
 * Never activated on client redirect alone. Never on PaymentIntent events.
 *
 * Budget: the seller sets a DAILY budget and a duration; budgetCents is the
 * TOTAL (daily × days) — what Checkout charges and what delivery paces over
 * the flight. A failed or expired checkout returns the campaign to draft.
 *
 * Reach estimate: lib/ads/reachEstimate.ts — total budget ÷ platform CPM
 * against the real reachable buyer audience, with saturation (soft cap).
 *
 * Refunds: completing with budget left (stopped early, or the flight ended
 * under-delivered) refunds the remainder pro-rata via Stripe (lib/ads/adRefunds.ts).
 */

import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, adCampaigns, products } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { requireStripe, stripe as stripeClient } from "../lib/stripe";
import { ObjectStorageService } from "../lib/objectStorage";
import { acceptUploadSession } from "../lib/uploadSessions";
import { isAllowedBrandthreadCallbackUrl } from "../lib/brandthreadCallbackUrls";
import { rejectNativeStripeCheckout } from "../middlewares/nativeStoreRail";
import { pauseRefusal, resumeRefusal, stopRefusal } from "../lib/ads/adDelivery";
import { adCampaignResults, adResultsSummaries, completeEndedAdCampaigns } from "../lib/ads/adDeliveryService";
import { estimateCampaignReach } from "../lib/ads/reachEstimate";
import { loadReachModel } from "../lib/ads/reachAudience";
import { refundUndeliveredAdBudget, type RefundOutcome } from "../lib/ads/adRefunds";
import { isUuid } from "../lib/uuid";

const router = Router();
router.use(requireAuth);

const storage = new ObjectStorageService();

// ─── Constants ────────────────────────────────────────────────────────────────

export const AD_CAMPAIGN_DAILY_BUDGET_MIN_CENTS = 500;      // $5 / day
export const AD_CAMPAIGN_DAILY_BUDGET_MAX_CENTS = 100_000;  // $1,000 / day
export const AD_CAMPAIGN_DURATION_MIN_DAYS = 1;
export const AD_CAMPAIGN_DURATION_MAX_DAYS = 30;
/** Total (daily × days) bounds */
export const AD_CAMPAIGN_BUDGET_MIN_CENTS  = AD_CAMPAIGN_DAILY_BUDGET_MIN_CENTS;
export const AD_CAMPAIGN_BUDGET_MAX_CENTS  = AD_CAMPAIGN_DAILY_BUDGET_MAX_CENTS * AD_CAMPAIGN_DURATION_MAX_DAYS; // $30,000
export const AD_CAMPAIGN_MAX_PHOTOS        = 5;

/**
 * Reach estimate for a TOTAL budget over `durationDays`, against the live
 * audience model. A planning aid — NEVER reported as delivered impressions.
 */
export async function estimateReach(totalBudgetCents: number, durationDays: number): Promise<{ low: number; high: number }> {
  const { low, high } = estimateCampaignReach({ totalBudgetCents, durationDays, model: await loadReachModel() });
  return { low, high };
}

/** Validate a return URL supplied by the mobile client for Checkout redirect. */
export function isAllowedAdCampaignReturnUrl(value: unknown): value is string {
  return isAllowedBrandthreadCallbackUrl(value, "ad_campaign_checkout");
}

const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic",
]);
const ALLOWED_VIDEO_MIMES = new Set([
  "video/mp4", "video/quicktime", "video/x-msvideo",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;   // 20 MB per photo
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;  // 500 MB for one video
const MAX_VIDEO_DURATION_SECONDS = 60;

const ALLOWED_CTA_KINDS = new Set([
  "shop_now", "learn_more", "view_product", "sign_up", "contact_us",
]);
const ALLOWED_FORMATS = new Set([
  "story_9x16", "square_1x1", "portrait_4x5", "landscape_16x9",
]);

// CTA kinds that require a product destination
const PRODUCT_CTA_KINDS = new Set(["shop_now", "view_product"]);

function sellerId(req: express.Request): string {
  return (req as any).clerkUserId as string;
}

function buildCreativeConfig(
  mediaKind: string,
  mediaObjectPaths: string[],
  formats: string[],
): Record<string, unknown> {
  const formatConfigs: Record<string, { w: number; h: number; ar: string }> = {
    story_9x16:    { w: 1080, h: 1920, ar: "9:16" },
    square_1x1:    { w: 1080, h: 1080, ar: "1:1"  },
    portrait_4x5:  { w: 1080, h: 1350, ar: "4:5"  },
    landscape_16x9:{ w: 1920, h: 1080, ar: "16:9" },
  };
  return {
    mediaKind,
    slideshow: { paths: mediaObjectPaths },
    selectedFormats: formats,
    formatConfigs: Object.fromEntries(
      formats.map((f) => [f, formatConfigs[f] ?? null]),
    ),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findOwnedCampaign(id: string, owner: string) {
  // ad_campaigns.id is a uuid column: a malformed id can never match and must
  // not reach Postgres (the cast error would surface as a 500).
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(adCampaigns)
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.sellerId, owner)))
    .limit(1);
  return row ?? null;
}

// ─── POST /api/ad-campaigns — create draft ────────────────────────────────────

router.post("/", requirePermission("marketing"), express.json({ limit: "32kb" }), async (req, res) => {
  const owner = sellerId(req);
  const draft = await db
    .insert(adCampaigns)
    .values({ sellerId: owner })
    .returning();
  return res.status(201).json({ campaign: draft[0] });
});

// ─── GET /api/ad-campaigns — list ─────────────────────────────────────────────

router.get("/", async (req, res) => {
  const owner = sellerId(req);
  await completeEndedAdCampaigns(new Date(), owner);
  const rows = await db
    .select()
    .from(adCampaigns)
    .where(eq(adCampaigns.sellerId, owner))
    .orderBy(desc(adCampaigns.createdAt))
    .limit(50);

  const [hydrated, summaries] = await Promise.all([
    Promise.all(rows.map(hydrateCampaign)),
    adResultsSummaries(rows),
  ]);
  return res.json({
    campaigns: hydrated.map((c) => ({ ...c, results: summaries.get(c.id) ?? null })),
  });
});

// ─── GET /api/ad-campaigns/reach-model ───────────────────────────────────────
// The inputs of the reach formula, so the app can recompute the estimate live
// while the seller drags the budget/duration sliders (services/adReach.ts).

router.get("/reach-model", async (req, res) => {
  try {
    const model = await loadReachModel();
    return res.json({
      ...model,
      dailyBudgetMinCents: AD_CAMPAIGN_DAILY_BUDGET_MIN_CENTS,
      dailyBudgetMaxCents: AD_CAMPAIGN_DAILY_BUDGET_MAX_CENTS,
      durationMinDays: AD_CAMPAIGN_DURATION_MIN_DAYS,
      durationMaxDays: AD_CAMPAIGN_DURATION_MAX_DAYS,
    });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to load ad reach model");
    return res.status(500).json({ error: "Failed to load reach estimate" });
  }
});

// ─── GET /api/ad-campaigns/:id ────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  return res.json({ campaign: await hydrateCampaign(campaign) });
});

// ─── PATCH /api/ad-campaigns/:id — update draft ───────────────────────────────

router.patch("/:id", requirePermission("marketing"), express.json({ limit: "32kb" }), async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (campaign.status !== "draft" && campaign.status !== "failed") {
    return res.status(409).json({
      error: "Only draft or failed campaigns can be edited",
    });
  }

  const {
    headline, description, ctaKind, ctaDestinationKind, ctaDestinationId,
    formats, budgetCents, dailyBudgetCents, durationDays,
  } = req.body as Record<string, any>;

  // Validate CTA
  if (ctaKind !== undefined && !ALLOWED_CTA_KINDS.has(ctaKind)) {
    return res.status(400).json({
      error: `ctaKind must be one of: ${[...ALLOWED_CTA_KINDS].join(", ")}`,
    });
  }

  // Validate product CTA destination
  if (ctaKind && PRODUCT_CTA_KINDS.has(ctaKind)) {
    if (!ctaDestinationId) {
      return res.status(400).json({
        error: "Product CTAs (shop_now, view_product) require a ctaDestinationId",
      });
    }
    if (!isUuid(ctaDestinationId)) {
      return res.status(422).json({ error: "Product not found or not owned by you" });
    }
    const [prod] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, ctaDestinationId), eq(products.ownerId, owner)))
      .limit(1);
    if (!prod) {
      return res.status(422).json({ error: "Product not found or not owned by you" });
    }
  }

  // Validate formats
  if (formats !== undefined) {
    if (!Array.isArray(formats) || formats.length === 0 || formats.some((f) => !ALLOWED_FORMATS.has(f))) {
      return res.status(400).json({
        error: `formats must be a non-empty array of: ${[...ALLOWED_FORMATS].join(", ")}`,
      });
    }
  }

  // Validate daily budget (preferred: the total becomes daily × days)
  if (dailyBudgetCents !== undefined && dailyBudgetCents !== null) {
    if (!Number.isInteger(dailyBudgetCents) || dailyBudgetCents < AD_CAMPAIGN_DAILY_BUDGET_MIN_CENTS || dailyBudgetCents > AD_CAMPAIGN_DAILY_BUDGET_MAX_CENTS) {
      return res.status(400).json({
        error: `dailyBudgetCents must be a whole number of cents between ${AD_CAMPAIGN_DAILY_BUDGET_MIN_CENTS} and ${AD_CAMPAIGN_DAILY_BUDGET_MAX_CENTS}`,
      });
    }
  }

  // Validate total budget (store purchases are sold in fixed totals)
  if (budgetCents !== undefined) {
    if (!Number.isInteger(budgetCents) || budgetCents < AD_CAMPAIGN_BUDGET_MIN_CENTS || budgetCents > AD_CAMPAIGN_BUDGET_MAX_CENTS) {
      return res.status(400).json({
        error: `budgetCents must be a whole number of cents between ${AD_CAMPAIGN_BUDGET_MIN_CENTS} and ${AD_CAMPAIGN_BUDGET_MAX_CENTS}`,
      });
    }
  }

  // Validate duration
  if (durationDays !== undefined) {
    if (!Number.isInteger(durationDays) || durationDays < AD_CAMPAIGN_DURATION_MIN_DAYS || durationDays > AD_CAMPAIGN_DURATION_MAX_DAYS) {
      return res.status(400).json({
        error: `durationDays must be a whole number between ${AD_CAMPAIGN_DURATION_MIN_DAYS} and ${AD_CAMPAIGN_DURATION_MAX_DAYS}`,
      });
    }
  }

  // The total is always derived server-side when a daily budget is in play:
  // an explicit total (store tier) clears the daily figure; otherwise the
  // stored daily budget follows duration changes.
  const effectiveDuration: number = durationDays ?? campaign.durationDays;
  const effectiveDaily: number | null =
    dailyBudgetCents !== undefined ? dailyBudgetCents
      : budgetCents !== undefined ? null
      : campaign.dailyBudgetCents;
  const effectiveBudget: number = effectiveDaily != null ? effectiveDaily * effectiveDuration : (budgetCents ?? campaign.budgetCents);
  const budgetTouched = dailyBudgetCents !== undefined || budgetCents !== undefined || durationDays !== undefined;
  const reach = budgetTouched ? await estimateReach(effectiveBudget, effectiveDuration) : null;
  const effectiveFormats = formats ?? campaign.formats;

  const updates: Partial<typeof adCampaigns.$inferInsert> = {
    updatedAt: new Date(),
    ...(headline !== undefined      ? { headline }            : {}),
    ...(description !== undefined   ? { description }         : {}),
    ...(ctaKind !== undefined       ? { ctaKind }             : {}),
    ...(ctaDestinationKind !== undefined ? { ctaDestinationKind } : {}),
    ...(ctaDestinationId !== undefined   ? { ctaDestinationId }   : {}),
    ...(formats !== undefined       ? { formats }             : {}),
    ...(reach ? {
      budgetCents:        effectiveBudget,
      dailyBudgetCents:   effectiveDaily,
      estimatedReachLow:  reach.low,
      estimatedReachHigh: reach.high,
    } : {}),
    ...(durationDays !== undefined  ? { durationDays }        : {}),
    creativeConfig: buildCreativeConfig(
      campaign.mediaKind,
      campaign.mediaObjectPaths,
      effectiveFormats as string[],
    ),
  };

  // Still editable at write time: a concurrent /pay may have moved it to
  // pending_payment (Checkout already priced at the old budget) in between.
  const [updated] = await db
    .update(adCampaigns)
    .set(updates)
    .where(and(
      eq(adCampaigns.id, req.params.id),
      eq(adCampaigns.sellerId, owner),
      inArray(adCampaigns.status, ["draft", "failed"]),
    ))
    .returning();
  if (!updated) {
    return res.status(409).json({ error: "Only draft or failed campaigns can be edited" });
  }

  return res.json({ campaign: await hydrateCampaign(updated) });
});

// ─── DELETE /api/ad-campaigns/:id — cancel ────────────────────────────────────

router.delete("/:id", requirePermission("marketing"), async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (campaign.status === "active" || campaign.status === "paused") {
    return res.status(409).json({
      error: "Running campaigns cannot be deleted. Stop them first.",
    });
  }

  await db
    .update(adCampaigns)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(adCampaigns.id, req.params.id), eq(adCampaigns.sellerId, owner)));

  return res.json({ ok: true });
});

// ─── POST /api/ad-campaigns/:id/media — upload one file ───────────────────────

// Direct bodies are capped at the photo limit; larger files (videos) arrive as
// a completed resumable upload session (X-Upload-Id, lib/uploadSessions.ts).
const AD_MEDIA_TYPES = [...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES];
router.post(
  "/:id/media",
  requirePermission("marketing"),
  acceptUploadSession({ allowedTypes: AD_MEDIA_TYPES, maxBytes: MAX_VIDEO_BYTES }),
  express.raw({ type: AD_MEDIA_TYPES, limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (campaign.status !== "draft" && campaign.status !== "failed") {
    return res.status(409).json({ error: "Cannot add media to a non-draft campaign" });
  }

  const mimeType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const durationSecondsHeader = Number(req.headers["x-duration-seconds"] ?? 0);
  const insertAtHeader = req.headers["x-media-index"] !== undefined
    ? Number(req.headers["x-media-index"])
    : null;

  const isVideo = ALLOWED_VIDEO_MIMES.has(mimeType);
  const isImage = ALLOWED_IMAGE_MIMES.has(mimeType);

  if (!isVideo && !isImage) {
    return res.status(400).json({
      error: "Unsupported MIME type. Upload JPEG/PNG/WebP photos or MP4/MOV video.",
    });
  }

  const resolvedKind: "video" | "photos" = isVideo ? "video" : "photos";
  if (campaign.mediaObjectPaths.length > 0 && campaign.mediaKind !== resolvedKind) {
    return res.status(409).json({
      error: `Campaign already has ${campaign.mediaKind}. Cannot mix media types.`,
    });
  }

  if (isVideo) {
    if (campaign.mediaObjectPaths.length > 0) {
      return res.status(409).json({ error: "A video campaign allows exactly one video" });
    }
    if (durationSecondsHeader > MAX_VIDEO_DURATION_SECONDS) {
      return res.status(400).json({
        error: `Video must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter`,
      });
    }
  }

  if (isImage && campaign.mediaObjectPaths.length >= AD_CAMPAIGN_MAX_PHOTOS) {
    return res.status(409).json({
      error: `Photo campaigns support at most ${AD_CAMPAIGN_MAX_PHOTOS} photos`,
    });
  }

  const bytes: Buffer = req.body instanceof Buffer ? req.body : Buffer.from(req.body ?? "");

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (bytes.length === 0) {
    return res.status(400).json({ error: "Request body is empty" });
  }
  if (bytes.length > maxBytes) {
    return res.status(413).json({
      error: `File too large. Maximum: ${Math.round(maxBytes / 1024 / 1024)} MB`,
    });
  }

  const magicValid = validateMagicBytes(bytes, mimeType);
  if (!magicValid) {
    return res.status(400).json({
      error: "File contents do not match declared Content-Type",
    });
  }

  const objectPath = await storage.createObjectEntityFromBuffer(
    bytes,
    mimeType,
    `/objects/ad-campaigns/${campaign.id}/${randomUUID()}`,
  );

  const currentPaths = [...campaign.mediaObjectPaths];
  const currentMimes = [...campaign.mediaMimeTypes];

  const insertAt = (insertAtHeader !== null && Number.isInteger(insertAtHeader) && insertAtHeader >= 0 && insertAtHeader < currentPaths.length)
    ? insertAtHeader
    : currentPaths.length;

  currentPaths.splice(insertAt, 0, objectPath);
  currentMimes.splice(insertAt, 0, mimeType);

  await db
    .update(adCampaigns)
    .set({
      mediaKind: resolvedKind,
      mediaObjectPaths: currentPaths,
      mediaMimeTypes: currentMimes,
      updatedAt: new Date(),
    })
    .where(and(eq(adCampaigns.id, req.params.id), eq(adCampaigns.sellerId, owner)));

  const downloadUrl = await storage.getObjectEntityDownloadURL(objectPath);
  return res.status(201).json({ objectPath, downloadUrl, mimeType, insertedAt: insertAt });
});

// ─── DELETE /api/ad-campaigns/:id/media/:index ───────────────────────────────

router.delete("/:id/media/:index", requirePermission("marketing"), async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (campaign.status !== "draft" && campaign.status !== "failed") {
    return res.status(409).json({ error: "Cannot remove media from a non-draft campaign" });
  }

  const idx = Number(req.params.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= campaign.mediaObjectPaths.length) {
    return res.status(400).json({ error: "Invalid media index" });
  }

  const paths = [...campaign.mediaObjectPaths];
  const mimes = [...campaign.mediaMimeTypes];
  paths.splice(idx, 1);
  mimes.splice(idx, 1);

  await db
    .update(adCampaigns)
    .set({
      mediaObjectPaths: paths,
      mediaMimeTypes: mimes,
      mediaKind: paths.length === 0 ? "photos" : campaign.mediaKind,
      updatedAt: new Date(),
    })
    .where(and(eq(adCampaigns.id, req.params.id), eq(adCampaigns.sellerId, owner)));

  return res.json({ ok: true, mediaCount: paths.length });
});

// ─── POST /api/ad-campaigns/:id/reorder-media ────────────────────────────────

router.post("/:id/reorder-media", requirePermission("marketing"), express.json({ limit: "4kb" }), async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (campaign.status !== "draft" && campaign.status !== "failed") {
    return res.status(409).json({ error: "Cannot reorder media in a non-draft campaign" });
  }

  const { order } = req.body as { order?: unknown };
  const n = campaign.mediaObjectPaths.length;

  if (!Array.isArray(order) || order.length !== n ||
      !order.every((i): i is number => Number.isInteger(i) && i >= 0 && i < n) ||
      new Set(order).size !== n) {
    return res.status(400).json({ error: "order must be a valid permutation of current media indices" });
  }

  const newPaths = (order as number[]).map((i) => campaign.mediaObjectPaths[i]);
  const newMimes = (order as number[]).map((i) => campaign.mediaMimeTypes[i]);

  await db
    .update(adCampaigns)
    .set({ mediaObjectPaths: newPaths, mediaMimeTypes: newMimes, updatedAt: new Date() })
    .where(and(eq(adCampaigns.id, req.params.id), eq(adCampaigns.sellerId, owner)));

  return res.json({ ok: true });
});

// ─── POST /api/ad-campaigns/:id/pay — create or reuse Stripe Checkout Session ─
// Body: { returnUrl: string }
//   returnUrl must satisfy isAllowedAdCampaignReturnUrl.
//   Stripe appends ?checkout_session_id={CHECKOUT_SESSION_ID} on success.
//   A still-open session is reused so retries never create duplicate charges.
//   Campaign stays pending_payment until /pay/verify or webhook confirms paid.

router.post("/:id/pay", requirePermission("marketing"), rejectNativeStripeCheckout, express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const owner = sellerId(req);
    const campaign = await findOwnedCampaign(req.params.id, owner);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    if (campaign.status === "active") {
      return res.status(409).json({ error: "Campaign is already active", code: "already_active" });
    }
    if (campaign.status !== "draft" && campaign.status !== "failed" && campaign.status !== "pending_payment") {
      return res.status(409).json({ error: `Campaign cannot be paid in status: ${campaign.status}` });
    }

    // Validate returnUrl first (client contract) — before campaign-readiness checks
    const { returnUrl } = req.body as { returnUrl?: unknown };
    if (!isAllowedAdCampaignReturnUrl(returnUrl)) {
      return res.status(400).json({
        error: "returnUrl must be an allowed Brandthread ad-campaign callback URL",
      });
    }

    // Validate campaign is ready to pay
    if (campaign.mediaObjectPaths.length === 0) {
      return res.status(422).json({ error: "Upload at least one media file before paying" });
    }
    if (!campaign.formats || (campaign.formats as string[]).length === 0) {
      return res.status(422).json({ error: "Select at least one ad format before paying" });
    }
    if (!campaign.ctaKind) {
      return res.status(422).json({ error: "Select a call-to-action before paying" });
    }
    if (!campaign.budgetCents || campaign.budgetCents < AD_CAMPAIGN_BUDGET_MIN_CENTS || campaign.budgetCents > AD_CAMPAIGN_BUDGET_MAX_CENTS) {
      return res.status(422).json({ error: "Set a valid budget before paying" });
    }

    const stripe = requireStripe();

    // ── Reuse still-open session (prevents duplicate charges on retry) ─────
    let checkoutSessionVersion = campaign.checkoutSessionVersion;

    if (campaign.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(campaign.stripeCheckoutSessionId);
      if (
        existing.payment_status === "paid"
        || existing.status === "complete"
        || existing.status === "open"
      ) {
        // Paid/complete: redirect to already-paid; client should call /verify.
        // Open: redirect user to pay.
        return res.json({
          sessionId: existing.id,
          url: existing.url,
          paymentStatus: existing.payment_status,
          status: campaign.status,
        });
      }

      // Expired session: atomically detach so we can create a replacement.
      const [rotated] = await db
        .update(adCampaigns)
        .set({
          stripeCheckoutSessionId: null,
          checkoutSessionVersion: sql`${adCampaigns.checkoutSessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(adCampaigns.id, campaign.id),
            eq(adCampaigns.stripeCheckoutSessionId, campaign.stripeCheckoutSessionId),
          ),
        )
        .returning({ checkoutSessionVersion: adCampaigns.checkoutSessionVersion });

      if (rotated) {
        checkoutSessionVersion = rotated.checkoutSessionVersion;
      } else {
        // Another request won the rotation race — re-read and return their session.
        const [current] = await db
          .select({ stripeCheckoutSessionId: adCampaigns.stripeCheckoutSessionId })
          .from(adCampaigns)
          .where(eq(adCampaigns.id, campaign.id))
          .limit(1);
        if (current?.stripeCheckoutSessionId) {
          const replacement = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
          return res.json({
            sessionId: replacement.id,
            url: replacement.url,
            paymentStatus: replacement.payment_status,
            status: campaign.status,
          });
        }
      }
    }

    // ── Create new Checkout Session ────────────────────────────────────────
    const budgetDollars = (campaign.budgetCents / 100).toFixed(2);
    const budgetLine = campaign.dailyBudgetCents
      ? `$${(campaign.dailyBudgetCents / 100).toFixed(2)}/day × ${campaign.durationDays} days = $${budgetDollars}`
      : `${campaign.durationDays}-day ad · $${budgetDollars} budget`;
    const productName = campaign.headline
      ? `Brandthread ad · ${campaign.headline}`
      : `Brandthread ad campaign`;

    const successUrl = returnUrl.includes("?")
      ? `${returnUrl}&checkout_session_id={CHECKOUT_SESSION_ID}`
      : `${returnUrl}?checkout_session_id={CHECKOUT_SESSION_ID}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: campaign.budgetCents,
              product_data: {
                name: productName,
                description: `${budgetLine}. Delivered gradually over the campaign; any undelivered budget is refunded.`,
              },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: returnUrl,
        metadata: {
          kind:           "ad_campaign",
          adCampaignId:  campaign.id,
          sellerId:       owner,
        },
        payment_intent_data: {
          metadata: { kind: "ad_campaign", adCampaignId: campaign.id, sellerId: owner },
        },
      },
      {
        idempotencyKey: `ad-campaign-checkout/${campaign.id}/v${checkoutSessionVersion}`,
      },
    );

    // Persist session ID + transition to pending_payment.
    // Race-safe: only updates if no other session was persisted first, and
    // only while the budget/duration are still the ones this session charges
    // (a concurrent PATCH must not leave a bigger budget behind a smaller charge).
    const [persisted] = await db
      .update(adCampaigns)
      .set({
        status:                  "pending_payment",
        stripeCheckoutSessionId: session.id,
        updatedAt:               new Date(),
      })
      .where(
        and(
          eq(adCampaigns.id, campaign.id),
          eq(adCampaigns.sellerId, owner),
          sql`${adCampaigns.stripeCheckoutSessionId} IS NULL`,
          eq(adCampaigns.checkoutSessionVersion, checkoutSessionVersion),
          inArray(adCampaigns.status, ["draft", "failed", "pending_payment"]),
          eq(adCampaigns.budgetCents, campaign.budgetCents),
          eq(adCampaigns.durationDays, campaign.durationDays),
        ),
      )
      .returning({ stripeCheckoutSessionId: adCampaigns.stripeCheckoutSessionId });

    if (persisted) {
      return res.status(201).json({
        sessionId: session.id,
        url: session.url,
        paymentStatus: session.payment_status,
        status: "pending_payment",
      });
    }

    // Race: another request persisted a different session — return theirs.
    const [current] = await db
      .select({ stripeCheckoutSessionId: adCampaigns.stripeCheckoutSessionId })
      .from(adCampaigns)
      .where(eq(adCampaigns.id, campaign.id))
      .limit(1);
    if (current?.stripeCheckoutSessionId) {
      const replacement = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
      return res.json({
        sessionId: replacement.id,
        url: replacement.url,
        paymentStatus: replacement.payment_status,
        status: "pending_payment",
      });
    }

    // The campaign changed (e.g. its budget) while this session was being
    // created: retire the session (its URL was never handed out) and bump the
    // version so the retry gets a fresh session at the current price instead
    // of the idempotent replay of this one.
    try { await stripe.checkout.sessions.expire(session.id); } catch { /* best effort */ }
    await db
      .update(adCampaigns)
      .set({ checkoutSessionVersion: sql`${adCampaigns.checkoutSessionVersion} + 1`, updatedAt: new Date() })
      .where(and(
        eq(adCampaigns.id, campaign.id),
        eq(adCampaigns.checkoutSessionVersion, checkoutSessionVersion),
        sql`${adCampaigns.stripeCheckoutSessionId} IS NULL`,
      ));
    return res.status(409).json({ error: "Checkout session changed; retry", code: "campaign_changed" });
  } catch (err) {
    req.log?.error?.({ err, campaignId: req.params.id }, "Failed to create ad campaign Checkout Session");
    return res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
});

// ─── POST /api/ad-campaigns/:id/pay/verify — confirm payment after redirect ───
// Called by the mobile client after the browser returns from Stripe Checkout.
// Validates ownership + metadata, checks payment_status === "paid",
// and activates the campaign idempotently.
// NEVER activates on client redirect alone — only after server-verified payment_status.

router.post("/:id/pay/verify", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const owner = sellerId(req);
    const campaign = await findOwnedCampaign(req.params.id, owner);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    // Already active (webhook or earlier verify call won the race) — idempotent
    if (campaign.status === "active") {
      return res.json({ campaign: await hydrateCampaign(campaign) });
    }

    if (!campaign.stripeCheckoutSessionId) {
      return res.status(409).json({
        error: "No checkout session found for this campaign. Start payment first.",
        code:  "no_session",
      });
    }

    const stripe = requireStripe();
    const session = await stripe.checkout.sessions.retrieve(campaign.stripeCheckoutSessionId);

    // Validate metadata to prevent cross-campaign tampering
    if (
      session.metadata?.kind !== "ad_campaign"
      || session.metadata?.adCampaignId !== campaign.id
      || session.metadata?.sellerId !== owner
    ) {
      return res.status(403).json({ error: "Session metadata does not match campaign", code: "metadata_mismatch" });
    }

    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      // An expired checkout can never complete: the campaign goes back to draft.
      if (session.status === "expired") await returnCampaignToDraft(session.id);
      return res.status(402).json({
        error: "Payment has not been completed",
        paymentStatus: session.payment_status,
        code: "unpaid",
      });
    }

    // Activate idempotently
    const paidAt = new Date();
    const activated = await activateAdCampaignBySessionId(session, paidAt);
    const result = activated ?? campaign;
    return res.json({ campaign: await hydrateCampaign(result) });
  } catch (err) {
    req.log?.error?.({ err, campaignId: req.params.id }, "Failed to verify ad campaign payment");
    return res.status(500).json({ error: "Failed to verify payment. Please try again." });
  }
});

// ─── Delivery lifecycle: pause / resume / stop ───────────────────────────────

const LIFECYCLE_MESSAGES: Record<string, string> = {
  not_active: "Only running campaigns can be changed",
  not_paused: "Only paused campaigns can be resumed",
  budget_spent: "This campaign has spent its budget",
  ended: "This campaign has reached its end date",
  already_completed: "This campaign has already completed",
};

router.post("/:id/pause", requirePermission("marketing"), async (req, res) => {
  const owner = sellerId(req);
  const now = new Date();
  await completeEndedAdCampaigns(now, owner);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  const refusal = pauseRefusal(campaign);
  if (refusal) return res.status(409).json({ error: LIFECYCLE_MESSAGES[refusal], code: refusal });
  const [updated] = await db.update(adCampaigns)
    .set({ status: "paused", pausedAt: now, updatedAt: now })
    .where(and(eq(adCampaigns.id, campaign.id), eq(adCampaigns.sellerId, owner), eq(adCampaigns.status, "active")))
    .returning();
  if (!updated) return res.status(409).json({ error: "Campaign changed; refresh and try again", code: "conflict" });
  return res.json({ campaign: await hydrateCampaign(updated) });
});

router.post("/:id/resume", requirePermission("marketing"), async (req, res) => {
  const owner = sellerId(req);
  const now = new Date();
  await completeEndedAdCampaigns(now, owner);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  const refusal = resumeRefusal(campaign, now);
  if (refusal) return res.status(409).json({ error: LIFECYCLE_MESSAGES[refusal], code: refusal });
  const [updated] = await db.update(adCampaigns)
    .set({ status: "active", pausedAt: null, updatedAt: now })
    .where(and(
      eq(adCampaigns.id, campaign.id), eq(adCampaigns.sellerId, owner), eq(adCampaigns.status, "paused"),
      sql`${adCampaigns.endsAt} > ${now}`,
    ))
    .returning();
  if (!updated) return res.status(409).json({ error: "Campaign changed; refresh and try again", code: "conflict" });
  return res.json({ campaign: await hydrateCampaign(updated) });
});

router.post("/:id/stop", requirePermission("marketing"), async (req, res) => {
  const owner = sellerId(req);
  const now = new Date();
  await completeEndedAdCampaigns(now, owner);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  const refusal = stopRefusal(campaign);
  if (refusal) return res.status(409).json({ error: LIFECYCLE_MESSAGES[refusal], code: refusal });
  const [updated] = await db.update(adCampaigns)
    .set({ status: "completed", completionReason: "seller_stopped", completedAt: now, pausedAt: null, updatedAt: now })
    .where(and(
      eq(adCampaigns.id, campaign.id), eq(adCampaigns.sellerId, owner),
      sql`${adCampaigns.status} IN ('active', 'paused')`,
    ))
    .returning();
  if (!updated) return res.status(409).json({ error: "Campaign changed; refresh and try again", code: "conflict" });
  // Cancelled early: give back what was never delivered (pro-rata, via Stripe).
  // A failure here doesn't undo the stop — the lifecycle sweep retries it.
  let refund: RefundOutcome | null = null;
  if (updated.paymentRail === "stripe" && stripeClient) {
    refund = await refundUndeliveredAdBudget(updated.id, stripeClient, now);
    if (refund.status === "failed") req.log?.warn?.({ campaignId: updated.id, error: refund.error }, "Ad campaign refund failed; will retry");
  }
  const [fresh] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, updated.id)).limit(1);
  return res.json({ campaign: await hydrateCampaign(fresh ?? updated), refund });
});

// ─── GET /api/ad-campaigns/:id/results ───────────────────────────────────────

router.get("/:id/results", async (req, res) => {
  const owner = sellerId(req);
  const now = new Date();
  await completeEndedAdCampaigns(now, owner);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  try {
    const results = await adCampaignResults(campaign, now);
    return res.json({ campaign: await hydrateCampaign(campaign), results });
  } catch (err) {
    req.log?.error?.({ err, campaignId: campaign.id }, "Failed to load ad campaign results");
    return res.status(500).json({ error: "Failed to load results" });
  }
});

// ─── Hydration helper ─────────────────────────────────────────────────────────

async function hydrateCampaign(campaign: typeof adCampaigns.$inferSelect) {
  const mediaUrls = await Promise.all(
    campaign.mediaObjectPaths.map((p) => storage.getObjectEntityDownloadURL(p)),
  );
  return {
    ...campaign,
    mediaUrls,
    estimatedReach: {
      low:   campaign.estimatedReachLow,
      high:  campaign.estimatedReachHigh,
      label: "estimate" as const,
    },
  };
}

// ─── Internal: activate campaign by Checkout Session ID ───────────────────────

type PaidCheckoutSession = {
  id: string;
  amount_total?: number | null;
  payment_intent?: string | { id: string } | null;
};

async function activateAdCampaignBySessionId(
  session: PaidCheckoutSession,
  paidAt: Date,
): Promise<typeof adCampaigns.$inferSelect | null> {
  const checkoutSessionId = session.id;
  const [campaign] = await db
    .select()
    .from(adCampaigns)
    .where(eq(adCampaigns.stripeCheckoutSessionId, checkoutSessionId))
    .limit(1);

  if (!campaign) return null;
  if (campaign.status === "active") return campaign; // already activated (idempotent)
  if (campaign.status !== "pending_payment") return campaign;

  const startsAt = paidAt;
  const endsAt   = new Date(paidAt.getTime() + campaign.durationDays * 86_400_000);
  const reach    = await estimateReach(campaign.budgetCents, campaign.durationDays);
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

  const [updated] = await db
    .update(adCampaigns)
    .set({
      status:             "active",
      paidAt,
      startsAt,
      endsAt,
      estimatedReachLow:  reach.low,
      estimatedReachHigh: reach.high,
      paymentRail:        "stripe",
      paidAmountCents:    session.amount_total ?? campaign.budgetCents,
      stripePaymentIntentId: paymentIntentId,
      updatedAt:          new Date(),
    })
    .where(
      and(
        eq(adCampaigns.stripeCheckoutSessionId, checkoutSessionId),
        eq(adCampaigns.status, "pending_payment"),
      ),
    )
    .returning();

  return updated ?? campaign;
}

// ─── Magic-byte MIME validation ───────────────────────────────────────────────

function validateMagicBytes(bytes: Buffer, mime: string): boolean {
  if (bytes.length < 4) return false;
  const b = bytes;
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }
  if (mime === "image/png") {
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  }
  if (mime === "image/webp") {
    return b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP";
  }
  if (mime === "image/heic") {
    return bytes.length >= 12 && b.toString("ascii", 4, 8) === "ftyp";
  }
  if (mime === "video/mp4" || mime === "video/quicktime") {
    if (b.length >= 8 && b.toString("ascii", 4, 8) === "ftyp") return true;
    if (b.length >= 8 && b.toString("ascii", 4, 8) === "mdat") return true;
    return false;
  }
  if (mime === "video/x-msvideo") {
    return b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "AVI ";
  }
  return false;
}

export default router;

// ─── Webhook activation helpers (called from webhooks.ts) ─────────────────────
// Called when checkout.session.completed / async_payment_succeeded fires
// with metadata.kind === 'ad_campaign'.

export async function activateAdCampaignFromCheckoutSession(
  session: PaidCheckoutSession & { payment_status: string; metadata?: Record<string, string> | null },
  paidAt: Date,
): Promise<void> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
  if (session.metadata?.kind !== "ad_campaign") return;
  await activateAdCampaignBySessionId(session, paidAt);
}

/**
 * Failed or expired payment: the campaign stays a draft the seller can edit
 * and pay again. The dead session is detached (and the version bumped) so the
 * next /pay creates a fresh Checkout Session rather than reusing this one.
 */
async function returnCampaignToDraft(checkoutSessionId: string): Promise<void> {
  await db
    .update(adCampaigns)
    .set({
      status: "draft",
      stripeCheckoutSessionId: null,
      checkoutSessionVersion: sql`${adCampaigns.checkoutSessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(adCampaigns.stripeCheckoutSessionId, checkoutSessionId),
        eq(adCampaigns.status, "pending_payment"),
      ),
    );
}

export async function markAdCampaignCheckoutFailed(
  session: { id: string; metadata?: Record<string, string> | null },
): Promise<void> {
  if (session.metadata?.kind !== "ad_campaign") return;
  await returnCampaignToDraft(session.id);
}

// Kept for backwards-compat if old PI events arrive; no-ops for ad campaigns
// since we no longer create PaymentIntents directly for ad campaigns.
export async function activateAdCampaignFromPaymentIntent(
  _paymentIntentId: string,
  _paidAt: Date,
): Promise<void> {
  // No-op: ad campaigns now use Checkout Sessions exclusively.
  // PaymentIntent events are handled by the Checkout Session webhooks.
}

export async function markAdCampaignPaymentFailed(
  _paymentIntentId: string,
): Promise<void> {
  // No-op: ad campaigns now use Checkout Sessions exclusively.
}
