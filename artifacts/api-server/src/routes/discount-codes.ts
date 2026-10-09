import { Router } from "express";
import { db, discountCodes, discountCodeUses, liveStreams, products, shopifyImportCollections } from "@workspace/db";
import { broadcastToRoom } from "../ws/liveHub";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "@workspace/api-zod";
import { bodyObject, cents, dateLike, idParams, validateInput } from "../lib/commerceValidation";
import { requirePermission } from "../middlewares/requireRole";
import { validateDiscountCode, DiscountValidationError } from "../lib/discounts";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ["percentage", "fixed", "free_shipping", "free_item"] as const;
const VALID_APPLIES_TO = ["entire_store", "specific_products", "collections"] as const;

/** Validates the newer optional rules shared by create + update; returns an error message or null. */
async function validateExtensions(sellerId: string, v: {
  appliesTo?: string; collectionIds?: unknown; maxUsesPerCustomer?: unknown; minQuantity?: unknown;
}): Promise<string | null> {
  if (v.appliesTo === "collections") {
    const ids = Array.isArray(v.collectionIds) ? v.collectionIds.filter((id): id is string => typeof id === "string") : [];
    if (ids.length === 0) return "collectionIds must be a non-empty array when appliesTo is collections";
    const owned = await db
      .select({ id: shopifyImportCollections.id })
      .from(shopifyImportCollections)
      .where(and(eq(shopifyImportCollections.ownerId, sellerId), inArray(shopifyImportCollections.id, ids)));
    if (owned.length !== ids.length) return "One or more collectionIds don't belong to this store";
  }
  if (v.maxUsesPerCustomer != null && (!Number.isInteger(v.maxUsesPerCustomer) || (v.maxUsesPerCustomer as number) < 1)) {
    return "maxUsesPerCustomer must be a whole number of at least 1";
  }
  if (v.minQuantity != null && (!Number.isInteger(v.minQuantity) || (v.minQuantity as number) < 0)) {
    return "minQuantity must be a whole number of 0 or more";
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Request schemas ──────────────────────────────────────────────────────────
// Type/size guards; the handlers keep the type-specific value rules, the
// product/collection/live-stream ownership checks and their messages.
const discountIdParams = idParams("id");
const discountFields = {
  code: z.string().max(64).nullish(),
  type: z.string().max(40).optional(),
  // Percent (1–100) or a fixed amount; never negative.
  value: z.number().finite().min(0).max(100_000_000).nullish(),
  minOrderCents: cents.nullish(),
  appliesTo: z.string().max(40).nullish(),
  productIds: z.array(z.string().max(160)).max(1_000).nullish(),
  collectionIds: z.array(z.string().max(160)).max(1_000).nullish(),
  maxUses: z.number().int().min(0).max(100_000_000).nullish(),
  maxUsesPerCustomer: z.number().finite().max(100_000_000).nullish(),
  minQuantity: z.number().finite().max(100_000).nullish(),
  oneUsePerCustomer: z.boolean().nullish(),
  singleUse: z.boolean().nullish(),
  firstOrderOnly: z.boolean().nullish(),
  startsAt: dateLike.nullish(),
  expiresAt: dateLike.nullish(),
  liveStreamId: z.string().max(160).nullish(),
};
const createDiscountBody = bodyObject(discountFields);
const updateDiscountBody = bodyObject({ ...discountFields, active: z.boolean().nullish() });

/** What a viewer may see of a live-only code (shared in the live, so the code itself is public to viewers). */
export function toLiveCodePublic(code: typeof discountCodes.$inferSelect) {
  return {
    id: code.id,
    code: code.code,
    type: code.type,
    value: Number(code.value),
    minOrderCents: code.minOrderCents,
    expiresAt: code.expiresAt ? code.expiresAt.toISOString() : null,
  };
}

function randomCode(): string {
  // Unambiguous alphabet (no 0/O/1/I) — easy to read back over the phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

/** Live status for the seller's discount list — computed, never stored. */
function statusOf(code: typeof discountCodes.$inferSelect, now = new Date()): string {
  if (!code.active) return "paused";
  if (code.startsAt && code.startsAt.getTime() > now.getTime()) return "scheduled";
  if (code.expiresAt && code.expiresAt.getTime() <= now.getTime()) return "expired";
  if (code.maxUses != null && code.usesCount >= code.maxUses) return "exhausted";
  return "active";
}

function decorate(code: typeof discountCodes.$inferSelect) {
  return { ...code, status: statusOf(code) };
}

// ─── Seller Endpoints ─────────────────────────────────────────────────────────

// GET / — list all discount codes for the authenticated seller
router.get("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const codes = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.sellerId, sellerId));
    res.json(codes.map(decorate));
  } catch (err) {
    req.log.error({ err }, "Failed to list discount codes");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /collections — the seller's collections, for the "applies to" picker
router.get("/collections", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const rows = await db
      .select({ id: shopifyImportCollections.id, title: shopifyImportCollections.title })
      .from(shopifyImportCollections)
      .where(eq(shopifyImportCollections.ownerId, sellerId));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list collections for discount codes");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST / — create a new discount code
router.post("/", requirePermission("marketing"), validateInput({ body: createDiscountBody }), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const {
      code,
      type,
      value,
      minOrderCents,
      appliesTo,
      productIds,
      maxUses,
      oneUsePerCustomer,
      singleUse,
      startsAt,
      expiresAt,
      firstOrderOnly,
      collectionIds,
      maxUsesPerCustomer,
      minQuantity,
      liveStreamId,
    } = req.body as {
      firstOrderOnly?: boolean;
      collectionIds?: string[];
      maxUsesPerCustomer?: number | null;
      minQuantity?: number;
      code?: string;
      type?: string;
      value?: number;
      minOrderCents?: number;
      appliesTo?: string;
      productIds?: string[];
      maxUses?: number | null;
      oneUsePerCustomer?: boolean;
      singleUse?: boolean;
      startsAt?: string | null;
      expiresAt?: string | null;
      liveStreamId?: string | null;
    };

    if (!VALID_TYPES.includes(type as any)) {
      res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
      return;
    }
    if (type === "percentage") {
      const pct = Number(value);
      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
        res.status(400).json({ error: "value must be between 1 and 100 for percentage codes" });
        return;
      }
    }
    if (type === "fixed") {
      const amt = Number(value);
      if (!Number.isFinite(amt) || amt <= 0) {
        res.status(400).json({ error: "value must be greater than 0 for fixed codes" });
        return;
      }
    }
    const scope = appliesTo && VALID_APPLIES_TO.includes(appliesTo as any) ? appliesTo : "entire_store";
    const scopedProductIds = Array.isArray(productIds) ? productIds.filter((id) => typeof id === "string") : [];
    if (scope === "specific_products" && scopedProductIds.length === 0) {
      res.status(400).json({ error: "productIds must be a non-empty array when appliesTo is specific_products" });
      return;
    }
    if (scopedProductIds.length > 0) {
      const owned = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.ownerId, sellerId), inArray(products.id, scopedProductIds)));
      if (owned.length !== scopedProductIds.length) {
        res.status(400).json({ error: "One or more productIds don't belong to this store" });
        return;
      }
    }

    const extError = await validateExtensions(sellerId, { appliesTo: scope, collectionIds, maxUsesPerCustomer, minQuantity });
    if (extError) {
      res.status(400).json({ error: extError });
      return;
    }

    // Live-only code: the stream must be this seller's and currently live.
    // (Seller creates it from the host controls; see routes/live-commerce.ts.)
    let scopedLiveStreamId: string | null = null;
    if (liveStreamId) {
      if (typeof liveStreamId !== "string" || !UUID_RE.test(liveStreamId)) {
        res.status(400).json({ error: "liveStreamId is invalid" });
        return;
      }
      const [stream] = await db
        .select({ id: liveStreams.id, status: liveStreams.status })
        .from(liveStreams)
        .where(and(eq(liveStreams.id, liveStreamId), eq(liveStreams.sellerId, sellerId)))
        .limit(1);
      if (!stream || stream.status !== "live") {
        res.status(400).json({ error: "Live codes can only be created for your own live stream while it is live" });
        return;
      }
      scopedLiveStreamId = stream.id;
    }

    // Auto-generate a code if the seller didn't type one; retry on collision.
    let normalizedCode = code?.trim() ? code.trim().toUpperCase() : "";
    if (!normalizedCode) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = randomCode();
        const [clash] = await db
          .select({ id: discountCodes.id })
          .from(discountCodes)
          .where(and(eq(discountCodes.sellerId, sellerId), eq(discountCodes.code, candidate)))
          .limit(1);
        if (!clash) { normalizedCode = candidate; break; }
      }
      if (!normalizedCode) {
        res.status(500).json({ error: "Could not generate a unique code, try again" });
        return;
      }
    } else {
      const [clash] = await db
        .select({ id: discountCodes.id })
        .from(discountCodes)
        .where(and(eq(discountCodes.sellerId, sellerId), eq(discountCodes.code, normalizedCode)))
        .limit(1);
      if (clash) {
        res.status(409).json({ error: `${normalizedCode} is already in use` });
        return;
      }
    }

    const effectiveMaxUses = singleUse ? 1 : (maxUses ?? null);
    const id = crypto.randomUUID();

    const [created] = await db
      .insert(discountCodes)
      .values({
        id,
        sellerId,
        code: normalizedCode,
        type: type as string,
        value: String(type === "free_shipping" || type === "free_item" ? 0 : value),
        minOrderCents: minOrderCents ?? 0,
        appliesTo: scope,
        productIds: scopedProductIds,
        maxUses: effectiveMaxUses,
        usesCount: 0,
        oneUsePerCustomer: !!oneUsePerCustomer,
        firstOrderOnly: !!firstOrderOnly,
        collectionIds: scope === "collections" && Array.isArray(collectionIds) ? collectionIds : [],
        maxUsesPerCustomer: maxUsesPerCustomer ?? null,
        minQuantity: minQuantity ?? 0,
        startsAt: startsAt ? new Date(startsAt) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        active: true,
        liveStreamId: scopedLiveStreamId,
      })
      .returning();

    if (scopedLiveStreamId) {
      broadcastToRoom(scopedLiveStreamId, { type: "liveCode", code: toLiveCodePublic(created) });
    }
    res.status(201).json(decorate(created));
  } catch (err) {
    req.log.error({ err }, "Failed to create discount code");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Buyer Endpoint ───────────────────────────────────────────────────────────

// GET /validate?code=CODE&sellerId=SELLER_ID&subtotalCents=AMOUNT&productIds=a,b,c
router.get("/validate", async (req, res) => {
  try {
    const { code, sellerId, subtotalCents, liveStreamId } = req.query as {
      code?: string;
      sellerId?: string;
      subtotalCents?: string;
      liveStreamId?: string;
    };
    const buyerId = (req as any).clerkUserId as string;

    if (!code || !sellerId || subtotalCents === undefined) {
      res.status(400).json({ error: "code, sellerId, and subtotalCents are required" });
      return;
    }

    const subtotal = Number(subtotalCents);
    if (isNaN(subtotal) || subtotal < 0) {
      res.status(400).json({ error: "subtotalCents must be a non-negative number" });
      return;
    }

    const itemsParam = typeof req.query.items === "string" ? req.query.items : null;
    let lines: Array<{ productId: string; priceCents: number; quantity: number }> = [];
    if (itemsParam) {
      try {
        const parsed = JSON.parse(itemsParam);
        if (Array.isArray(parsed)) lines = parsed;
      } catch { /* fall through to synthetic single-line cart below */ }
    }
    if (lines.length === 0) {
      // No line-item breakdown supplied (e.g. a bare code-preview call) —
      // synthesize one line so entire_store codes still validate against subtotal.
      lines = [{ productId: "*", priceCents: subtotal, quantity: 1 }];
    }

    let application;
    try {
      application = await validateDiscountCode({
        sellerId, code, customerKey: buyerId, cartSubtotalCents: subtotal, lines,
        liveStreamId: typeof liveStreamId === "string" && UUID_RE.test(liveStreamId) ? liveStreamId : null,
      });
    } catch (err) {
      if (err instanceof DiscountValidationError) {
        res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ error: err.code, message: err.message, ...err.details });
        return;
      }
      throw err;
    }

    res.json({
      id: application.discount.id,
      code: application.discount.code,
      type: application.discount.type,
      value: application.discount.value,
      appliedAmountCents: application.appliedAmountCents,
      freeShipping: application.freeShipping,
      description: application.description,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to validate discount code");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Seller Parameterized Endpoints ──────────────────────────────────────────

// PATCH /:id — update any editable field, or pause/resume via `active`
router.patch("/:id", requirePermission("marketing"), validateInput({ params: discountIdParams, body: updateDiscountBody }), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { id } = req.params;
    const {
      active, expiresAt, startsAt, minOrderCents, maxUses, oneUsePerCustomer,
      appliesTo, productIds, value, firstOrderOnly, collectionIds, maxUsesPerCustomer, minQuantity,
    } = req.body as {
      firstOrderOnly?: boolean;
      collectionIds?: string[];
      maxUsesPerCustomer?: number | null;
      minQuantity?: number;
      active?: boolean;
      expiresAt?: string | null;
      startsAt?: string | null;
      minOrderCents?: number;
      maxUses?: number | null;
      oneUsePerCustomer?: boolean;
      appliesTo?: string;
      productIds?: string[];
      value?: number;
    };

    // Same value bounds as create, checked against the code's stored type:
    // percentage savings are not capped downstream, so 150% must never land.
    if (typeof value === "number") {
      const [existing] = await db
        .select({ type: discountCodes.type })
        .from(discountCodes)
        .where(and(eq(discountCodes.id, id), eq(discountCodes.sellerId, sellerId)))
        .limit(1);
      if (existing?.type === "percentage" && (value < 1 || value > 100)) {
        res.status(400).json({ error: "value must be between 1 and 100 for percentage codes" });
        return;
      }
      if (existing?.type === "fixed" && value <= 0) {
        res.status(400).json({ error: "value must be greater than 0 for fixed codes" });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (active !== undefined) updates.active = active;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (startsAt !== undefined) updates.startsAt = startsAt ? new Date(startsAt) : null;
    if (minOrderCents !== undefined) updates.minOrderCents = minOrderCents;
    if (maxUses !== undefined) updates.maxUses = maxUses;
    if (oneUsePerCustomer !== undefined) updates.oneUsePerCustomer = oneUsePerCustomer;
    if (appliesTo !== undefined && VALID_APPLIES_TO.includes(appliesTo as any)) updates.appliesTo = appliesTo;
    if (productIds !== undefined) updates.productIds = Array.isArray(productIds) ? productIds : [];
    if (value !== undefined) updates.value = String(value);
    if (firstOrderOnly !== undefined) updates.firstOrderOnly = !!firstOrderOnly;
    if (collectionIds !== undefined) updates.collectionIds = Array.isArray(collectionIds) ? collectionIds : [];
    if (maxUsesPerCustomer !== undefined) updates.maxUsesPerCustomer = maxUsesPerCustomer;
    if (minQuantity !== undefined) updates.minQuantity = minQuantity;
    if (appliesTo === "collections" || collectionIds !== undefined || maxUsesPerCustomer !== undefined || minQuantity !== undefined) {
      const extError = await validateExtensions(sellerId, {
        appliesTo: appliesTo === "collections" ? appliesTo : undefined,
        collectionIds, maxUsesPerCustomer, minQuantity,
      });
      if (extError) {
        res.status(400).json({ error: extError });
        return;
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const [updated] = await db
      .update(discountCodes)
      .set(updates as any)
      .where(and(eq(discountCodes.id, id), eq(discountCodes.sellerId, sellerId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Discount code not found" });
      return;
    }

    res.json(decorate(updated));
  } catch (err) {
    req.log.error({ err, discountCodeId: req.params.id }, "Failed to update discount code");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /:id/uses — redemption ledger for one code (for the seller's list view)
router.get("/:id/uses", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { id } = req.params;
    const [owned] = await db
      .select({ id: discountCodes.id })
      .from(discountCodes)
      .where(and(eq(discountCodes.id, id), eq(discountCodes.sellerId, sellerId)))
      .limit(1);
    if (!owned) {
      res.status(404).json({ error: "Discount code not found" });
      return;
    }
    const uses = await db
      .select()
      .from(discountCodeUses)
      .where(eq(discountCodeUses.discountCodeId, id));
    res.json(uses);
  } catch (err) {
    req.log.error({ err, discountCodeId: req.params.id }, "Failed to list discount code uses");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /:id — delete a code (only if ownerId matches sellerId)
router.delete("/:id", requirePermission("marketing"), validateInput({ params: discountIdParams }), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { id } = req.params;

    const [deleted] = await db
      .delete(discountCodes)
      .where(and(eq(discountCodes.id, id), eq(discountCodes.sellerId, sellerId)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Discount code not found" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err, discountCodeId: req.params.id }, "Failed to delete discount code");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
