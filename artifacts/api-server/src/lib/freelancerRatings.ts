/**
 * Freelancer ratings — computed from real reviews of completed jobs.
 *
 * freelancers.avg_rating_tenths / review_count are a denormalised cache of
 * freelancer_reviews (joined to completed freelancer_jobs) so the marketplace
 * list can sort by rating on an indexed-friendly column. They are recomputed
 * from scratch after every review write, never incremented, so they can't
 * drift.
 */
import { db, freelancers, freelancerJobs, freelancerReviews } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

/** 1–5 stars (half stars allowed) → stored tenths (10–50). null when invalid. */
export function starsToTenths(stars: unknown): number | null {
  if (typeof stars !== "number" || !Number.isFinite(stars)) return null;
  const halfSteps = Math.round(stars * 2) / 2;
  if (Math.abs(halfSteps - stars) > 1e-9) return null;
  if (halfSteps < 1 || halfSteps > 5) return null;
  return Math.round(halfSteps * 10);
}

/** Recompute and store a freelancer's average rating + review count. */
export async function recomputeFreelancerRating(
  freelancerId: string,
): Promise<{ avgRatingTenths: number; reviewCount: number }> {
  const [agg] = await db
    .select({
      avg: sql<number>`COALESCE(ROUND(AVG(${freelancerReviews.ratingTenths})), 0)::int`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(freelancerReviews)
    .innerJoin(
      freelancerJobs,
      and(eq(freelancerJobs.id, freelancerReviews.jobId), eq(freelancerJobs.status, "completed")),
    )
    .where(eq(freelancerReviews.freelancerId, freelancerId));

  const avgRatingTenths = Number(agg?.avg ?? 0);
  const reviewCount = Number(agg?.count ?? 0);
  await db
    .update(freelancers)
    .set({ avgRatingTenths, reviewCount, updatedAt: new Date() })
    .where(eq(freelancers.id, freelancerId));
  return { avgRatingTenths, reviewCount };
}

export const FREELANCER_SORTS = ["rating", "jobs", "rate_asc", "rate_desc", "newest"] as const;
export type FreelancerSort = (typeof FREELANCER_SORTS)[number];

export function parseFreelancerSort(value: unknown): FreelancerSort {
  return (FREELANCER_SORTS as readonly string[]).includes(value as string)
    ? (value as FreelancerSort)
    : "rating";
}
