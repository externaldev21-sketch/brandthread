/**
 * Data for the seller-branded buyer receipt (lib/brandthreadEmail.ts
 * renderOrderReceiptHtml) and the store header on the shipping / return
 * emails. Reads only what the order rows already hold:
 *   - store: the seller's users row (orders.owner_id = users.clerk_id)
 *   - thumbnails: products.images of each order item's variant
 *   - gift card: the gift-card ledger for the order's checkout session
 * Images are kept only when they are absolute https URLs; object-storage
 * paths would need a short-lived signed URL, which is wrong for an email
 * that is read days later, so those fall back to the Brandthread mark /
 * an empty thumbnail frame.
 */
import { checkoutSessions, db, orders, productVariants, products, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { EmailStoreBranding } from "./brandthreadEmail";
import { giftCentsForCheckouts } from "./giftCards/service";

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https:\/\//i.test(trimmed) ? trimmed : null;
}

type StoreRow = {
  brandName: string | null;
  displayName: string | null;
  name: string | null;
  logoUrl: string | null;
  profileImageUrl: string | null;
  contactEmail: string | null;
};

export function storeBrandingFromRow(row: StoreRow | null | undefined): EmailStoreBranding | null {
  if (!row) return null;
  const name = row.brandName?.trim() || row.displayName?.trim() || row.name?.trim() || "";
  if (!name) return null;
  return {
    name,
    logoUrl: httpsUrl(row.logoUrl) ?? httpsUrl(row.profileImageUrl),
    contactEmail: row.contactEmail?.trim() || null,
  };
}

const storeColumns = {
  brandName: users.brandName,
  displayName: users.displayName,
  name: users.name,
  logoUrl: users.logoUrl,
  profileImageUrl: users.profileImageUrl,
  contactEmail: users.contactEmail,
};

/** The seller's store branding for an order, or null (falls back to Brandthread). */
export async function loadStoreBrandingForOrder(orderId: string): Promise<EmailStoreBranding | null> {
  const [row] = await db
    .select(storeColumns)
    .from(orders)
    .innerJoin(users, eq(users.clerkId, orders.ownerId))
    .where(eq(orders.id, orderId))
    .limit(1);
  return storeBrandingFromRow(row);
}

/** Never throws: email branding is cosmetic and must not block a send. */
export async function loadStoreBrandingForOrderSafe(orderId: string): Promise<EmailStoreBranding | null> {
  try {
    return await loadStoreBrandingForOrder(orderId);
  } catch {
    return null;
  }
}

export async function loadReceiptExtras(input: {
  ownerId: string;
  variantIds: Array<string | null>;
  stripeCheckoutSessionId: string | null;
}): Promise<{
  store: EmailStoreBranding | null;
  imageByVariant: Map<string, string>;
  giftCardCents: number;
}> {
  const [storeRow] = input.ownerId
    ? await db.select(storeColumns).from(users).where(eq(users.clerkId, input.ownerId)).limit(1)
    : [];

  const imageByVariant = new Map<string, string>();
  const variantIds = [...new Set(input.variantIds.filter((id): id is string => Boolean(id)))];
  if (variantIds.length > 0) {
    const rows = await db
      .select({ variantId: productVariants.id, images: products.images })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds));
    for (const row of rows) {
      const first = Array.isArray(row.images) ? row.images.map(httpsUrl).find(Boolean) : null;
      if (first) imageByVariant.set(row.variantId, first);
    }
  }

  let giftCardCents = 0;
  if (input.stripeCheckoutSessionId) {
    const [checkout] = await db
      .select({ id: checkoutSessions.id })
      .from(checkoutSessions)
      .where(eq(checkoutSessions.stripeSessionId, input.stripeCheckoutSessionId))
      .limit(1);
    if (checkout) {
      giftCardCents = Math.max(0, (await giftCentsForCheckouts(db, [checkout.id])).get(checkout.id) ?? 0);
    }
  }

  return { store: storeBrandingFromRow(storeRow), imageByVariant, giftCardCents };
}
