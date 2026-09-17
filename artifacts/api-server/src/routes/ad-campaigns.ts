/**
 * Ad Campaign API
 *
 * POST   /api/ad-campaigns                         — create draft
 * GET    /api/ad-campaigns                         — list seller's campaigns
 * GET    /api/ad-campaigns/:id                     — get one (owner only)
 * PATCH  /api/ad-campaigns/:id                     — update draft (pre-payment)
 * DELETE /api/ad-campaigns/:id                     — cancel draft
 * POST   /api/ad-campaigns/:id/media               — upload one media file (raw body)
 * DELETE /api/ad-campaigns/:id/media/:index        — remove a media slot
 * POST   /api/ad-campaigns/:id/reorder-media       — reorder media slots
 * POST   /api/ad-campaigns/:id/pay                 — create (or reuse) Stripe Checkout Session
 * POST   /api/ad-campaigns/:id/pay/verify          — verify payment after redirect; activates idempotently
 *
 * Activation is performed ONLY in two places:
 *   1. /pay/verify endpoint — poll after Checkout redirect, validates payment_status === "paid"
 *   2. Webhook handler     — checkout.session.completed / async_payment_succeeded
 * Never activated on client redirect alone. Never on PaymentIntent events.
 *
 * Reach estimate formula (shared, documented):
 *   low  = floor(budgetCents / 100 * 35)   // ~35 impressions per $1
 *   high = floor(budgetCents / 100 * 65)   // ~65 impressions per $1
 */

import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, adCampaigns, products } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";
import { ObjectStorageService } from "../lib/objectStorage";
import { isAllowedBrandthreadCallbackUrl } from "../lib/brandthreadCallbackUrls";

const router = Router();
router.use(requireAuth);

const storage = new ObjectStorageService();

// ─── Constants ────────────────────────────────────────────────────────────────

export const AD_CAMPAIGN_BUDGET_MIN_CENTS  = 500;      // $5
export const AD_CAMPAIGN_BUDGET_MAX_CENTS  = 100_000;  // $1000
export const AD_CAMPAIGN_DURATION_MIN_DAYS = 1;
export const AD_CAMPAIGN_DURATION_MAX_DAYS = 30;
export const AD_CAMPAIGN_MAX_PHOTOS        = 5;

/**
 * Shared reach estimate formula. Called from route and exposed so the mobile
 * client can display an identical live preview while sliding.
 *
 * Formula:  low = floor(budgetCents/100 * 35)
 *           high = floor(budgetCents/100 * 65)
 *
 * This estimate is a planning aid and is NEVER reported as delivered impressions.
 */
export function estimateReach(budgetCents: number): { low: number; high: number } {
  const dollars = budgetCents / 100;
  return {
    low:  Math.floor(dollars * 35),
    high: Math.floor(dollars * 65),
  };
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
  const [row] = await db
    .select()
    .from(adCampaigns)
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.sellerId, owner)))
    .limit(1);
  return row ?? null;
}

// ─── POST /api/ad-campaigns — create draft ────────────────────────────────────

router.post("/", express.json({ limit: "32kb" }), async (req, res) => {
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
  const rows = await db
    .select()
    .from(adCampaigns)
    .where(eq(adCampaigns.sellerId, owner))
    .orderBy(desc(adCampaigns.createdAt))
    .limit(50);

  const hydrated = await Promise.all(rows.map(hydrateCampaign));
  return res.json({ campaigns: hydrated });
});

// ─── GET /api/ad-campaigns/:id ────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const campaign = await findOwnedCampaign(req.params.id, sellerId(req));
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  return res.json({ campaign: await hydrateCampaign(campaign) });
});

// ─── PATCH /api/ad-campaigns/:id — update draft ───────────────────────────────

router.patch("/:id", express.json({ limit: "32kb" }), async (req, res) => {
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
    formats, budgetCents, durationDays,
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

  // Validate budget
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

  const effectiveBudget = budgetCents ?? campaign.budgetCents;
  const reach = estimateReach(effectiveBudget);
  const effectiveFormats = formats ?? campaign.formats;

  const updates: Partial<typeof adCampaigns.$inferInsert> = {
    updatedAt: new Date(),
    ...(headline !== undefined      ? { headline }            : {}),
    ...(description !== undefined   ? { description }         : {}),
    ...(ctaKind !== undefined       ? { ctaKind }             : {}),
    ...(ctaDestinationKind !== undefined ? { ctaDestinationKind } : {}),
    ...(ctaDestinationId !== undefined   ? { ctaDestinationId }   : {}),
    ...(formats !== undefined       ? { formats }             : {}),
    ...(budgetCents !== undefined   ? {
      budgetCents,
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

  const [updated] = await db
    .update(adCampaigns)
    .set(updates)
    .where(and(eq(adCampaigns.id, req.params.id), eq(adCampaigns.sellerId, owner)))
    .returning();

  return res.json({ campaign: await hydrateCampaign(updated) });
});

// ─── DELETE /api/ad-campaigns/:id — cancel ────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const owner = sellerId(req);
  const campaign = await findOwnedCampaign(req.params.id, owner);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (campaign.status === "active") {
    return res.status(409).json({
      error: "Active campaigns cannot be deleted. Pause or cancel them first.",
    });
  }

  await db
    .update(adCampaigns)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(adCampaigns.id, req.params.id), eq(adCampaigns.sellerId, owner)));

  return res.json({ ok: true });
});

// ─── POST /api/ad-campaigns/:id/media — upload one file ───────────────────────

router.post("/:id/media", async (req, res) => {
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

router.delete("/:id/media/:index", async (req, res) => {
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

router.post("/:id/reorder-media", express.json({ limit: "4kb" }), async (req, res) => {
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

router.post("/:id/pay", express.json({ limit: "4kb" }), async (req, res) => {
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
    if (!campaign.budgetCents || campaign.budgetCents < AD_CAMPAIGN_BUDGET_MIN_CENTS) {
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
                description: `${campaign.durationDays}-day ad · $${budgetDollars} budget · ${(campaign.formats as string[]).join(", ")}`,
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
      },
      {
        idempotencyKey: `ad-campaign-checkout/${campaign.id}/v${checkoutSessionVersion}`,
      },
    );

    // Persist session ID + transition to pending_payment.
    // Race-safe: only updates if no other session was persisted first.
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

    return res.status(409).json({ error: "Checkout session changed; retry" });
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
      return res.status(402).json({
        error: "Payment has not been completed",
        paymentStatus: session.payment_status,
        code: "unpaid",
      });
    }

    // Activate idempotently
    const paidAt = new Date();
    const activated = await activateAdCampaignBySessionId(
      campaign.stripeCheckoutSessionId,
      paidAt,
    );
    const result = activated ?? campaign;
    return res.json({ campaign: await hydrateCampaign(result) });
  } catch (err) {
    req.log?.error?.({ err, campaignId: req.params.id }, "Failed to verify ad campaign payment");
    return res.status(500).json({ error: "Failed to verify payment. Please try again." });
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

async function activateAdCampaignBySessionId(
  checkoutSessionId: string,
  paidAt: Date,
): Promise<typeof adCampaigns.$inferSelect | null> {
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
  const reach    = estimateReach(campaign.budgetCents);

  const [updated] = await db
    .update(adCampaigns)
    .set({
      status:             "active",
      paidAt,
      startsAt,
      endsAt,
      estimatedReachLow:  reach.low,
      estimatedReachHigh: reach.high,
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
  session: { id: string; payment_status: string; metadata?: Record<string, string> | null },
  paidAt: Date,
): Promise<void> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
  if (session.metadata?.kind !== "ad_campaign") return;
  await activateAdCampaignBySessionId(session.id, paidAt);
}

export async function markAdCampaignCheckoutFailed(
  session: { id: string; metadata?: Record<string, string> | null },
): Promise<void> {
  if (session.metadata?.kind !== "ad_campaign") return;
  await db
    .update(adCampaigns)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(adCampaigns.stripeCheckoutSessionId, session.id),
        eq(adCampaigns.status, "pending_payment"),
      ),
    );
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
