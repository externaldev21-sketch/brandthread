import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Admin money tools (migration 456) ───────────────────────────────────────
// Payout controls for connected accounts: the new-account payout delay, an
// admin hold, and their release. Written only by api-server
// lib/admin/payoutControls.ts.

export type PayoutControlState = "new_account_delay" | "held" | "released";
export type PayoutPartyType = "seller" | "manufacturer";

export const payoutControls = pgTable("payout_controls", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  partyType: text("party_type").$type<PayoutPartyType>().notNull(),
  /** Seller Clerk id, or manufacturers.id. */
  partyId: text("party_id").notNull(),
  stripeAccountId: text("stripe_account_id"),
  state: text("state").$type<PayoutControlState>().notNull().default("new_account_delay"),
  delayDays: integer("delay_days"),
  /** When the new-account delay steps down to Stripe's minimum. */
  delayUntil: timestamp("delay_until", { withTimezone: true }),
  /** The Stripe schedule in force before an admin hold, restored on release. */
  previousSchedule: jsonb("previous_schedule").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  heldBy: text("held_by"),
  heldAt: timestamp("held_at", { withTimezone: true }),
  releasedBy: text("released_by"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  partyUnique: unique("payout_controls_party_unique").on(t.partyType, t.partyId),
  stateIdx: index("payout_controls_state_idx").on(t.state, t.delayUntil),
}));
