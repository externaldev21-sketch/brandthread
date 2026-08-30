/**
 * Public manufacturer directory — no auth required for reads.
 * Mounted at /api/manufacturers/public
 *
 * GET  /              list active public manufacturers (with optional filters)
 * POST /apply         public application — goes live immediately, no Clerk account needed
 * GET  /:id           get a single public manufacturer profile
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { manufacturers } from "@workspace/db";
import { eq, and, ilike, sql, or } from "drizzle-orm";
import { containsSearchPattern, normalizeSearchTerm } from "../lib/search";
import { ApplyAsManufacturerBody } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

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

async function serializePublicManufacturer(mfr: typeof publicManufacturerFields extends infer _T ? any : never) {
  if (mfr.status !== "active" || mfr.isPublicDirectory !== true) return null;
  const { status: _status, isPublicDirectory: _isPublicDirectory, photos: storedPhotos, ...publicFields } = mfr;
  const photos = await Promise.all((storedPhotos ?? [])
    .filter((path: unknown): path is string => typeof path === "string" && path.startsWith("/objects/"))
    .map((path: string) => objectStorage.getObjectEntityDownloadURL(path)));
  return {
    ...publicFields,
    photos,
    isVerified: !!mfr.verifiedAt,
    rating: mfr.ratingBasisPoints > 0 ? mfr.ratingBasisPoints / 100 : null,
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

    const serialized = await Promise.all(rows.map(serializePublicManufacturer));
    res.json(serialized.filter((row) => row !== null));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch public manufacturers");
    res.status(500).json({ error: "Failed to fetch manufacturers" });
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

    const serialized = await serializePublicManufacturer(mfr);
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
