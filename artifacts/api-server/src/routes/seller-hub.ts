/**
 * Seller Hub — seller-facing manufacturer discovery and quote/sample requests.
 * Distinct from /manufacturers which is the manufacturer portal (their own profile mgmt).
 */
import { Router } from "express";
import { db, manufacturers, sellerQuoteRequests } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

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
    .where(eq(sellerQuoteRequests.sellerId, sellerId));

  // Most recent first
  res.json(rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
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

  if (!manufacturerId || !productName) {
    return res.status(400).json({ error: "manufacturerId and productName are required" });
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
      productName,
      productType,
      quantity,
      colorways,
      details,
      status: "submitted",
    })
    .returning();

  return res.status(201).json(row);
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
  return res.json(row);
});

// PATCH /api/seller-hub/quote-requests/:id
// Seller can: accept a quote ('accepted'), cancel ('cancelled'), or add notes.
router.patch("/quote-requests/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { status, notes } = req.body as { status?: string; notes?: string };

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

  const updates: Partial<typeof sellerQuoteRequests.$inferInsert> & { updatedAt?: Date } = {
    updatedAt: new Date(),
  };
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;

  const [updated] = await db
    .update(sellerQuoteRequests)
    .set(updates)
    .where(eq(sellerQuoteRequests.id, req.params.id))
    .returning();

  return res.json(updated);
});

export default router;
