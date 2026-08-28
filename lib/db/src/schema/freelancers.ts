import { pgTable, uuid, text, integer, timestamp, json, boolean, index } from 'drizzle-orm/pg-core';

// ─── Freelancer Marketplace (Community tab) ──────────────────────────────────
// Escrow payment model: the hirer pays the full agreed price via Stripe
// Checkout (charge lands on the platform account). The 5% platform fee
// (PLATFORM_COMMISSION_RATE) is recorded on the job at creation; the net
// amount is transferred to the freelancer's Connect Express account with
// stripe.transfers.create when the job is marked complete.

// One freelancer profile per user, keyed on the Clerk user id.
// (FK to users.clerk_id lives in SQL migration 021 — kept out of Drizzle to
// avoid a circular import with schema/index.ts, same as manufacturers.ts.)
export const freelancers = pgTable('freelancers', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  userId:              text('user_id').notNull().unique(),
  // 'graphic_design' | 'copywriting' | 'social_media' | 'photography'
  // | 'video_editing' | 'web_design' | 'branding'
  serviceType:         text('service_type').notNull(),
  skillTags:           json('skill_tags').$type<string[]>().notNull().default([]),
  hourlyRateCents:     integer('hourly_rate_cents').notNull().default(0),
  bio:                 text('bio').notNull().default(''),
  portfolioUrls:       json('portfolio_urls').$type<string[]>().notNull().default([]),
  // Stripe Connect Express — freelancer receives payouts here
  stripeAccountId:     text('stripe_account_id'),
  stripeAccountStatus: text('stripe_account_status'), // 'pending' | 'active' | 'restricted'
  isActive:            boolean('is_active').notNull().default(true),
  totalJobsCompleted:  integer('total_jobs_completed').notNull().default(0),
  avgRatingTenths:     integer('avg_rating_tenths').notNull().default(0), // 0 = unrated; 10–50 = 1.0–5.0
  createdAt:           timestamp('created_at').defaultNow().notNull(),
  updatedAt:           timestamp('updated_at').defaultNow().notNull(),
});

// Job lifecycle: pending → accepted → in_progress → completed.
// Cancellation allowed from pending/accepted only (refunds the payment).
export const freelancerJobs = pgTable('freelancer_jobs', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  freelancerId:            uuid('freelancer_id').notNull().references(() => freelancers.id, { onDelete: 'cascade' }),
  sellerId:                text('seller_id').notNull(), // Clerk user id of the hirer
  title:                   text('title').notNull(),
  description:             text('description').notNull().default(''),
  agreedPriceCents:        integer('agreed_price_cents').notNull(),
  status:                  text('status').notNull().default('pending'),        // pending | accepted | in_progress | completed | cancelled
  paymentStatus:           text('payment_status').notNull().default('unpaid'), // unpaid | paid | refunded
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  stripePaymentIntentId:   text('stripe_payment_intent_id'),
  stripeTransferId:        text('stripe_transfer_id'), // set when the completion payout is sent
  platformFeeCents:        integer('platform_fee_cents').notNull().default(0),
  freelancerPayoutCents:   integer('freelancer_payout_cents').notNull().default(0),
  completedAt:             timestamp('completed_at'),
  createdAt:               timestamp('created_at').defaultNow().notNull(),
  updatedAt:               timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  freelancerIdx: index('freelancer_jobs_freelancer_idx').on(table.freelancerId),
}));

// Reviews — schema only for now (no UI in this iteration).
export const freelancerReviews = pgTable('freelancer_reviews', {
  id:             uuid('id').primaryKey().defaultRandom(),
  jobId:          uuid('job_id').notNull().unique().references(() => freelancerJobs.id, { onDelete: 'cascade' }),
  freelancerId:   uuid('freelancer_id').notNull().references(() => freelancers.id, { onDelete: 'cascade' }),
  reviewerUserId: text('reviewer_user_id').notNull(), // Clerk user id
  ratingTenths:   integer('rating_tenths').notNull(), // 1–50 (CHECK constraint in SQL)
  comment:        text('comment').notNull().default(''),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  freelancerIdx: index('freelancer_reviews_freelancer_idx').on(table.freelancerId),
}));
