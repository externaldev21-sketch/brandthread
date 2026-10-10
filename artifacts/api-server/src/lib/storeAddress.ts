/**
 * A store's public addresses, and what is actually switched on (BT-307/317/318).
 *
 *   STORE_SUBDOMAINS_ENABLED=true   *.brandthread.app has wildcard DNS + TLS and
 *                                   host routing (docs/growth/store-domains.md)
 *   CUSTOM_DOMAINS_ENABLED=true     sellers may connect their own domain; needs a
 *                                   TLS-terminating proxy that serves any host
 *   CUSTOM_DOMAIN_CNAME_TARGET      the hostname sellers point their CNAME at
 *
 * Until a flag is on, the app never calls that address live or verified, and
 * shares the store link that works today (brandthread.app/store/<username>).
 */
import { getWebOrigin } from "./webOrigin";

export type StoreHostingFlags = { subdomainsLive: boolean; customDomainsLive: boolean; cnameTarget: string | null };

export function storeHostingFlags(env: NodeJS.ProcessEnv = process.env): StoreHostingFlags {
  const on = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "true";
  const target = (env.CUSTOM_DOMAIN_CNAME_TARGET ?? "").trim().toLowerCase();
  const customDomainsLive = on(env.CUSTOM_DOMAINS_ENABLED) && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(target);
  return { subdomainsLive: on(env.STORE_SUBDOMAINS_ENABLED), customDomainsLive, cnameTarget: customDomainsLive ? target : null };
}

/** Subdomain labels that belong to the platform (kept in sync with the host router). */
export const RESERVED_STORE_SLUGS = new Set([
  "www", "api", "app", "admin", "auth", "clerk", "mail", "cdn", "static", "assets", "status", "help", "docs",
  "store", "shop", "brandthread", "support", "blog", "m", "dev", "staging", "preview", "s", "u", "l", "g",
]);

export type SlugCheck = { ok: true; slug: string } | { ok: false; error: string };

/** A store subdomain: 3–40 lowercase letters, digits or hyphens, not starting/ending with a hyphen. */
export function normalizeStoreSlug(raw: unknown): SlugCheck {
  if (typeof raw !== "string") return { ok: false, error: "Enter a store address." };
  const slug = raw.trim().toLowerCase().replace(/\.brandthread\.app$/, "");
  if (slug.length < 3 || slug.length > 40) return { ok: false, error: "Use 3 to 40 characters." };
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return { ok: false, error: "Use lowercase letters, numbers and hyphens." };
  if (slug.includes("--")) return { ok: false, error: "Use single hyphens." };
  if (RESERVED_STORE_SLUGS.has(slug)) return { ok: false, error: "That address is reserved." };
  return { ok: true, slug };
}

/** The link to show and share. The subdomain only once it really serves the store. */
export function storeLiveUrl(input: { slug: string; username: string | null }, flags: StoreHostingFlags, origin = getWebOrigin()): string {
  if (flags.subdomainsLive) return `https://${input.slug}.brandthread.app`;
  if (input.username) return `${origin}/store/${encodeURIComponent(input.username.toLowerCase())}`;
  return `${origin}/api/store/site/${encodeURIComponent(input.slug)}`;
}
