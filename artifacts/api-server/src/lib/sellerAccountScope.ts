/**
 * Seller Settings → Account reach (mobile app/seller-settings.tsx): "Global
 * account" or "United States only", stored as seller_settings.accountScope.
 * A US-only seller doesn't sell outside the US, so every checkout path and the
 * shipping quote treat a non-US destination as one the seller doesn't ship to.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const ACCOUNT_SCOPES = ["global", "us"] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];

export function isAccountScope(value: unknown): value is AccountScope {
  return (ACCOUNT_SCOPES as readonly unknown[]).includes(value);
}

/** Pure: may a seller with this scope sell to this destination country? */
export function scopeAllowsCountry(scope: unknown, country: string | null | undefined): boolean {
  if (scope !== "us") return true;
  return String(country ?? "").trim().toUpperCase() === "US";
}

export async function sellerAccountScope(sellerId: string): Promise<AccountScope> {
  const result = await db.execute(sql`SELECT settings->>'accountScope' AS scope FROM seller_settings WHERE owner_id = ${sellerId} LIMIT 1`);
  const scope = (result.rows[0] as { scope?: unknown } | undefined)?.scope;
  return isAccountScope(scope) ? scope : "global";
}

/** True when the seller's Account reach rules out shipping to `country`. */
export async function sellerScopeRefusesDestination(sellerId: string, country: string | null | undefined): Promise<boolean> {
  return !scopeAllowsCountry(await sellerAccountScope(sellerId), country);
}
