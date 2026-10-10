/**
 * Store address (BT-307/316/317/318). Mounted at /api/store BEFORE the main
 * store router.
 *
 *   GET   /api/store/address   slug, subdomain host, what's switched on, the link to share
 *   PATCH /api/store/slug      { slug } — change the store's subdomain on the server
 *   GET   /api/store/host-lookup?host=  public: slug for a verified custom domain of a
 *                              published store (the Cloudflare host worker uses it)
 *   POST  /api/store/domains   refused while CUSTOM_DOMAINS_ENABLED is off (no promise of a
 *                              domain we can't serve); otherwise falls through to store.ts
 */
import { Router } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, storefrontCustomDomains, storefronts, users } from "@workspace/db";
import { rateLimit } from "../middlewares/rateLimit";
import { requireAuth } from "../middlewares/requireAuth";
import { normalizeStoreSlug, storeHostingFlags, storeLiveUrl } from "../lib/storeAddress";

const router = Router();

router.get("/host-lookup", rateLimit("public-read"), async (req, res) => {
  const host = String(req.query.host ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || host.endsWith(".brandthread.app")) return res.status(404).json({ error: "Not found" });
  try {
    const [row] = await db.select({ slug: storefronts.slug, status: storefronts.status })
      .from(storefrontCustomDomains)
      .innerJoin(storefronts, eq(storefronts.id, storefrontCustomDomains.storefrontId))
      .where(and(sql`lower(${storefrontCustomDomains.domain}) = ${host}`, eq(storefrontCustomDomains.verified, true)))
      .limit(1);
    if (!row || row.status !== "published") return res.status(404).json({ error: "Not found" });
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({ slug: row.slug });
  } catch (err) {
    req.log?.error({ err }, "store host lookup failed");
    return res.status(500).json({ error: "Lookup failed" });
  }
});

router.post("/domains", (req, res, next) => {
  if (storeHostingFlags().customDomainsLive) return next();
  res.status(403).json({ error: "Custom domains aren't available yet.", code: "CUSTOM_DOMAINS_OFF" });
});

async function addressFor(ownerId: string) {
  const [sf] = await db.select({ id: storefronts.id, slug: storefronts.slug, status: storefronts.status })
    .from(storefronts).where(eq(storefronts.ownerId, ownerId)).limit(1);
  const [user] = await db.select({ username: users.username }).from(users).where(eq(users.clerkId, ownerId)).limit(1);
  const flags = storeHostingFlags();
  const username = user?.username ?? null;
  return {
    slug: sf?.slug ?? null,
    subdomainHost: sf ? `${sf.slug}.brandthread.app` : null,
    ...flags,
    published: sf?.status === "published",
    liveUrl: sf ? storeLiveUrl({ slug: sf.slug, username }, flags) : storeLiveUrl({ slug: "", username }, { ...flags, subdomainsLive: false }),
  };
}

router.get("/address", requireAuth, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    res.json(await addressFor(ownerId));
  } catch (err) {
    req.log?.error({ err }, "store address failed");
    res.status(500).json({ error: "Couldn't load your store address." });
  }
});

router.patch("/slug", requireAuth, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const check = normalizeStoreSlug(req.body?.slug);
  if (!check.ok) return res.status(400).json({ error: check.error, code: "INVALID_SLUG" });
  try {
    const [sf] = await db.select({ id: storefronts.id, slug: storefronts.slug })
      .from(storefronts).where(eq(storefronts.ownerId, ownerId)).limit(1);
    if (!sf) return res.status(404).json({ error: "Create your store first.", code: "NO_STORE" });
    if (sf.slug === check.slug) return res.json(await addressFor(ownerId));
    const [taken] = await db.select({ id: storefronts.id }).from(storefronts)
      .where(and(sql`lower(${storefronts.slug}) = ${check.slug}`, ne(storefronts.id, sf.id))).limit(1);
    if (taken) return res.status(409).json({ error: "That address is taken.", code: "SLUG_TAKEN" });
    try {
      await db.update(storefronts).set({ slug: check.slug, updatedAt: new Date() }).where(eq(storefronts.id, sf.id));
    } catch (err: any) {
      if (err?.code === "23505" || err?.cause?.code === "23505") return res.status(409).json({ error: "That address is taken.", code: "SLUG_TAKEN" });
      throw err;
    }
    return res.json(await addressFor(ownerId));
  } catch (err) {
    req.log?.error({ err }, "store slug update failed");
    return res.status(500).json({ error: "Couldn't save your store address." });
  }
});

export default router;
