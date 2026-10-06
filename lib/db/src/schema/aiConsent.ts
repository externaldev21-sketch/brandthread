import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per account: whether the person allowed Brandthread to send the
 * photos, prompts and product details they use in AI tools to the AI
 * providers (App Store 5.1.2(i), QA-0043). Withdrawing keeps the row with
 * granted_at = NULL so the history of the decision is not lost.
 */
export const aiDataConsents = pgTable("ai_data_consents", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  /** Version of the disclosure the person agreed to (lib/aiConsent.ts). */
  version: text("version").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
