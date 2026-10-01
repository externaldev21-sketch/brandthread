import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * One row per store transaction that bought a Boost or Create-ad budget
 * through RevenueCat (Guideline 3.1.1). The unique transaction id makes the
 * grant idempotent across webhook delivery and client verification.
 */
export const iapPromotionPurchases = pgTable("iap_promotion_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: text("transaction_id").notNull(),
  appUserId: text("app_user_id").notNull(),
  productId: text("product_id").notNull(),
  kind: text("kind").notNull(), // 'boost' | 'ad_campaign'
  amountCents: integer("amount_cents").notNull(),
  targetId: text("target_id"),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  source: text("source").notNull(), // 'webhook' | 'client_verify'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  transactionUnique: uniqueIndex("iap_promotion_purchases_transaction_unique").on(table.transactionId),
  userIdx: index("iap_promotion_purchases_user_idx").on(table.appUserId, table.createdAt),
}));
