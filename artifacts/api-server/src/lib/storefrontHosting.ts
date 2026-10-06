/**
 * Where buyers reach a PUBLISHED storefront (docs/flows/store-publish.md):
 *   https://<slug>.brandthread.app          — the store's Brandthread subdomain
 *   https://<verified custom domain>/       — after DNS TXT verification
 *   https://brandthread.app/store/<username> — the link Share Store copies
 *   https://brandthread.app/s/<slug>        — works with no DNS set up at all
 * plus the in-app JSON at GET /api/store/public/:slug.
 *
 * Only `status = 'published'` storefronts are ever served; drafts 404.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, storefrontCustomDomains, storefronts, users } from "@workspace/db";

export const PLATFORM_STORE_HOST_SUFFIX = ".brandthread.app";
/** Subdomains of brandthread.app that belong to the platform, never a store. */
const RESERVED_SUBDOMAINS = new Set(["www", "api", "app", "admin", "auth", "clerk", "mail", "cdn", "static", "assets", "status", "help", "docs"]);

type Storefront = typeof storefronts.$inferSelect;

export function normalizeHost(raw: string | undefined | null): string {
  return String(raw ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** A domain a seller may attach: lowercase hostname, at least one dot, no scheme/path. */
export function normalizeCustomDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (host.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  if (host === "brandthread.app" || host.endsWith(PLATFORM_STORE_HOST_SUFFIX)) return null;
  return host;
}

async function publishedBySlug(slug: string): Promise<Storefront | null> {
  const [sf] = await db.select().from(storefronts)
    .where(sql`lower(${storefronts.slug}) = ${slug.toLowerCase()}`)
    .limit(1);
  return sf && sf.status === "published" ? sf : null;
}

/** The published storefront a request's Host names, or null if the host is ours. */
export async function publishedStorefrontForHost(rawHost: string | undefined | null): Promise<Storefront | null> {
  const host = normalizeHost(rawHost);
  if (!host || host === "brandthread.app" || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (host.endsWith(PLATFORM_STORE_HOST_SUFFIX)) {
    const label = host.slice(0, -PLATFORM_STORE_HOST_SUFFIX.length);
    if (!label || label.includes(".") || RESERVED_SUBDOMAINS.has(label)) return null;
    return publishedBySlug(label);
  }
  const [row] = await db.select({ sf: storefronts })
    .from(storefrontCustomDomains)
    .innerJoin(storefronts, eq(storefronts.id, storefrontCustomDomains.storefrontId))
    .where(and(
      sql`lower(${storefrontCustomDomains.domain}) = ${host}`,
      eq(storefrontCustomDomains.verified, true),
    ))
    .limit(1);
  return row && row.sf.status === "published" ? row.sf : null;
}

export async function publishedStorefrontForSlug(slug: string): Promise<Storefront | null> {
  return publishedBySlug(slug);
}

export async function publishedStorefrontForUsername(username: string): Promise<Storefront | null> {
  const handle = username.replace(/^@/, "").toLowerCase();
  if (!handle) return null;
  const [row] = await db.select({ sf: storefronts })
    .from(users)
    .innerJoin(storefronts, eq(storefronts.ownerId, users.clerkId))
    .where(sql`lower(${users.username}) = ${handle}`)
    .limit(1);
  return row && row.sf.status === "published" ? row.sf : null;
}

/** What the app (and any buyer) may see of a published storefront — never
 *  the preview-share token, analytics snippet or other owner-only fields. */
export function publicStorefrontView(sf: Storefront) {
  return {
    id: sf.id,
    ownerId: sf.ownerId,
    slug: sf.slug,
    title: sf.title,
    subtitle: sf.subtitle,
    description: sf.description,
    status: sf.status,
    theme: sf.theme,
    branding: sf.branding,
    sections: sf.sections,
    seo: sf.seo,
    socialLinks: sf.socialLinks,
    publishedAt: sf.publishedAt,
  };
}
