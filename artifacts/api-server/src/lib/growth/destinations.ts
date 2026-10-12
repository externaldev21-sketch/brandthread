import { db, products, storefronts, users, bioPages, trackedLinks } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getWebOrigin } from "../webOrigin";
import { buildDestinationUrl, type UtmFields } from "./utm";

export const shortLinkUrl = (code: string) => `${getWebOrigin()}/l/${code}`;
export const bioPageUrl = (slug: string) => `${getWebOrigin()}/bio/${slug}`;
/** The seller's store website — the one store link shown everywhere. */
export const storeSiteUrl = (username: string) => `${getWebOrigin()}/@${username.toLowerCase()}`;

/** brandthread.app/@username for a seller who has a username, else null. */
export async function resolveStoreSiteUrl(sellerId: string): Promise<string | null> {
  const [u] = await db.select({
    username: users.username, accountType: users.accountType, deletedAt: users.deletedAt, suspendedAt: users.suspendedAt,
  }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  const seller = u?.accountType === "seller" || u?.accountType === "both";
  return u?.username && seller && !u.deletedAt && !u.suspendedAt ? storeSiteUrl(u.username) : null;
}

/**
 * Public URL of the seller's store: their store website (brandthread.app/@username)
 * when the page is on, else the published web store, else their profile page.
 */
export async function resolveStoreHome(sellerId: string): Promise<string | null> {
  const origin = getWebOrigin();
  const [bio] = await db.select({ published: bioPages.published }).from(bioPages).where(eq(bioPages.sellerId, sellerId)).limit(1);
  if (!bio || bio.published) {
    const site = await resolveStoreSiteUrl(sellerId);
    if (site) return site;
  }
  const [sf] = await db.select({ slug: storefronts.slug, status: storefronts.status })
    .from(storefronts).where(eq(storefronts.ownerId, sellerId)).limit(1);
  if (sf && sf.status === "published") return `${origin}/api/store/site/${encodeURIComponent(sf.slug)}`;
  const [u] = await db.select({ username: users.username, deletedAt: users.deletedAt, suspendedAt: users.suspendedAt })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  if (u?.username && !u.deletedAt && !u.suspendedAt) return `${origin}/u/${encodeURIComponent(u.username)}`;
  return null;
}

export async function resolveProductUrl(sellerId: string, productId: string): Promise<string | null> {
  const [p] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
    .limit(1);
  return p ? `${getWebOrigin()}/store/product/${p.id}` : null;
}

export async function resolveBioUrl(sellerId: string): Promise<string | null> {
  const [b] = await db.select({ slug: bioPages.slug, published: bioPages.published })
    .from(bioPages).where(eq(bioPages.sellerId, sellerId)).limit(1);
  if (!b || !b.published) return null;
  return (await resolveStoreSiteUrl(sellerId)) ?? bioPageUrl(b.slug);
}

type LinkRow = typeof trackedLinks.$inferSelect;

/** Final redirect target for a tracked link (destination + UTM + code), or null if the destination is gone. */
export async function resolveTrackedLinkTarget(link: LinkRow): Promise<string | null> {
  let base: string | null = null;
  if (link.destinationType === "product" && link.destinationRef) {
    base = (await resolveProductUrl(link.sellerId, link.destinationRef)) ?? (await resolveStoreHome(link.sellerId));
  } else if (link.destinationType === "bio") {
    base = await resolveBioUrl(link.sellerId);
  } else {
    base = await resolveStoreHome(link.sellerId);
  }
  if (!base) return null;
  const utm: UtmFields = {
    source: link.utmSource, medium: link.utmMedium, campaign: link.utmCampaign, term: link.utmTerm, content: link.utmContent,
  };
  return buildDestinationUrl(base, utm, link.code);
}

