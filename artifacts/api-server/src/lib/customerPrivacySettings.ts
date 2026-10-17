/**
 * Seller "Customer privacy" settings, persisted in
 * seller_settings.settings->'customerPrivacy' (migration 270) and written by
 * the app through PATCH /api/seller/settings.
 *
 *  - maskContactInExports: store data exports (POST /api/seller/export) leave
 *    out customer email, phone and street address, and order shipping
 *    addresses / guest emails, so a downloaded file can be shared without
 *    exposing buyers' contact details.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface CustomerPrivacySettings {
  maskContactInExports: boolean;
}

export const DEFAULT_CUSTOMER_PRIVACY: CustomerPrivacySettings = {
  maskContactInExports: false,
};

export function normalizeCustomerPrivacy(input: unknown): CustomerPrivacySettings {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    maskContactInExports: typeof raw.maskContactInExports === "boolean"
      ? raw.maskContactInExports
      : DEFAULT_CUSTOMER_PRIVACY.maskContactInExports,
  };
}

export async function loadCustomerPrivacy(ownerId: string): Promise<CustomerPrivacySettings> {
  const result = await db.execute(sql`
    SELECT settings->'customerPrivacy' AS cp FROM seller_settings WHERE owner_id = ${ownerId}
  `);
  return normalizeCustomerPrivacy((result.rows[0] as { cp?: unknown } | undefined)?.cp);
}

const CUSTOMER_CONTACT_FIELDS = ["email", "phone", "address"] as const;
const ORDER_CONTACT_FIELDS = ["shippingAddress", "guestEmail"] as const;

/** Copies of export rows with buyer contact fields removed. */
export function maskExportRows(
  kind: "customers" | "orders",
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const fields: readonly string[] = kind === "customers" ? CUSTOMER_CONTACT_FIELDS : ORDER_CONTACT_FIELDS;
  return rows.map((row) => {
    const copy = { ...row };
    for (const f of fields) delete copy[f];
    return copy;
  });
}
