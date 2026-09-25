/**
 * Seller Hub — seller-facing manufacturer discovery and quote/sample requests.
 * Distinct from /manufacturers which is the manufacturer portal (their own profile mgmt).
 */
import { Router } from "express";
import { db, manufacturers, sellerQuoteRequests, sellerRfqs } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";

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
router.get("/manufacturers", async (req, res) => {
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) return res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
  const { limit, offset } = page.data;
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
    .where(eq(manufacturers.status, "active"))
    .orderBy(desc(manufacturers.verifiedAt), manufacturers.id)
    .limit(limit)
    .offset(offset);

  setPaginationHeaders(res, page.data, rows.length);
  return res.json(rows);
});

// ─── Quote & Sample Requests ───────────────────────────────────────────────────

// GET /api/seller-hub/quote-requests
// List all quote/sample requests made by this seller.
router.get("/quote-requests", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) return res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
  const { limit, offset } = page.data;
  const rows = await db
    .select()
    .from(sellerQuoteRequests)
    .where(eq(sellerQuoteRequests.sellerId, sellerId))
    .orderBy(desc(sellerQuoteRequests.createdAt))
    .limit(limit)
    .offset(offset);

  setPaginationHeaders(res, page.data, rows.length);
  return res.json(rows.map(serializeQuoteRequest));
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

// ─── RFQs (broadcast one request to many manufacturers, compare quotes) ────────
// A seller posts one RFQ; it fans out into one seller_quote_requests row per
// matched manufacturer, reusing the existing 1:1 quote lifecycle so each
// manufacturer quotes independently through /manufacturers/me/quote-requests.

const MAX_RFQ_TARGETS = 10;

function serializeRfq(row: typeof sellerRfqs.$inferSelect) {
  return {
    ...row,
    deadline: row.deadline?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /api/seller-hub/rfqs
// List the seller's RFQs with a rollup of quotes received so far.
router.get("/rfqs", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) return res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
  const { limit, offset } = page.data;
  const rows = await db.select().from(sellerRfqs)
    .where(eq(sellerRfqs.sellerId, sellerId))
    .orderBy(desc(sellerRfqs.createdAt))
    .limit(limit)
    .offset(offset);
  setPaginationHeaders(res, page.data, rows.length);

  const rfqIds = rows.map((row) => row.id);
  const quotes = rfqIds.length === 0 ? [] : await db.select({
    rfqId: sellerQuoteRequests.rfqId,
    status: sellerQuoteRequests.status,
  }).from(sellerQuoteRequests).where(inArray(sellerQuoteRequests.rfqId, rfqIds));
  const countsByRfq = new Map<string, { manufacturersCount: number; quotesReceivedCount: number }>();
  for (const quote of quotes) {
    if (!quote.rfqId) continue;
    const entry = countsByRfq.get(quote.rfqId) ?? { manufacturersCount: 0, quotesReceivedCount: 0 };
    entry.manufacturersCount += 1;
    if (["quoted", "accepted", "declined", "counteroffer_sent"].includes(quote.status)) entry.quotesReceivedCount += 1;
    countsByRfq.set(quote.rfqId, entry);
  }

  return res.json(rows.map((row) => ({
    ...serializeRfq(row),
    manufacturersCount: countsByRfq.get(row.id)?.manufacturersCount ?? 0,
    quotesReceivedCount: countsByRfq.get(row.id)?.quotesReceivedCount ?? 0,
  })));
});

// POST /api/seller-hub/rfqs
// Post a Request for Quotation and fan it out to the chosen manufacturers.
router.post("/rfqs", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const {
    garmentType, category = "", description = "", quantity,
    targetPriceCents, deadline, fileIds = [], manufacturerIds,
  } = req.body as {
    garmentType?: string; category?: string; description?: string; quantity?: number;
    targetPriceCents?: number; deadline?: string; fileIds?: string[]; manufacturerIds?: string[];
  };

  if (typeof garmentType !== "string" || !garmentType.trim()) {
    return res.status(400).json({ error: "garmentType is required" });
  }
  if (!Number.isInteger(quantity) || (quantity as number) < 1) {
    return res.status(400).json({ error: "quantity must be a positive integer" });
  }
  if (targetPriceCents !== undefined && (!Number.isInteger(targetPriceCents) || targetPriceCents < 0)) {
    return res.status(400).json({ error: "targetPriceCents must be a non-negative integer" });
  }
  let deadlineDate: Date | null = null;
  if (deadline !== undefined) {
    deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) return res.status(400).json({ error: "deadline must be a valid date" });
  }
  if (!Array.isArray(manufacturerIds) || manufacturerIds.length === 0 || manufacturerIds.length > MAX_RFQ_TARGETS) {
    return res.status(400).json({ error: `manufacturerIds must include 1 to ${MAX_RFQ_TARGETS} manufacturers` });
  }
  const uniqueManufacturerIds = [...new Set(manufacturerIds)];
  if (!uniqueManufacturerIds.every((id) => UUID_RE.test(id))) {
    return res.status(400).json({ error: "manufacturerIds must be canonical manufacturer UUIDs" });
  }

  const activeManufacturers = await db.select({ id: manufacturers.id })
    .from(manufacturers)
    .where(and(inArray(manufacturers.id, uniqueManufacturerIds), eq(manufacturers.status, "active")));
  if (activeManufacturers.length === 0) {
    return res.status(404).json({ error: "None of the selected manufacturers are active" });
  }

  const created = await db.transaction(async (tx) => {
    const [rfq] = await tx.insert(sellerRfqs).values({
      sellerId,
      garmentType: garmentType.trim(),
      category: category.trim(),
      description: description.trim(),
      quantity: quantity as number,
      targetPriceCents: targetPriceCents ?? null,
      deadline: deadlineDate,
      fileIds: Array.isArray(fileIds) ? fileIds.filter((v): v is string => typeof v === "string") : [],
      status: "matched",
    }).returning();

    await tx.insert(sellerQuoteRequests).values(activeManufacturers.map((mfr) => ({
      sellerId,
      manufacturerId: mfr.id,
      rfqId: rfq.id,
      type: "quote",
      productName: garmentType.trim(),
      productType: category.trim() || "apparel",
      quantity: quantity as number,
      details: description.trim(),
      status: "submitted",
    })));

    return rfq;
  });

  return res.status(201).json({
    ...serializeRfq(created),
    manufacturersCount: activeManufacturers.length,
    quotesReceivedCount: 0,
  });
});

// GET /api/seller-hub/rfqs/:id
// RFQ detail with every per-manufacturer quote request, for side-by-side comparison.
router.get("/rfqs/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const [rfq] = await db.select().from(sellerRfqs).where(and(
    eq(sellerRfqs.id, req.params.id),
    eq(sellerRfqs.sellerId, sellerId),
  )).limit(1);
  if (!rfq) return res.status(404).json({ error: "Not found" });

  const quoteRows = await db.select({
    quote: sellerQuoteRequests,
    manufacturerName: manufacturers.businessName,
    manufacturerCountry: manufacturers.country,
    manufacturerVerifiedAt: manufacturers.verifiedAt,
  }).from(sellerQuoteRequests)
    .innerJoin(manufacturers, eq(manufacturers.id, sellerQuoteRequests.manufacturerId))
    .where(eq(sellerQuoteRequests.rfqId, rfq.id))
    .orderBy(desc(sellerQuoteRequests.updatedAt));

  return res.json({
    ...serializeRfq(rfq),
    quotes: quoteRows.map((row) => ({
      ...serializeQuoteRequest(row.quote),
      manufacturerName: row.manufacturerName,
      manufacturerCountry: row.manufacturerCountry,
      manufacturerIsVerified: !!row.manufacturerVerifiedAt,
    })),
  });
});

// PATCH /api/seller-hub/rfqs/:id
// Seller can cancel an open/matched RFQ.
router.patch("/rfqs/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { status } = req.body as { status?: string };
  if (status !== "cancelled" && status !== "closed") {
    return res.status(400).json({ error: "status must be cancelled or closed" });
  }
  const [existing] = await db.select().from(sellerRfqs).where(and(
    eq(sellerRfqs.id, req.params.id),
    eq(sellerRfqs.sellerId, sellerId),
  )).limit(1);
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!["open", "matched"].includes(existing.status)) {
    return res.status(409).json({ error: `Cannot move RFQ from ${existing.status} to ${status}` });
  }

  const [updated] = await db.update(sellerRfqs).set({ status, updatedAt: new Date() })
    .where(and(eq(sellerRfqs.id, existing.id), eq(sellerRfqs.status, existing.status)))
    .returning();
  if (!updated) return res.status(409).json({ error: "RFQ changed; refresh and try again" });
  return res.json(serializeRfq(updated));
});

export default router;
