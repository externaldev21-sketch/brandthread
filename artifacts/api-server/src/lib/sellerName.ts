import { sql } from "drizzle-orm";
import { users } from "@workspace/db";

/**
 * The one public name for a seller: the business name onboarding saved
 * (users.brand_name), falling back to the person's display name only for
 * accounts that never set one. Every `sellerDisplayName` a buyer sees (product
 * cards, product page, order history) selects this, so a store reads the same
 * on every surface instead of showing the owner's personal name in some.
 */
export const sellerNameSql = sql<string | null>`COALESCE(NULLIF(btrim(${users.brandName}), ''), ${users.displayName})`;

