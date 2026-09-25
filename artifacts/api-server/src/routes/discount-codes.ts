import { Router } from "express";
import { db, discountCodes, discountCodeUses, products } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { validateDiscountCode, DiscountValidationError } from "../lib/discounts";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ["percentage", "fixed", "free_shipping", "free_item"] as const;
const VALID_APPLIES_TO = ["entire_store", "specific_products"] as const;

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

// POST / — create a new discount code
router.post("/", requirePermission("marketing"), async (req, res) => {
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
    } = req.body as {
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
        startsAt: startsAt ? new Date(startsAt) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        active: true,
      })
      .returning();

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
    const { code, sellerId, subtotalCents } = req.query as {
      code?: string;
      sellerId?: string;
      subtotalCents?: string;
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
router.patch("/:id", requirePermission("marketing"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { id } = req.params;
    const {
      active, expiresAt, startsAt, minOrderCents, maxUses, oneUsePerCustomer,
      appliesTo, productIds, value,
    } = req.body as {
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
router.delete("/:id", requirePermission("marketing"), async (req, res) => {
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
