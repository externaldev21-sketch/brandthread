import { Router } from "express";
import { db, discountCodes } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ["percentage", "fixed", "free_shipping"] as const;

// ─── Seller Endpoints ─────────────────────────────────────────────────────────

// GET / — list all discount codes for the authenticated seller
router.get("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const codes = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.sellerId, sellerId));
    res.json(codes);
  } catch (err) {
    req.log.error({ err }, "Failed to list discount codes");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST / — create a new discount code
router.post("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const {
      code,
      type,
      value,
      minOrderCents,
      maxUses,
      expiresAt,
    } = req.body as {
      code?: string;
      type?: string;
      value?: number;
      minOrderCents?: number;
      maxUses?: number | null;
      expiresAt?: string | null;
    };

    // Validate
    if (!code || typeof code !== "string" || code.trim() === "") {
      res.status(400).json({ error: "code must be a non-empty string" });
      return;
    }
    if (!VALID_TYPES.includes(type as any)) {
      res.status(400).json({ error: "type must be one of: percentage, fixed, free_shipping" });
      return;
    }
    if (value === undefined || value === null || Number(value) < 0) {
      res.status(400).json({ error: "value must be >= 0" });
      return;
    }

    const normalizedCode = code.toUpperCase().trim();
    const id = crypto.randomUUID();

    const [created] = await db
      .insert(discountCodes)
      .values({
        id,
        sellerId,
        code: normalizedCode,
        type: type as string,
        value: String(value),
        minOrderCents: minOrderCents ?? 0,
        maxUses: maxUses ?? null,
        usesCount: 0,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        active: true,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create discount code");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Buyer Endpoint ───────────────────────────────────────────────────────────

// GET /validate?code=CODE&sellerId=SELLER_ID&subtotalCents=AMOUNT
router.get("/validate", async (req, res) => {
  try {
    const { code, sellerId, subtotalCents } = req.query as {
      code?: string;
      sellerId?: string;
      subtotalCents?: string;
    };

    if (!code || !sellerId || subtotalCents === undefined) {
      res.status(400).json({ error: "code, sellerId, and subtotalCents are required" });
      return;
    }

    const subtotal = Number(subtotalCents);
    if (isNaN(subtotal) || subtotal < 0) {
      res.status(400).json({ error: "subtotalCents must be a non-negative number" });
      return;
    }

    const normalizedCode = code.toUpperCase().trim();

    const [found] = await db
      .select()
      .from(discountCodes)
      .where(
        and(
          eq(discountCodes.sellerId, sellerId),
          eq(discountCodes.code, normalizedCode),
          eq(discountCodes.active, true)
        )
      )
      .limit(1);

    if (!found) {
      res.status(404).json({ error: "Discount code not found or not active" });
      return;
    }

    // Check expiration
    if (found.expiresAt && new Date(found.expiresAt) < new Date()) {
      res.status(400).json({ error: "EXPIRED" });
      return;
    }

    // Check max uses
    if (found.maxUses !== null && found.maxUses !== undefined && found.usesCount >= found.maxUses) {
      res.status(400).json({ error: "MAX_USES_REACHED" });
      return;
    }

    // Check minimum order
    if (subtotal < (found.minOrderCents ?? 0)) {
      res.status(400).json({ error: "MIN_ORDER_NOT_MET", minOrderCents: found.minOrderCents });
      return;
    }

    // Calculate applied amount
    const value = Number(found.value);
    let appliedAmountCents = 0;

    if (found.type === "percentage") {
      appliedAmountCents = Math.round(subtotal * value / 100);
    } else if (found.type === "fixed") {
      // value is stored as dollar amount (e.g. 10.00 = $10 off)
      appliedAmountCents = Math.min(Math.round(value * 100), subtotal);
    } else if (found.type === "free_shipping") {
      appliedAmountCents = 0;
    }

    // Build description
    let description = "";
    if (found.type === "percentage") {
      description = `${value}% off`;
    } else if (found.type === "fixed") {
      description = `$${value.toFixed(2)} off`;
    } else if (found.type === "free_shipping") {
      description = "Free shipping";
    }

    res.json({
      id: found.id,
      code: found.code,
      type: found.type,
      value: found.value,
      appliedAmountCents,
      description,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to validate discount code");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Seller Parameterized Endpoints ──────────────────────────────────────────

// PATCH /:id — update active status or expiration
router.patch("/:id", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { id } = req.params;
    const { active, expiresAt } = req.body as {
      active?: boolean;
      expiresAt?: string | null;
    };

    const updates: Record<string, unknown> = {};
    if (active !== undefined) updates.active = active;
    if (expiresAt !== undefined) {
      updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
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

    res.json(updated);
  } catch (err) {
    req.log.error({ err, discountCodeId: req.params.id }, "Failed to update discount code");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /:id — delete a code (only if ownerId matches sellerId)
router.delete("/:id", async (req, res) => {
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
