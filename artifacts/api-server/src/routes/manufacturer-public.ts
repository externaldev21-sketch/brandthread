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
import crypto from "crypto";

const router = Router();

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
  contactEmail:    manufacturers.contactEmail,
  contactPhone:    manufacturers.contactPhone,
  priceRange:      manufacturers.priceRange,
  sampleTurnaround: manufacturers.sampleTurnaround,
  bulkTurnaround:  manufacturers.bulkTurnaround,
  verifiedAt:      manufacturers.verifiedAt,
  createdAt:       manufacturers.createdAt,
  updatedAt:       manufacturers.updatedAt,
};

function serializePublicManufacturer(mfr: typeof publicManufacturerFields extends infer _T ? any : never) {
  return {
    ...mfr,
    isVerified: !!mfr.verifiedAt,
    verifiedAt: mfr.verifiedAt?.toISOString() ?? null,
    createdAt: mfr.createdAt.toISOString(),
    updatedAt: mfr.updatedAt.toISOString(),
  };
}

// ── GET /api/manufacturers/public ─────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { q, country, specialty } = req.query as Record<string, string>;

    const conditions = [
      eq(manufacturers.isPublicDirectory, true),
      eq(manufacturers.status, "active"),
    ];

    if (country) {
      conditions.push(eq(manufacturers.country, country));
    }

    if (q) {
      const like = `%${q}%`;
      conditions.push(
        or(
          ilike(manufacturers.businessName, like),
          ilike(manufacturers.specialty, like),
          ilike(manufacturers.description, like),
          ilike(manufacturers.country, like),
        )!,
      );
    }

    if (specialty) {
      conditions.push(ilike(manufacturers.specialty, `%${specialty}%`));
    }

    const rows = await db
      .select(publicManufacturerFields)
      .from(manufacturers)
      .where(and(...conditions))
      .orderBy(sql`${manufacturers.verifiedAt} DESC NULLS LAST, ${manufacturers.createdAt} DESC`);

    res.json(rows.map(serializePublicManufacturer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch manufacturers" });
  }
});

// ── POST /api/manufacturers/public/apply ──────────────────────────────────────
// No Clerk auth — public application form submission.
// Sets status = 'active' and isPublicDirectory = true immediately.

router.post("/apply", async (req, res) => {
  try {
    const {
      businessName, country, city, specialty, description,
      yearsInBusiness, photos, website, contactEmail,
      moq, priceRange, bulkTurnaround, sampleTurnaround,
    } = req.body;

    if (!businessName || typeof businessName !== "string") {
      res.status(400).json({ error: "businessName is required" }); return;
    }
    if (!country || typeof country !== "string") {
      res.status(400).json({ error: "country is required" }); return;
    }
    if (!specialty || typeof specialty !== "string") {
      res.status(400).json({ error: "specialty is required" }); return;
    }

    const [mfr] = await db
      .insert(manufacturers)
      .values({
        // clerkId is null for public applications — claimed later
        businessName: businessName.trim(),
        country:      country.trim(),
        city:         city?.trim() ?? null,
        specialty:    specialty.trim(),
        description:  description?.trim() ?? null,
        yearsInBusiness: Number(yearsInBusiness) || 0,
        photos:       Array.isArray(photos) ? photos : [],
        website:      website?.trim() ?? null,
        contactEmail: contactEmail?.trim() ?? null,
        moq:          Number(moq) || 100,
        priceRange:   priceRange?.trim() ?? "",
        bulkTurnaround:  bulkTurnaround?.trim() ?? "",
        sampleTurnaround: sampleTurnaround?.trim() ?? "",
        status:            "active",     // immediately live
        isPublicDirectory: true,
      })
      .returning();

    res.status(201).json({
      ...mfr,
      verifiedAt: null,
      createdAt:  mfr.createdAt.toISOString(),
      updatedAt:  mfr.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Application failed" });
  }
});

// ── GET /api/manufacturers/public/:id ─────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
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

    res.json(serializePublicManufacturer(mfr));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch manufacturer" });
  }
});

export default router;
