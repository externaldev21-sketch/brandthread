/**
 * Store language — the language a seller writes their storefront/listing
 * content in, saved from the mobile "Store language" screen as
 * seller_settings.settings.storeLanguage.
 *
 * It is a language TAG only (html lang / listing metadata). Brandthread does
 * not translate any UI or content into it.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** The codes the mobile Store language screen offers (BCP-47 primary tags). */
export const STORE_LANGUAGE_CODES = ["en", "es", "fr", "de", "pt", "zh", "ja", "ko", "ar", "it"] as const;
export type StoreLanguage = (typeof STORE_LANGUAGE_CODES)[number];
export const DEFAULT_STORE_LANGUAGE: StoreLanguage = "en";

export function isStoreLanguage(value: unknown): value is StoreLanguage {
  return typeof value === "string" && (STORE_LANGUAGE_CODES as readonly string[]).includes(value);
}

/** Any stored value -> a safe, known tag (unknown/missing -> "en"). */
export function normalizeStoreLanguage(value: unknown): StoreLanguage {
  if (typeof value !== "string") return DEFAULT_STORE_LANGUAGE;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isStoreLanguage(primary) ? primary : DEFAULT_STORE_LANGUAGE;
}

/** The seller's saved store language, never throwing (falls back to "en"). */
export async function getStoreLanguage(ownerId: string): Promise<StoreLanguage> {
  try {
    const result = await db.execute(sql`
      SELECT settings->>'storeLanguage' AS store_language
      FROM seller_settings
      WHERE owner_id = ${ownerId}
      LIMIT 1
    `);
    const row = result.rows[0] as { store_language?: unknown } | undefined;
    return normalizeStoreLanguage(row?.store_language);
  } catch {
    return DEFAULT_STORE_LANGUAGE;
  }
}
