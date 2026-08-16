import dns from "dns/promises";
import { Router } from "express";
import { db, storefronts, storefrontVersions, storefrontCustomDomains } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

// ─── Helper — get or create storefront for a seller ──────────────────────────
async function getOrCreateStorefront(ownerId: string) {
  const existing = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.ownerId, ownerId))
    .limit(1);

  if (existing[0]) return existing[0];

  // Auto-generate a slug from ownerId
  const slug = `store-${crypto.randomBytes(4).toString("hex")}`;
  const [created] = await db
    .insert(storefronts)
    .values({ ownerId, slug, title: "My Store" })
    .returning();
  return created;
}

// GET /api/store — get the seller's storefront
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);
  res.json(sf);
});

// PUT /api/store — save the storefront
router.put("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const allowedFields = [
    "title", "subtitle", "description", "theme", "branding",
    "sections", "seo", "socialLinks", "analyticsCode",
  ];
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowedFields) {
    if (key in req.body) {
      // camelCase → snake_case mapping for DB columns
      const dbKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      update[dbKey] = req.body[key];
    }
  }

  const [updated] = await db
    .update(storefronts)
    .set(update as any)
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(updated);
});

// POST /api/store/publish — publish the storefront
router.post("/publish", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const [updated] = await db
    .update(storefronts)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(updated);
});

// POST /api/store/unpublish — unpublish the storefront
router.post("/unpublish", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const [updated] = await db
    .update(storefronts)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(updated);
});

// GET /api/store/versions — list saved versions
router.get("/versions", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const versions = await db
    .select()
    .from(storefrontVersions)
    .where(eq(storefrontVersions.storefrontId, sf.id))
    .orderBy(desc(storefrontVersions.createdAt))
    .limit(20);

  res.json(versions);
});

// POST /api/store/versions — save current state as a named version
router.post("/versions", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { label = "Version" } = req.body;
  const sf = await getOrCreateStorefront(ownerId);

  const [version] = await db
    .insert(storefrontVersions)
    .values({
      storefrontId: sf.id,
      label,
      snapshot: sf as unknown as Record<string, unknown>,
      createdBy: ownerId,
    })
    .returning();

  res.json(version);
});

// POST /api/store/versions/:id/restore — restore a saved version
router.post("/versions/:id/restore", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const sf = await getOrCreateStorefront(ownerId);

  const [version] = await db
    .select()
    .from(storefrontVersions)
    .where(and(eq(storefrontVersions.id, id), eq(storefrontVersions.storefrontId, sf.id)))
    .limit(1);

  if (!version) { res.status(404).json({ error: "Version not found" }); return; }

  const snap = version.snapshot as any;
  const [restored] = await db
    .update(storefronts)
    .set({
      title:         snap.title,
      subtitle:      snap.subtitle,
      description:   snap.description,
      theme:         snap.theme,
      branding:      snap.branding,
      sections:      snap.sections,
      seo:           snap.seo,
      socialLinks:   snap.socialLinks,
      analyticsCode: snap.analyticsCode,
      updatedAt:     new Date(),
    })
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(restored);
});

// GET /api/store/domains — list custom domains
router.get("/domains", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const domains = await db
    .select()
    .from(storefrontCustomDomains)
    .where(eq(storefrontCustomDomains.storefrontId, sf.id));

  res.json(domains);
});

// POST /api/store/domains — add a custom domain
router.post("/domains", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const { domain } = req.body;
  if (!domain) { res.status(400).json({ error: "domain required" }); return; }
  const sf = await getOrCreateStorefront(ownerId);

  const verifyToken = `brandthread-verify-${crypto.randomBytes(12).toString("hex")}`;

  const [record] = await db
    .insert(storefrontCustomDomains)
    .values({ storefrontId: sf.id, domain, verifyToken })
    .returning();

  res.json({ ...record, verificationInstructions: `Add a TXT record: _brandthread-verify.${domain} → ${verifyToken}` });
});

// POST /api/store/domains/:id/verify — attempt DNS verification
router.post("/domains/:id/verify", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const sf = await getOrCreateStorefront(ownerId);

  // Verify ownership before proceeding
  const [existing] = await db
    .select()
    .from(storefrontCustomDomains)
    .where(and(eq(storefrontCustomDomains.id, id), eq(storefrontCustomDomains.storefrontId, sf.id)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Domain not found" }); return; }

  // Real DNS TXT lookup — verify the seller has actually added the record
  let dnsVerified = false;
  try {
    const records = await dns.resolveTxt(`_brandthread-verify.${existing.domain}`);
    const flat = records.flat();
    dnsVerified = flat.includes(existing.verifyToken ?? "");
  } catch {
    // DNS not configured or lookup failed
  }

  if (!dnsVerified) {
    res.status(400).json({
      error: "DNS record not found",
      hint: `Add TXT record: _brandthread-verify.${existing.domain} → ${existing.verifyToken}`,
      note: "DNS changes can take up to 48 hours to propagate",
    }); return;
  }

  const [updated] = await db
    .update(storefrontCustomDomains)
    .set({ verified: true })
    .where(and(eq(storefrontCustomDomains.id, id), eq(storefrontCustomDomains.storefrontId, sf.id)))
    .returning();

  res.json(updated);
});

// DELETE /api/store/domains/:id — remove a custom domain
router.delete("/domains/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const sf = await getOrCreateStorefront(ownerId);

  // Constrain delete to the authenticated seller's storefront
  await db
    .delete(storefrontCustomDomains)
    .where(and(eq(storefrontCustomDomains.id, id), eq(storefrontCustomDomains.storefrontId, sf.id)));

  res.json({ ok: true });
});

// ─── In-memory preview token store (short-lived, server-local) ───────────────
const previewTokens = new Map<string, { ownerId: string; expiresAt: number }>();

// GET /api/store/preview-token — generate a 5-min token for the preview endpoint
router.get("/preview-token", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const token = crypto.randomBytes(20).toString("hex");
  previewTokens.set(token, { ownerId, expiresAt: Date.now() + 5 * 60 * 1000 });
  // Prune expired tokens
  for (const [k, v] of previewTokens) { if (v.expiresAt < Date.now()) previewTokens.delete(k); }
  res.json({ token, ttlSeconds: 300 });
});

// GET /api/store/preview — self-contained HTML for WebView preview
router.get("/preview", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const theme   = (sf.theme    as any) ?? {};
  const branding = (sf.branding as any) ?? {};
  const seo      = (sf.seo     as any) ?? {};
  const sections: any[] = Array.isArray(sf.sections) ? sf.sections : [];

  const primary    = theme.primaryColor    ?? "#7c3aed";
  const secondary  = theme.secondaryColor  ?? "#5b21b6";
  const bg         = theme.backgroundColor ?? "#0f0f1a";
  const txt        = theme.textColor       ?? "#f4f4ff";
  const font       = theme.fontFamily      ?? "Inter, system-ui, sans-serif";
  const title      = sf.title ?? "My Store";
  const tagline    = branding.tagline ?? "";

  const sectionHtml = sections.map((s: any) => {
    const h = s.settings?.heading ?? s.title ?? "";
    const d = s.settings?.description ?? s.content ?? "";
    const t = s.type ?? "";
    if (t.startsWith("hero")) {
      return `<section style="background:linear-gradient(135deg,${primary},${secondary});padding:80px 24px;text-align:center;color:#fff;">
        <h1 style="font-size:2.5rem;margin:0 0 16px;font-family:${font};">${h || title}</h1>
        <p style="font-size:1rem;opacity:0.85;margin:0 0 28px;">${d}</p>
        <a href="#" style="background:#fff;color:${primary};padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;">${s.settings?.buttonLabel ?? "Shop Now"}</a>
      </section>`;
    }
    if (t === "announcement") {
      return `<div style="background:${primary};padding:10px 24px;text-align:center;color:#fff;font-size:0.85rem;">${h || s.settings?.text || "Free shipping on orders over $150"}</div>`;
    }
    return `<section style="padding:48px 24px;border-bottom:1px solid ${primary}22;">
      <h2 style="font-size:1.4rem;margin:0 0 12px;color:${primary};font-family:${font};">${h}</h2>
      <p style="font-size:0.9rem;opacity:0.7;margin:0;line-height:1.6;">${d}</p>
    </section>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${seo.metaTitle ?? title}</title>
<meta name="description" content="${seo.metaDescription ?? tagline}">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:${bg};color:${txt};font-family:${font};-webkit-font-smoothing:antialiased;}
nav{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:${bg}dd;border-bottom:1px solid ${primary}22;position:sticky;top:0;z-index:10;}
.logo{font-size:1.2rem;font-weight:700;color:${primary};}
.nav-links{display:flex;gap:20px;}
.nav-links a{color:${txt};text-decoration:none;font-size:0.9rem;opacity:0.75;transition:opacity 0.2s;}
.nav-links a:hover{opacity:1;}
footer{padding:48px 24px;text-align:center;opacity:0.45;font-size:0.8rem;border-top:1px solid ${primary}22;margin-top:48px;}
</style>
</head>
<body>
<nav>
  <span class="logo">${title}</span>
  <div class="nav-links"><a href="#">Shop</a><a href="#">Collections</a><a href="#">About</a><a href="#">Contact</a></div>
</nav>
${sectionHtml || `<section style="padding:100px 24px;text-align:center;">
  <h1 style="font-size:2.5rem;margin:0 0 16px;color:${primary};">${title}</h1>
  <p style="opacity:0.65;font-size:1.05rem;">${tagline || "Your storefront is ready. Publish to go live."}</p>
</section>`}
<footer>© ${new Date().getFullYear()} ${title}. Powered by Brandthread.</footer>
</body>
</html>`;

  res.set("Content-Type", "text/html");
  res.send(html);
});

// GET /api/store/public/:slug — public storefront (no auth)
router.get("/public/:slug", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [sf] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.slug, slug))
    .limit(1);
  if (!sf || sf.status !== "published") { res.status(404).json({ error: "Store not found" }); return; }
  res.json(sf);
});

export default router;
