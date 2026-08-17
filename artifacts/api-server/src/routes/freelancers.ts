/**
 * Freelancer marketplace — public browsing + freelancer self-service profile.
 * Mounted at /api/freelancers.
 *
 * Public:        GET /            (list, filterable)
 *                GET /:id         (full profile)
 * Authenticated: GET /me          (own profile incl. Connect status)
 *                POST /apply      (create or update own profile)
 *                DELETE /me       (deactivate listing)
 */
import { Router } from "express";
import { db, freelancers, users } from "@workspace/db";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

export const FREELANCER_SERVICE_TYPES = [
  "graphic_design",
  "copywriting",
  "social_media",
  "photography",
  "video_editing",
  "web_design",
  "branding",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER_FIELDS = {
  name:            users.name,
  displayName:     users.displayName,
  avatarUrl:       users.avatarUrl,
  profileImageUrl: users.profileImageUrl,
  username:        users.username,
};

function shapeFreelancer(
  f: typeof freelancers.$inferSelect,
  u: { name?: string | null; displayName?: string | null; avatarUrl?: string | null; profileImageUrl?: string | null; username?: string | null } | null,
  opts: { includePrivate?: boolean } = {},
) {
  return {
    id:                  f.id,
    userId:              f.userId,
    name:                u?.displayName || u?.name || "Freelancer",
    username:            u?.username ?? null,
    avatarUrl:           u?.profileImageUrl || u?.avatarUrl || null,
    serviceType:         f.serviceType,
    skillTags:           f.skillTags ?? [],
    hourlyRateCents:     f.hourlyRateCents,
    bio:                 f.bio,
    portfolioUrls:       f.portfolioUrls ?? [],
    isActive:            f.isActive,
    totalJobsCompleted:  f.totalJobsCompleted,
    avgRatingTenths:     f.avgRatingTenths,
    /** Freelancer has begun Connect onboarding — hireable. */
    hasConnectedAccount: !!f.stripeAccountId,
    /** Connect account fully verified (charges + payouts enabled). */
    payoutsReady:        !!f.stripeAccountId && f.stripeAccountStatus === "active",
    createdAt:           f.createdAt,
    ...(opts.includePrivate
      ? { stripeAccountStatus: f.stripeAccountStatus ?? null }
      : {}),
  };
}

/**
 * GET /api/freelancers
 * Public list of active freelancers.
 * Query: serviceType, minRate (cents), maxRate (cents), available=true (has payout account)
 */
router.get("/", async (req, res) => {
  try {
    const { serviceType, minRate, maxRate, available } = req.query as Record<string, string | undefined>;

    const conds = [eq(freelancers.isActive, true)];
    if (serviceType && (FREELANCER_SERVICE_TYPES as readonly string[]).includes(serviceType)) {
      conds.push(eq(freelancers.serviceType, serviceType));
    }
    const min = minRate ? parseInt(minRate, 10) : NaN;
    const max = maxRate ? parseInt(maxRate, 10) : NaN;
    if (Number.isFinite(min)) conds.push(gte(freelancers.hourlyRateCents, min));
    if (Number.isFinite(max)) conds.push(lte(freelancers.hourlyRateCents, max));
    if (available === "true") conds.push(sql`${freelancers.stripeAccountId} IS NOT NULL`);

    const rows = await db
      .select({ freelancer: freelancers, user: USER_FIELDS })
      .from(freelancers)
      .leftJoin(users, eq(users.clerkId, freelancers.userId))
      .where(and(...conds))
      .orderBy(
        desc(freelancers.avgRatingTenths),
        desc(freelancers.totalJobsCompleted),
        desc(freelancers.createdAt),
      )
      .limit(100);

    res.json({ freelancers: rows.map((r) => shapeFreelancer(r.freelancer, r.user)) });
  } catch (err) {
    console.error("freelancers list:", err);
    res.status(500).json({ error: "Failed to load freelancers" });
  }
});

/**
 * GET /api/freelancers/me
 * The authenticated user's own freelancer profile (or { freelancer: null }).
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const [row] = await db
      .select({ freelancer: freelancers, user: USER_FIELDS })
      .from(freelancers)
      .leftJoin(users, eq(users.clerkId, freelancers.userId))
      .where(eq(freelancers.userId, clerkUserId))
      .limit(1);

    res.json({ freelancer: row ? shapeFreelancer(row.freelancer, row.user, { includePrivate: true }) : null });
  } catch (err) {
    console.error("freelancers me:", err);
    res.status(500).json({ error: "Failed to load your freelancer profile" });
  }
});

/**
 * POST /api/freelancers/apply
 * Create or update the authenticated user's freelancer profile.
 * Body: { serviceType, hourlyRateCents, bio?, skillTags?, portfolioUrls? }
 */
router.post("/apply", requireAuth, async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { serviceType, hourlyRateCents, bio = "", skillTags = [], portfolioUrls = [] } = req.body ?? {};

    if (!serviceType || !(FREELANCER_SERVICE_TYPES as readonly string[]).includes(serviceType)) {
      res.status(400).json({ error: `serviceType must be one of: ${FREELANCER_SERVICE_TYPES.join(", ")}` });
      return;
    }
    const rate = Number(hourlyRateCents);
    if (!Number.isInteger(rate) || rate < 100 || rate > 100_000_00) {
      res.status(400).json({ error: "hourlyRateCents must be an integer between 100 ($1/hr) and 10000000 ($100,000/hr)" });
      return;
    }
    const cleanBio = typeof bio === "string" ? bio.trim().slice(0, 2000) : "";

    if (!Array.isArray(portfolioUrls) || portfolioUrls.length > 4) {
      res.status(400).json({ error: "portfolioUrls must be an array of up to 4 links" });
      return;
    }
    const cleanUrls: string[] = [];
    for (const raw of portfolioUrls) {
      if (typeof raw !== "string") continue;
      let url = raw.trim().slice(0, 500);
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      cleanUrls.push(url);
    }

    const cleanTags: string[] = Array.isArray(skillTags)
      ? skillTags
          .filter((t: unknown): t is string => typeof t === "string")
          .map((t: string) => t.trim().slice(0, 40))
          .filter(Boolean)
          .slice(0, 10)
      : [];

    // User must exist (FK on users.clerk_id) — same requirement as seller Connect
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found — call /api/auth/sync first" });
      return;
    }

    const values = {
      userId:          clerkUserId,
      serviceType:     serviceType as string,
      hourlyRateCents: rate,
      bio:             cleanBio,
      skillTags:       cleanTags,
      portfolioUrls:   cleanUrls,
    };

    const [saved] = await db
      .insert(freelancers)
      .values(values)
      .onConflictDoUpdate({
        target: freelancers.userId,
        set: { ...values, isActive: true, updatedAt: new Date() },
      })
      .returning();

    const [u] = await db
      .select(USER_FIELDS)
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    res.status(201).json({ freelancer: shapeFreelancer(saved, u ?? null, { includePrivate: true }) });
  } catch (err) {
    console.error("freelancers apply:", err);
    res.status(500).json({ error: "Failed to save freelancer profile" });
  }
});

/**
 * DELETE /api/freelancers/me
 * Deactivate the authenticated user's listing (kept in DB for job history).
 */
router.delete("/me", requireAuth, async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const [updated] = await db
      .update(freelancers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(freelancers.userId, clerkUserId))
      .returning({ id: freelancers.id });

    if (!updated) {
      res.status(404).json({ error: "You don't have a freelancer profile" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("freelancers deactivate:", err);
    res.status(500).json({ error: "Failed to deactivate listing" });
  }
});

/**
 * GET /api/freelancers/:id
 * Public full profile (also returns inactive rows so job views keep working).
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Freelancer not found" });
      return;
    }
    const [row] = await db
      .select({ freelancer: freelancers, user: USER_FIELDS })
      .from(freelancers)
      .leftJoin(users, eq(users.clerkId, freelancers.userId))
      .where(eq(freelancers.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Freelancer not found" });
      return;
    }
    res.json({ freelancer: shapeFreelancer(row.freelancer, row.user) });
  } catch (err) {
    console.error("freelancers get:", err);
    res.status(500).json({ error: "Failed to load freelancer" });
  }
});

export default router;
