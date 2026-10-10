import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Which login owns which profile (migration 270). A login is the Clerk user
 * someone signs in with; it may own at most one live buyer and one live
 * seller profile. Accounts that never added a second profile have no rows.
 */
export const accountProfiles = pgTable("account_profiles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  loginClerkId: text("login_clerk_id").notNull(),
  profileClerkId: text("profile_clerk_id").notNull(),
  role: text("role").notNull(), // 'buyer' | 'seller'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => ({
  profileUnique: uniqueIndex("account_profiles_profile_unique").on(table.profileClerkId),
  loginRoleUnique: uniqueIndex("account_profiles_login_role_unique")
    .on(table.loginClerkId, table.role)
    .where(sql`${table.deletedAt} IS NULL`),
  loginIdx: index("account_profiles_login_idx").on(table.loginClerkId),
}));
