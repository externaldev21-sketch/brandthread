/**
 * Freelancer ratings come from real reviews of completed jobs:
 *  - only the hirer can rate, and only once the job is completed
 *  - re-posting edits the one review for that job
 *  - avg_rating_tenths / review_count are recomputed from all reviews
 *  - GET /api/freelancers?sort=rating orders by that real rating
 * Runs against the real test Postgres; Stripe is never reached.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("../../lib/stripe", () => ({
  stripe: null,
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  requireStripe: () => {
    throw new Error("Stripe should not be called by review routes");
  },
  computeApplicationFeeCents: (amount: number) => Math.round(amount * 0.05),
  PLATFORM_COMMISSION_RATE: 0.05,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"] ?? "";
    next();
  },
}));

import { db, freelancers, freelancerJobs, freelancerReviews } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import freelancerJobsRouter from "../freelancer-jobs";
import freelancersRouter from "../freelancers";
import { starsToTenths } from "../../lib/freelancerRatings";

const RUN = Math.random().toString(36).slice(2, 8);
const F1_USER = `user_test_rev_${RUN}_f1`;
const F2_USER = `user_test_rev_${RUN}_f2`;
const HIRER = `user_test_rev_${RUN}_hirer`;
const STRANGER = `user_test_rev_${RUN}_stranger`;
const ALL_USERS = [F1_USER, F2_USER, HIRER, STRANGER];

let server: import("node:http").Server;
let base = "";
let f1 = "";
let f2 = "";

async function call(path: string, opts: { method?: string; user?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", "x-test-user": opts.user ?? HIRER },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function seedJob(freelancerId: string, status: string) {
  const [job] = await db
    .insert(freelancerJobs)
    .values({
      freelancerId,
      sellerId: HIRER,
      title: `Review test job ${RUN}`,
      agreedPriceCents: 10_000,
      platformFeeCents: 500,
      freelancerPayoutCents: 9_500,
      status,
      paymentStatus: "paid",
    })
    .returning();
  return job;
}

beforeAll(async () => {
  for (const u of ALL_USERS) {
    await db.execute(
      sql`INSERT INTO users (clerk_id, email, name) VALUES (${u}, ${`${u}@test.local`}, ${u}) ON CONFLICT (clerk_id) DO NOTHING`,
    );
  }
  // Unique service type so the list assertions only see this run's rows.
  const [a] = await db
    .insert(freelancers)
    .values({ userId: F1_USER, serviceType: "photography", hourlyRateCents: 4_000, bio: RUN })
    .returning();
  const [b] = await db
    .insert(freelancers)
    .values({ userId: F2_USER, serviceType: "photography", hourlyRateCents: 9_000, bio: RUN })
    .returning();
  f1 = a.id;
  f2 = b.id;

  const app = express();
  app.use(express.json());
  app.use("/api/freelancer-jobs", freelancerJobsRouter);
  app.use("/api/freelancers", freelancersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  const ids = [f1, f2].filter(Boolean);
  if (ids.length) {
    await db.delete(freelancerReviews).where(inArray(freelancerReviews.freelancerId, ids));
    await db.delete(freelancerJobs).where(inArray(freelancerJobs.freelancerId, ids));
    await db.delete(freelancers).where(inArray(freelancers.id, ids));
  }
  await db.execute(sql`DELETE FROM users WHERE clerk_id IN (${F1_USER}, ${F2_USER}, ${HIRER}, ${STRANGER})`);
});

describe("starsToTenths", () => {
  it("accepts whole and half stars from 1 to 5 only", () => {
    expect(starsToTenths(5)).toBe(50);
    expect(starsToTenths(3.5)).toBe(35);
    expect(starsToTenths(1)).toBe(10);
    expect(starsToTenths(0)).toBeNull();
    expect(starsToTenths(5.5)).toBeNull();
    expect(starsToTenths(4.2)).toBeNull();
    expect(starsToTenths("5")).toBeNull();
    expect(starsToTenths(undefined)).toBeNull();
  });
});

describe("POST /api/freelancer-jobs/:id/review", () => {
  it("refuses to rate a job that isn't completed", async () => {
    const job = await seedJob(f1, "in_progress");
    const r = await call(`/api/freelancer-jobs/${job.id}/review`, { method: "POST", body: { rating: 5 } });
    expect(r.status).toBe(409);
  });

  it("only lets the hirer rate", async () => {
    const job = await seedJob(f1, "completed");
    const asFreelancer = await call(`/api/freelancer-jobs/${job.id}/review`, {
      method: "POST", user: F1_USER, body: { rating: 5 },
    });
    expect(asFreelancer.status).toBe(403);
    const asStranger = await call(`/api/freelancer-jobs/${job.id}/review`, {
      method: "POST", user: STRANGER, body: { rating: 5 },
    });
    expect(asStranger.status).toBe(403);
    const bad = await call(`/api/freelancer-jobs/${job.id}/review`, { method: "POST", body: { rating: 7 } });
    expect(bad.status).toBe(400);
  });

  it("stores the review, recomputes the average and edits on re-post", async () => {
    const jobA = await seedJob(f1, "completed");
    const jobB = await seedJob(f1, "completed");

    const r1 = await call(`/api/freelancer-jobs/${jobA.id}/review`, {
      method: "POST", body: { rating: 4, comment: "  Great work  " },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.review).toEqual({ ratingTenths: 40, comment: "Great work" });
    expect(r1.body.freelancer).toMatchObject({ avgRatingTenths: 40, reviewCount: 1 });

    const r2 = await call(`/api/freelancer-jobs/${jobB.id}/review`, { method: "POST", body: { rating: 5 } });
    expect(r2.body.freelancer).toMatchObject({ avgRatingTenths: 45, reviewCount: 2 });

    // Re-posting edits the one review for that job (no duplicate).
    const r3 = await call(`/api/freelancer-jobs/${jobA.id}/review`, { method: "POST", body: { rating: 3 } });
    expect(r3.status).toBe(200);
    expect(r3.body.freelancer).toMatchObject({ avgRatingTenths: 40, reviewCount: 2 });

    const [row] = await db.select().from(freelancers).where(eq(freelancers.id, f1));
    expect(row.avgRatingTenths).toBe(40);
    expect(row.reviewCount).toBe(2);

    // The hirer sees their review on the job.
    const job = await call(`/api/freelancer-jobs/${jobA.id}`);
    expect(job.body.job.review).toEqual({ ratingTenths: 30, comment: "" });
    const list = await call(`/api/freelancer-jobs`);
    const listed = list.body.asHirer.find((j: any) => j.id === jobB.id);
    expect(listed.review).toEqual({ ratingTenths: 50, comment: "" });

    // Public reviews list for the profile.
    const pub = await call(`/api/freelancers/${f1}/reviews`);
    expect(pub.status).toBe(200);
    expect(pub.body.reviews.map((x: any) => x.ratingTenths).sort()).toEqual([30, 50]);
  });

  it("sort=rating orders freelancers by their real rating", async () => {
    const job = await seedJob(f2, "completed");
    await call(`/api/freelancer-jobs/${job.id}/review`, { method: "POST", body: { rating: 5 } });

    const mine = (rows: any[]) => rows.filter((f) => f.id === f1 || f.id === f2).map((f) => f.id);

    const byRating = await call(`/api/freelancers?serviceType=photography&sort=rating`);
    expect(byRating.status).toBe(200);
    expect(mine(byRating.body.freelancers)).toEqual([f2, f1]); // 5.0 before 4.0
    const f2Row = byRating.body.freelancers.find((f: any) => f.id === f2);
    expect(f2Row).toMatchObject({ avgRatingTenths: 50, reviewCount: 1 });

    const cheapest = await call(`/api/freelancers?serviceType=photography&sort=rate_asc`);
    expect(mine(cheapest.body.freelancers)).toEqual([f1, f2]);
  });
});
