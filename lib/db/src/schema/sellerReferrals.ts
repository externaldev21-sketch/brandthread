import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export type SellerReferralReward = {
  method: "stripe_balance" | "app_store_manual" | "capped" | "none";
  amountCents: number;
  currency: string | null;
  reference: string | null;
};

/** Seller-to-seller referrals (BT-313). Migration 460. */
export const sellerReferrals = pgTable("seller_referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  inviterId: text("inviter_id").notNull(),
  inviteeId: text("invitee_id").notNull(),
  inviteCode: text("invite_code").notNull(),
  source: text("source").notNull().default("link"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  inviterReward: jsonb("inviter_reward").$type<SellerReferralReward | null>(),
  inviteeReward: jsonb("invitee_reward").$type<SellerReferralReward | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  inviteeUnique: uniqueIndex("seller_referrals_invitee_unique").on(t.inviteeId),
  inviterIdx: index("seller_referrals_inviter_idx").on(t.inviterId, t.status),
}));
