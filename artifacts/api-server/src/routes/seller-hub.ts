/**
 * Seller Hub — seller-facing manufacturer discovery and quote/sample requests.
 * Distinct from /manufacturers which is the manufacturer portal (their own profile mgmt).
 */
import { Router } from "express";
import { db, manufacturers, sellerQuoteRequests } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELLER_QUOTE_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  submitted: new Set(["cancelled"]),
  viewed: new Set(["cancelled"]),
  questions_asked: new Set(["cancelled"]),
  quoted: new Set(["accepted", "declined", "counteroffer_sent", "cancelled"]),
  counteroffer_sent: new Set(["cancelled"]),
};

export function canSellerTransitionQuote(from: string, to: string): boolean {
  return SELLER_QUOTE_TRANSITIONS[from]?.has(to) === true;
}

function serializeQuoteRequest(row: typeof sellerQuoteRequests.$inferSelect) {
  return {
    ...row,
    quoteValidUntil: row.quoteValidUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Manufacturer Discovery ────────────────────────────────────────────────────

// GET /api/seller-hub/manufacturers
// Public directory of active/verified manufacturers sellers can request quotes from.
router.get("/manufacturers", async (_req, res) => {
  const rows = await db
    .select({
      id:               manufacturers.id,
      businessName:     manufacturers.businessName,
      country:          manufacturers.country,
      specialty:        manufacturers.specialty,
      description:      manufacturers.description,
      moq:              manufacturers.moq,
      priceRange:       manufacturers.priceRange,
      bulkTurnaround:   manufacturers.bulkTurnaround,
      sampleTurnaround: manufacturers.sampleTurnaround,
      photos:           manufacturers.photos,
      website:          manufacturers.website,
      verifiedAt:       manufacturers.verifiedAt,
    })
    .from(manufacturers)
    .where(eq(manufacturers.status, "active"));

  res.json(rows);
});

// ─── Quote & Sample Requests ───────────────────────────────────────────────────

// GET /api/seller-hub/quote-requests
// List all quote/sample requests made by this seller.
router.get("/quote-requests", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(sellerQuoteRequests)
    .where(eq(sellerQuoteRequests.sellerId, sellerId))
    .orderBy(desc(sellerQuoteRequests.createdAt));

  res.json(rows.map(serializeQuoteRequest));
});

// POST /api/seller-hub/quote-requests
// Create and immediately submit a quote or sample request.
router.post("/quote-requests", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const {
    manufacturerId,
    type = "quote",
    productName,
    productType = "apparel",
    quantity,
    colorways,
    details,
  } = req.body as {
    manufacturerId: string;
    type?: string;
    productName: string;
    productType?: string;
    quantity?: number;
    colorways?: string;
    details?: string;
  };

  if (!UUID_RE.test(manufacturerId ?? "") || typeof productName !== "string" || !productName.trim()) {
    return res.status(400).json({ error: "A canonical manufacturerId and productName are required" });
  }
  if (!["quote", "sample"].includes(type)) {
    return res.status(400).json({ error: "type must be quote or sample" });
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    return res.status(400).json({ error: "quantity must be a positive integer" });
  }

  // Verify manufacturer is active
  const [mfg] = await db
    .select({ id: manufacturers.id })
    .from(manufacturers)
    .where(and(eq(manufacturers.id, manufacturerId), eq(manufacturers.status, "active")));

  if (!mfg) {
    return res.status(404).json({ error: "Manufacturer not found or not active" });
  }

  const [row] = await db
    .insert(sellerQuoteRequests)
    .values({
      sellerId,
      manufacturerId,
      type,
      productName: productName.trim(),
      productType: productType.trim() || "apparel",
      quantity,
      colorways,
      details,
      status: "submitted",
    })
    .returning();

  return res.status(201).json(serializeQuoteRequest(row));
});

// GET /api/seller-hub/quote-requests/:id
router.get("/quote-requests/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const [row] = await db
    .select()
    .from(sellerQuoteRequests)
    .where(
      and(
        eq(sellerQuoteRequests.id, req.params.id),
        eq(sellerQuoteRequests.sellerId, sellerId),
      ),
    );

  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(serializeQuoteRequest(row));
});

// PATCH /api/seller-hub/quote-requests/:id
// Seller can withdraw an open request, or accept/decline/counter a persisted
// manufacturer quote. Status transitions are conditional to prevent races.
router.patch("/quote-requests/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { status, counteroffer } = req.body as {
    status?: string;
    counteroffer?: {
      desiredUnitPriceCents?: number;
      desiredMoq?: number;
      desiredProductionDays?: number;
      desiredPaymentTerms?: string;
      notes?: string;
    };
  };

  const [existing] = await db
    .select()
    .from(sellerQuoteRequests)
    .where(
      and(
        eq(sellerQuoteRequests.id, req.params.id),
        eq(sellerQuoteRequests.sellerId, sellerId),
      ),
    );

  if (!existing) return res.status(404).json({ error: "Not found" });

  if (!status || !canSellerTransitionQuote(existing.status, status)) {
    return res.status(409).json({ error: `Cannot move quote request from ${existing.status} to ${status ?? "an unspecified status"}` });
  }

  const updates: Partial<typeof sellerQuoteRequests.$inferInsert> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "counteroffer_sent") {
    if (!counteroffer || !Object.values(counteroffer).some((value) => value !== undefined && value !== "")) {
      return res.status(400).json({ error: "Counteroffer terms are required" });
    }
    if (counteroffer.desiredUnitPriceCents !== undefined
      && (!Number.isInteger(counteroffer.desiredUnitPriceCents) || counteroffer.desiredUnitPriceCents < 1)) {
      return res.status(400).json({ error: "desiredUnitPriceCents must be a positive integer" });
    }
    updates.counteroffer = {
      ...counteroffer,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  }

  const [updated] = await db
    .update(sellerQuoteRequests)
    .set(updates)
    .where(and(
      eq(sellerQuoteRequests.id, req.params.id),
      eq(sellerQuoteRequests.sellerId, sellerId),
      eq(sellerQuoteRequests.status, existing.status),
    ))
    .returning();

  if (!updated) return res.status(409).json({ error: "Quote request changed; refresh and try again" });
  return res.json(serializeQuoteRequest(updated));
});

export default router;
