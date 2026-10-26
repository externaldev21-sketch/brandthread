/**
 * Store Settings (mobile app/store-settings.tsx) keys that mean something
 * outside the storefronts.storeSettings JSON they are saved in. Each one is
 * written through to the setting that is actually enforced, and read back from
 * it, so the screen never shows a switch that does nothing:
 *
 *   storeStatus             → storefronts.status (published / draft: what the
 *                             public store routes serve; "Password protected"
 *                             is published behind the store password)
 *   language                → seller_settings.storeLanguage (checkout language)
 *   checkoutRequireAccount,
 *   checkoutGuestAllowed    → seller_settings.checkoutMode (enforced at checkout)
 *   orderNotifications      → the seller's `new_orders` notification category
 *   analyticsEnabled        → read by the public store page: off = no
 *                             attribution script or pixels
 */
import { eq, sql } from "drizzle-orm";
import { db, storefronts, users } from "@workspace/db";
import { STORE_LANGUAGES, type CheckoutMode, type StoreLanguage } from "./sellerCheckoutSettings";

type Settings = Record<string, unknown>;

const LIVE_STATUSES = new Set(["published", "password_protected"]);

/** storefronts.status for a Store Settings status chip. */
export function storefrontStatusFor(storeStatus: unknown): "published" | "draft" | null {
  if (typeof storeStatus !== "string") return null;
  return LIVE_STATUSES.has(storeStatus) ? "published" : "draft";
}

/** The checkout mode the two Store Settings switches ask for, keeping "guest only" when they allow it. */
export function checkoutModeFor(requireAccount: unknown, guestAllowed: unknown, current: CheckoutMode): CheckoutMode {
  if (requireAccount === true || guestAllowed === false) return "accounts_required";
  return current === "guest_only" ? "guest_only" : "accounts_optional";
}

const changed = (before: Settings, after: Settings, key: string) => key in after && after[key] !== before[key];

async function readSellerSettings(ownerId: string): Promise<Settings> {
  const result = await db.execute(sql`SELECT settings FROM seller_settings WHERE owner_id = ${ownerId} LIMIT 1`);
  const settings = (result.rows[0] as { settings?: unknown } | undefined)?.settings;
  return settings && typeof settings === "object" ? settings as Settings : {};
}

async function mergeSellerSettings(ownerId: string, patch: Settings): Promise<void> {
  await db.execute(sql`
    INSERT INTO seller_settings (owner_id, settings, updated_at)
    VALUES (${ownerId}, ${JSON.stringify(patch)}::jsonb, now())
    ON CONFLICT (owner_id) DO UPDATE
      SET settings = seller_settings.settings || ${JSON.stringify(patch)}::jsonb, updated_at = now()
  `);
}

/**
 * Writes the enforced settings for keys that changed in this save. Returns
 * the storefront columns to set in the same update (status / publishedAt).
 */
export async function applyStoreSettingsEffects(
  ownerId: string,
  sf: { status: string; publishedAt: Date | null; storeSettings?: unknown },
  after: Settings,
): Promise<Partial<typeof storefronts.$inferInsert>> {
  const before = (sf.storeSettings && typeof sf.storeSettings === "object" ? sf.storeSettings : {}) as Settings;
  const columns: Partial<typeof storefronts.$inferInsert> = {};

  if (changed(before, after, "storeStatus")) {
    const status = storefrontStatusFor(after.storeStatus);
    if (status && status !== sf.status) {
      columns.status = status;
      if (status === "published" && !sf.publishedAt) columns.publishedAt = new Date();
    }
  }

  const sellerPatch: Settings = {};
  if (changed(before, after, "language") && (STORE_LANGUAGES as readonly unknown[]).includes(after.language)) {
    sellerPatch.storeLanguage = after.language as StoreLanguage;
  }
  if (changed(before, after, "checkoutRequireAccount") || changed(before, after, "checkoutGuestAllowed")) {
    const current = (await readSellerSettings(ownerId)).checkoutMode as CheckoutMode | undefined;
    sellerPatch.checkoutMode = checkoutModeFor(after.checkoutRequireAccount, after.checkoutGuestAllowed, current ?? "accounts_optional");
  }
  if (Object.keys(sellerPatch).length) await mergeSellerSettings(ownerId, sellerPatch);

  if (changed(before, after, "orderNotifications") && typeof after.orderNotifications === "boolean") {
    await db.update(users).set({
      notificationPreferences: sql`(COALESCE(${users.notificationPreferences}::jsonb, '{}'::jsonb) || ${JSON.stringify({ new_orders: after.orderNotifications })}::jsonb)::json`,
    }).where(eq(users.clerkId, ownerId));
  }
  return columns;
}

/**
 * The storeSettings the seller sees: the stored JSON with the written-through
 * keys replaced by the values that are actually in force.
 */
export async function effectiveStoreSettings(
  ownerId: string,
  sf: { status: string; storeSettings?: unknown },
): Promise<Settings> {
  const stored = (sf.storeSettings && typeof sf.storeSettings === "object" ? sf.storeSettings : {}) as Settings;
  const { storePassword: _never, ...out }: Settings = { ...stored };
  const live = sf.status === "published";
  if (live && !LIVE_STATUSES.has(String(stored.storeStatus))) out.storeStatus = "published";
  if (!live && LIVE_STATUSES.has(String(stored.storeStatus))) out.storeStatus = "unpublished";

  const seller = await readSellerSettings(ownerId);
  if ((STORE_LANGUAGES as readonly unknown[]).includes(seller.storeLanguage)) out.language = seller.storeLanguage;
  if (typeof seller.checkoutMode === "string") {
    out.checkoutRequireAccount = seller.checkoutMode === "accounts_required";
    out.checkoutGuestAllowed = seller.checkoutMode !== "accounts_required";
  }
  const [row] = await db.select({ prefs: users.notificationPreferences }).from(users).where(eq(users.clerkId, ownerId)).limit(1);
  const newOrders = (row?.prefs as Settings | null | undefined)?.new_orders;
  if (typeof newOrders === "boolean") out.orderNotifications = newOrders;
  return out;
}

/** Store Settings → Analytics: off keeps attribution and pixels off the public store page. */
export function storeAnalyticsEnabled(sf: { storeSettings?: unknown }): boolean {
  const settings = sf.storeSettings && typeof sf.storeSettings === "object" ? sf.storeSettings as Settings : {};
  return settings.analyticsEnabled !== false;
}
