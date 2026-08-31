/**
 * Public manufacturer directory — no auth required for reads.
 * Mounted at /api/manufacturers/public
 *
 * GET  /              list active public manufacturers (with optional filters)
 * POST /apply         public application — goes live immediately, no Clerk account needed
 * GET  /:id           get a single public manufacturer profile
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, manufacturers, manufacturerReviews, sampleOrders, users } from "@workspace/db";
import { eq, and, ilike, sql, or, inArray, desc } from "drizzle-orm";
import { containsSearchPattern, normalizeSearchTerm } from "../lib/search";
import { ApplyAsManufacturerBody } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
const objectStorage = new ObjectStorageService();

const publicManufacturerFields = {
  id:              manufacturers.id,
  businessName:    manufacturers.businessName,
  country:         manufacturers.country,
  city:            manufacturers.city,
  specialty:       manufacturers.specialty,
  description:     manufacturers.description,
  yearsInBusiness: manufacturers.yearsInBusiness,
  moq:             manufacturers.moq,
  photos:          manufacturers.photos,
  website:         manufacturers.website,
  priceRange:      manufacturers.priceRange,
  sampleTurnaround: manufacturers.sampleTurnaround,
  bulkTurnaround:  manufacturers.bulkTurnaround,
  ratingBasisPoints: manufacturers.ratingBasisPoints,
  responseTime:    manufacturers.responseTime,
  verifiedAt:      manufacturers.verifiedAt,
  createdAt:       manufacturers.createdAt,
  updatedAt:       manufacturers.updatedAt,
  revision:        manufacturers.revision,
  status:          manufacturers.status,
  isPublicDirectory: manufacturers.isPublicDirectory,
};

type ReviewSummary = { rating: number | null; reviewCount: number };

async function getReviewSummaries(manufacturerIds: string[]): Promise<Map<string, ReviewSummary>> {
  if (manufacturerIds.length === 0) return new Map();
  const rows = await db.select({
    manufacturerId: manufacturerReviews.manufacturerId,
    reviewCount: sql<number>`count(*)::integer`,
    rating: sql<number>`round(avg(${manufacturerReviews.rating})::numeric, 2)::float`,
  }).from(manufacturerReviews)
    .where(inArray(manufacturerReviews.manufacturerId, manufacturerIds))
    .groupBy(manufacturerReviews.manufacturerId);
  return new Map(rows.map((row) => [row.manufacturerId, {
    rating: Number(row.rating),
    reviewCount: Number(row.reviewCount),
  }]));
}

function serializeManufacturerReview(row: {
  id: string;
  sellerId: string;
  sellerName: string | null;
  rating: number;
  qualityRating: number;
  communicationRating: number;
  deliveryRating: number;
  comment: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerName: row.sellerName?.trim() || "Verified seller",
    rating: row.rating,
    qualityRating: row.qualityRating,
    communicationRating: row.communicationRating,
    deliveryRating: row.deliveryRating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

async function listManufacturerReviews(manufacturerId: string) {
  const rows = await db.select({
    id: manufacturerReviews.id,
    sellerId: manufacturerReviews.sellerId,
    sellerName: users.displayName,
    rating: manufacturerReviews.rating,
    qualityRating: manufacturerReviews.qualityRating,
    communicationRating: manufacturerReviews.communicationRating,
    deliveryRating: manufacturerReviews.deliveryRating,
    comment: manufacturerReviews.comment,
    createdAt: manufacturerReviews.createdAt,
  }).from(manufacturerReviews)
    .leftJoin(users, eq(users.clerkId, manufacturerReviews.sellerId))
    .where(eq(manufacturerReviews.manufacturerId, manufacturerId))
    .orderBy(desc(manufacturerReviews.createdAt));
  return rows.map(serializeManufacturerReview);
}

async function serializePublicManufacturer(
  mfr: typeof publicManufacturerFields extends infer _T ? any : never,
  summary?: ReviewSummary,
  reviews?: Awaited<ReturnType<typeof listManufacturerReviews>>,
) {
  if (mfr.status !== "active" || mfr.isPublicDirectory !== true) return null;
  const { status: _status, isPublicDirectory: _isPublicDirectory, photos: storedPhotos, ...publicFields } = mfr;
  const photos = await Promise.all((storedPhotos ?? [])
    .filter((path: unknown): path is string => typeof path === "string" && path.startsWith("/objects/"))
    .map((path: string) => objectStorage.getObjectEntityDownloadURL(path)));
  return {
    ...publicFields,
    photos,
    isVerified: !!mfr.verifiedAt,
    rating: summary?.rating ?? null,
    reviewCount: summary?.reviewCount ?? 0,
    reviews: reviews ?? [],
    responseTime: mfr.responseTime || null,
    ratingBasisPoints: undefined,
    verifiedAt: mfr.verifiedAt?.toISOString() ?? null,
    createdAt: mfr.createdAt.toISOString(),
    updatedAt: mfr.updatedAt.toISOString(),
  };
}

// ── GET /api/manufacturers/public ─────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { q, country, specialty } = req.query as Record<string, string>;
    const searchTerm = normalizeSearchTerm(q);
    const countryTerm = normalizeSearchTerm(country, 80);
    const specialtyTerm = normalizeSearchTerm(specialty, 100);

    const conditions = [
      eq(manufacturers.isPublicDirectory, true),
      eq(manufacturers.status, "active"),
    ];

    if (countryTerm) {
      conditions.push(eq(manufacturers.country, countryTerm));
    }

    if (searchTerm) {
      const like = containsSearchPattern(searchTerm);
      conditions.push(
        or(
          ilike(manufacturers.businessName, like),
          ilike(manufacturers.specialty, like),
          ilike(manufacturers.description, like),
          ilike(manufacturers.country, like),
        )!,
      );
    }

    if (specialtyTerm) {
      conditions.push(ilike(manufacturers.specialty, containsSearchPattern(specialtyTerm)));
    }

    const rows = await db
      .select(publicManufacturerFields)
      .from(manufacturers)
      .where(and(...conditions))
      .orderBy(sql`${manufacturers.verifiedAt} DESC NULLS LAST, ${manufacturers.createdAt} DESC`);

    const summaries = await getReviewSummaries(rows.map((row) => row.id));
    const serialized = await Promise.all(rows.map((row) =>
      serializePublicManufacturer(row, summaries.get(row.id))));
    res.json(serialized.filter((row) => row !== null));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch public manufacturers");
    res.status(500).json({ error: "Failed to fetch manufacturers" });
  }
});

// ── GET/POST /api/manufacturers/public/:id/reviews ───────────────────────────

router.get("/:id/reviews", async (req, res) => {
  const manufacturerId = String(req.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manufacturerId)) {
    res.status(400).json({ error: "A canonical manufacturer UUID is required" }); return;
  }
  const [manufacturer] = await db.select({ id: manufacturers.id }).from(manufacturers).where(and(
    eq(manufacturers.id, manufacturerId),
    eq(manufacturers.status, "active"),
    eq(manufacturers.isPublicDirectory, true),
  )).limit(1);
  if (!manufacturer) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await listManufacturerReviews(manufacturer.id));
});

router.post("/:id/reviews", requireAuth, async (req, res) => {
  const manufacturerId = String(req.params.id);
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manufacturerId)) {
    res.status(400).json({ error: "A canonical manufacturer UUID is required" }); return;
  }
  const { sampleOrderId, rating, qualityRating, communicationRating, deliveryRating, comment = "" } = req.body ?? {};
  const ratings = [rating, qualityRating, communicationRating, deliveryRating];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sampleOrderId ?? "")
    || ratings.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) {
    res.status(400).json({ error: "sampleOrderId and integer ratings from 1 to 5 are required" }); return;
  }
  if (typeof comment !== "string" || comment.trim().length > 2000) {
    res.status(400).json({ error: "Comment must be 2,000 characters or fewer" }); return;
  }

  const [eligibleOrder] = await db.select({ id: sampleOrders.id }).from(sampleOrders).where(and(
    eq(sampleOrders.id, sampleOrderId),
    eq(sampleOrders.sellerId, userId),
    eq(sampleOrders.manufacturerId, manufacturerId),
    inArray(sampleOrders.orderType, ["sample", "bulk"]),
    inArray(sampleOrders.status, ["delivered", "review_needed", "approved", "rejected", "revision_requested", "completed"]),
  )).limit(1);
  if (!eligibleOrder) {
    res.status(403).json({ error: "A completed manufacturer order or delivered sample is required" }); return;
  }

  const [duplicate] = await db.select({ id: manufacturerReviews.id }).from(manufacturerReviews)
    .where(eq(manufacturerReviews.sampleOrderId, eligibleOrder.id)).limit(1);
  if (duplicate) { res.status(409).json({ error: "This order has already been reviewed" }); return; }

  try {
    const created = await db.transaction(async (tx) => {
      const [review] = await tx.insert(manufacturerReviews).values({
        sellerId: userId,
        manufacturerId,
        sampleOrderId: eligibleOrder.id,
        rating,
        qualityRating,
        communicationRating,
        deliveryRating,
        comment: comment.trim(),
      }).returning();
      await tx.update(manufacturers).set({
        ratingBasisPoints: sql`COALESCE((
          SELECT ROUND(AVG(rating) * 100)::integer
          FROM manufacturer_reviews
          WHERE manufacturer_id = ${manufacturerId}
        ), 0)`,
        updatedAt: new Date(),
      }).where(eq(manufacturers.id, manufacturerId));
      return review;
    });
    const [seller] = await db.select({ displayName: users.displayName }).from(users)
      .where(eq(users.clerkId, userId)).limit(1);
    res.status(201).json(serializeManufacturerReview({
      ...created,
      sellerName: seller?.displayName ?? null,
    }));
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "This order has already been reviewed" }); return;
    }
    req.log.error({ err: error, manufacturerId, sampleOrderId }, "Failed to create manufacturer review");
    res.status(500).json({ error: "Failed to create review" });
  }
});

// ── POST /api/manufacturers/public/apply ──────────────────────────────────────
// No Clerk auth — public application form submission. Applications remain
// private and pending until an authenticated review/claim flow approves them.

router.post("/apply", async (req, res) => {
  try {
    const parsed = ApplyAsManufacturerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() }); return;
    }
    const {
      businessName, country, city, specialty, description,
      yearsInBusiness, website, contactEmail,
      moq, priceRange, bulkTurnaround, sampleTurnaround,
      clientRequestId,
    } = parsed.data;
    const [duplicate] = await db.select({ id: manufacturers.id, status: manufacturers.status })
      .from(manufacturers)
      .where(eq(manufacturers.applicationRequestId, clientRequestId))
      .limit(1);
    if (duplicate) {
      res.status(202).json({ id: duplicate.id, status: "pending", published: false });
      return;
    }

    const [created] = await db
      .insert(manufacturers)
      .values({
        // clerkId is null for public applications — claimed later
        applicationRequestId: clientRequestId,
        businessName: businessName.trim(),
        country:      country.trim(),
        city:         city?.trim() ?? null,
        specialty:    specialty.trim(),
        description:  description?.trim() ?? null,
        yearsInBusiness: Number(yearsInBusiness) || 0,
        // Anonymous applicants cannot publish or bind arbitrary media URLs.
        // Photos are uploaded through the authenticated endpoint after claim.
        photos:       [],
        website:      website?.trim() ?? null,
        contactEmail: contactEmail?.trim() ?? null,
        moq:          Number(moq) || 100,
        priceRange:   priceRange?.trim() ?? "",
        bulkTurnaround:  bulkTurnaround?.trim() ?? "",
        sampleTurnaround: sampleTurnaround?.trim() ?? "",
        status:            "pending",
        isPublicDirectory: false,
      }).onConflictDoNothing()
      .returning();
    const mfr = created ?? (await db.select().from(manufacturers)
      .where(eq(manufacturers.applicationRequestId, clientRequestId))
      .limit(1))[0];
    if (!mfr) {
      res.status(409).json({ error: "Application request conflicted; retry" }); return;
    }

    res.status(202).json({ id: mfr.id, status: "pending", published: false });
  } catch (err) {
    req.log.error({ err }, "Failed to submit manufacturer application");
    res.status(500).json({ error: "Application failed" });
  }
});

// ── GET /api/manufacturers/public/:id ─────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ error: "A canonical manufacturer UUID is required" }); return;
    }
    const [mfr] = await db
      .select(publicManufacturerFields)
      .from(manufacturers)
      .where(
        and(
          eq(manufacturers.id, req.params.id),
          eq(manufacturers.isPublicDirectory, true),
          eq(manufacturers.status, "active"),
        ),
      )
      .limit(1);

    if (!mfr) {
      res.status(404).json({ error: "Not found" }); return;
    }

    const [summaries, reviews] = await Promise.all([
      getReviewSummaries([mfr.id]),
      listManufacturerReviews(mfr.id),
    ]);
    const serialized = await serializePublicManufacturer(mfr, summaries.get(mfr.id), reviews);
    if (!serialized) {
      res.status(404).json({ error: "Not found" }); return;
    }
    res.json(serialized);
  } catch (err) {
    req.log.error({ err, manufacturerId: req.params.id }, "Failed to fetch public manufacturer");
    res.status(500).json({ error: "Failed to fetch manufacturer" });
  }
});

export default router;
