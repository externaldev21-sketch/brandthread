import dns from "dns/promises";
import { Router } from "express";
import { db, storefronts, storefrontVersions, storefrontCustomDomains } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import crypto from "crypto";

const router = Router();

// ─── HMAC-signed share-preview tokens ────────────────────────────────────────
// Tokens are self-contained (payload + signature) so they survive server
// restarts, crash-recoveries, and multi-instance deployments without any
// shared state or database table.
//
// SESSION_SECRET is REQUIRED — no fallback. Both endpoints return 503 when
// the secret is absent so the feature fails closed rather than using a known key.
const _sessionSecret = process.env.SESSION_SECRET;
const _signingKey: Buffer | null = _sessionSecret
  ? crypto.createHmac("sha256", _sessionSecret).update("store-preview-v1").digest()
  : null; // null → feature unavailable; 503 returned at each endpoint

/**
 * Create an HMAC-signed, self-contained preview token.
 * Because the payload + signature are encoded in the token itself (no server
 * state), tokens survive server restarts and multi-instance deployments.
 *
 * @param ownerId  The seller's Clerk user ID.
 * @param ttlMs    Token lifetime in milliseconds. Defaults to 24 hours.
 */
function createShareToken(ownerId: string, ttlMs = 24 * 60 * 60 * 1000, issuedAt = Date.now()): string {
  if (!_signingKey) throw new Error("SESSION_SECRET not configured");
  const payload = Buffer.from(JSON.stringify({ ownerId, issuedAt, expiresAt: issuedAt + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", _signingKey).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyShareToken(token: string): { ownerId: string; issuedAt: number; expiresAt: number } | null {
  if (!_signingKey) return null; // feature unavailable — fail closed
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = token.slice(0, lastDot);
  const sig     = token.slice(lastDot + 1);
  // Compute expected signature and compare with constant-time equality
  const expected = crypto.createHmac("sha256", _signingKey).update(payload).digest("base64url");
  const sigBuf  = Buffer.from(sig);
  const expBuf  = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ─── Output-encoding helpers ──────────────────────────────────────────────────

/** Escape user-controlled text for safe insertion into HTML element content */
function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape user-controlled text for safe insertion into HTML attribute values (within double-quotes) */
function escapeAttr(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Allow only hex colors (#rgb, #rrggbb, #rrggbbaa) in CSS property values */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function safeCssColor(val: unknown, fallback: string): string {
  const s = String(val ?? "").trim();
  return HEX_COLOR_RE.test(s) ? s : fallback;
}

/** Allow only safe characters in font-family CSS values (no semicolons, braces, parens, slashes) */
const SAFE_FONT_RE = /^[A-Za-z0-9 ,\-_'"]+$/;
function safeFontFamily(val: unknown, fallback: string): string {
  const s = String(val ?? "").trim();
  return SAFE_FONT_RE.test(s) && s.length <= 200 ? s : fallback;
}

// Helper — build self-contained HTML for a storefront (shared by /preview and /preview/:token)
async function buildPreviewHtml(ownerId: string): Promise<string> {
  const sf = await getOrCreateStorefront(ownerId);
  const theme    = (sf.theme    as any) ?? {};
  const branding = (sf.branding as any) ?? {};
  const seo      = (sf.seo     as any) ?? {};
  const sections: any[] = Array.isArray(sf.sections) ? sf.sections : [];

  // CSS values — validated to hex colors and safe font names only
  const primary   = safeCssColor(theme.primaryColor,   "#7c3aed");
  const secondary = safeCssColor(theme.secondaryColor, "#5b21b6");
  const bg        = safeCssColor(theme.backgroundColor,"#0f0f1a");
  const txt       = safeCssColor(theme.textColor,      "#f4f4ff");
  const font      = safeFontFamily(theme.fontFamily,   "Inter, system-ui, sans-serif");

  // Text content — HTML-escaped before interpolation
  const title   = escapeHtml(sf.title ?? "My Store");
  const tagline = escapeHtml(branding.tagline ?? "");

  const sectionHtml = sections.map((s: any) => {
    const h = escapeHtml(s.settings?.heading ?? s.title ?? "");
    const d = escapeHtml(s.settings?.description ?? s.content ?? "");
    const t = String(s.type ?? "");
    if (t.startsWith("hero")) {
      const btnLabel = escapeHtml(s.settings?.buttonLabel ?? "Shop Now");
      return `<section style="background:linear-gradient(135deg,${primary},${secondary});padding:80px 24px;text-align:center;color:#fff;">
        <h1 style="font-size:2.5rem;margin:0 0 16px;font-family:${font};">${h || title}</h1>
        <p style="font-size:1rem;opacity:0.85;margin:0 0 28px;">${d}</p>
        <a href="#" style="background:#fff;color:${primary};padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;">${btnLabel}</a>
      </section>`;
    }
    if (t === "announcement") {
      const banner = escapeHtml(s.settings?.heading ?? s.settings?.text ?? "Free shipping on orders over $150");
      return `<div style="background:${primary};padding:10px 24px;text-align:center;color:#fff;font-size:0.85rem;">${banner}</div>`;
    }
    return `<section style="padding:48px 24px;border-bottom:1px solid ${primary}22;">
      <h2 style="font-size:1.4rem;margin:0 0 12px;color:${primary};font-family:${font};">${h}</h2>
      <p style="font-size:0.9rem;opacity:0.7;margin:0;line-height:1.6;">${d}</p>
    </section>`;
  }).join("\n");

  // SEO fields go into attributes / <title> — escape accordingly
  const metaTitle = escapeHtml(seo.metaTitle ?? sf.title ?? "My Store");
  const metaDesc  = escapeAttr(seo.metaDescription ?? branding.tagline ?? "");
  const year      = new Date().getFullYear(); // safe integer

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${metaTitle}</title>
<meta name="description" content="${metaDesc}">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:${bg};color:${txt};font-family:${font};-webkit-font-smoothing:antialiased;}
nav{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:${bg}dd;border-bottom:1px solid ${primary}22;position:sticky;top:0;z-index:10;}
.logo{font-size:1.2rem;font-weight:700;color:${primary};}
.nav-links{display:flex;gap:20px;}
.nav-links a{color:${txt};text-decoration:none;font-size:0.9rem;opacity:0.75;transition:opacity 0.2s;}
.nav-links a:hover{opacity:1;}
.preview-banner{background:${primary}22;border-bottom:2px solid ${primary};padding:8px 24px;text-align:center;font-size:0.78rem;color:${primary};letter-spacing:0.03em;}
footer{padding:48px 24px;text-align:center;opacity:0.45;font-size:0.8rem;border-top:1px solid ${primary}22;margin-top:48px;}
</style>
</head>
<body>
<div class="preview-banner">🔒 Preview link — not yet published</div>
<nav>
  <span class="logo">${title}</span>
  <div class="nav-links"><a href="#">Shop</a><a href="#">Collections</a><a href="#">About</a><a href="#">Contact</a></div>
</nav>
${sectionHtml || `<section style="padding:100px 24px;text-align:center;">
  <h1 style="font-size:2.5rem;margin:0 0 16px;color:${primary};">${title}</h1>
  <p style="opacity:0.65;font-size:1.05rem;">${tagline || "Your storefront is ready. Publish to go live."}</p>
</section>`}
<footer>© ${year} ${title}. Powered by Brandthread.</footer>
</body>
</html>`;
}

const EXPIRED_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Preview Expired</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#07070f;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;}
.card{max-width:360px;}.icon{font-size:3rem;margin-bottom:16px;}.title{font-size:1.4rem;font-weight:700;margin-bottom:8px;}.sub{opacity:0.55;font-size:0.9rem;line-height:1.6;}</style>
</head><body><div class="card"><div class="icon">⏰</div><p class="title">Preview link expired</p><p class="sub">This preview link was only valid for 24 hours. Ask the seller to share a fresh link.</p></div></body></html>`;

// GET /api/store/preview/:token — public shareable preview (no auth required)
router.get("/preview/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const entry = verifyShareToken(token);

  if (!entry || entry.expiresAt < Date.now()) {
    res.set("Content-Type", "text/html");
    res.status(410).send(EXPIRED_PAGE);
    return;
  }

  // Check revocation: a token is invalid if it was issued at or before the
  // revocation watermark (revokedAt >= issuedAt).  Using >= means a token
  // issued in the exact same millisecond as a revocation is also rejected.
  //
  // Tokens that predate the issuedAt payload field fall back to the
  // conservative estimate expiresAt − 24 h so they remain revocable.
  const FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
  const tokenIssuedAt = typeof entry.issuedAt === "number"
    ? entry.issuedAt
    : entry.expiresAt - FALLBACK_TTL_MS;
  const [sf] = await db
    .select({ sharePreviewRevokedAt: storefronts.sharePreviewRevokedAt })
    .from(storefronts)
    .where(eq(storefronts.ownerId, entry.ownerId))
    .limit(1);
  if (sf?.sharePreviewRevokedAt && sf.sharePreviewRevokedAt.getTime() >= tokenIssuedAt) {
    res.set("Content-Type", "text/html");
    res.status(410).send(EXPIRED_PAGE);
    return;
  }

  const html = await buildPreviewHtml(entry.ownerId);
  res.set("Content-Type", "text/html");
  res.send(html);
});

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
  // Keep the revocation watermark explicit in the response so clients can
  // refresh preview-link status whenever the seller returns to the screen.
  res.json({
    ...sf,
    sharePreviewRevokedAt: sf.sharePreviewRevokedAt?.toISOString() ?? null,
  });
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

// POST /api/store/versions — save a named version
// Body: { label?: string, snapshot?: Record<string,unknown> }
// When the client supplies a `snapshot` it is stored verbatim (preferred: the
// client captures the pre-mutation local state before the server storefront is
// updated, so the explicit payload is always more accurate than re-reading the
// server row).  When `snapshot` is absent the server falls back to the current
// DB row so callers that don't need a specific pre-mutation snapshot still work.
router.post("/versions", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { label = "Version", snapshot } = req.body;
  const sf = await getOrCreateStorefront(ownerId);

  const [version] = await db
    .insert(storefrontVersions)
    .values({
      storefrontId: sf.id,
      label,
      snapshot: (snapshot ?? sf) as Record<string, unknown>,
      createdBy: ownerId,
    })
    .returning();

  res.json(version);
});

// POST /api/store/versions/:id/restore — restore a saved version
//
// Supports two snapshot schemas written by different code paths:
//
//  1. Legacy full-storefront (old implicit saves — uses current DB row as the
//     snapshot):  snap.theme present, snap.branding uses DB column shape
//     ({ tagline, logoUrl, targetAudience }).
//
//  2. Mobile compact (new explicit-payload saves): snap.themeSettings carries
//     { themeId, ... }, snap.branding carries StoreBranding
//     ({ colors, typography, ... }).
//
// Only DB columns that are actually present in the snapshot are updated;
// absent fields are left at their current values, not overwritten with null.
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

  // Build an update object from only the fields present in this snapshot so
  // absent fields are not overwritten with undefined/null.
  const update: Record<string, unknown> = { updatedAt: new Date() };

  if ("sections"      in snap) update.sections     = snap.sections;
  if ("title"         in snap) update.title        = snap.title;
  if ("subtitle"      in snap) update.subtitle     = snap.subtitle;
  if ("description"   in snap) update.description  = snap.description;
  if ("seo"           in snap) update.seo          = snap.seo;
  if ("socialLinks"   in snap) update.social_links  = snap.socialLinks;
  if ("analyticsCode" in snap) update.analytics_code = snap.analyticsCode;

  // branding: both schemas may carry it, but with different shapes.
  // Store whatever the snapshot says — the mobile client reads it back verbatim.
  if ("branding" in snap) update.branding = snap.branding;

  // theme: legacy schema has snap.theme directly (DB column shape).
  // Mobile compact schema has snap.themeSettings.themeId + snap.branding.colors.
  // Merge both into the DB theme column, preserving any existing fields not
  // captured in the snapshot.
  if ("theme" in snap) {
    update.theme = snap.theme;
  } else if (snap.themeSettings || snap.branding?.colors) {
    const existing = (sf.theme as Record<string, unknown> | null) ?? {};
    const derived: Record<string, unknown> = { ...existing };
    if (snap.themeSettings?.themeId)               derived.themeId         = snap.themeSettings.themeId;
    if (snap.branding?.colors?.primary)            derived.primaryColor    = snap.branding.colors.primary;
    if (snap.branding?.colors?.secondary)          derived.secondaryColor  = snap.branding.colors.secondary;
    if (snap.branding?.colors?.accent)             derived.accentColor     = snap.branding.colors.accent;
    if (snap.branding?.colors?.background)         derived.backgroundColor = snap.branding.colors.background;
    if (snap.branding?.colors?.text)               derived.textColor       = snap.branding.colors.text;
    if (snap.branding?.typography?.headingFont)    derived.fontFamily      = snap.branding.typography.headingFont;
    update.theme = derived;
  }

  const [restored] = await db
    .update(storefronts)
    .set(update as any)
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

// GET /api/store/preview-token — generate a 5-min HMAC-signed token for the
// preview WebView. Using the same HMAC approach as share-preview means these
// tokens are self-contained: they survive server restarts and multi-instance
// deployments with zero shared state or database round-trips.
//
// The token is verified by the same verifyShareToken() function used for
// 24-hour share links — TTL enforcement is purely the expiresAt field inside
// the signed payload, so a 5-min token is simply one with a shorter TTL.
router.get("/preview-token", (req, res): void => {
  if (!_signingKey) {
    res.status(503).json({ error: "Preview unavailable: SESSION_SECRET not configured" });
    return;
  }
  const ownerId = (req as any).clerkUserId as string;
  const TTL_MS  = 5 * 60 * 1000; // 5 minutes
  const token   = createShareToken(ownerId, TTL_MS);
  res.json({ token, ttlSeconds: 300 });
});

// GET /api/store/preview — self-contained HTML for WebView preview
router.get("/preview", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const html = await buildPreviewHtml(ownerId);
  res.set("Content-Type", "text/html");
  res.send(html);
});

// POST /api/store/share-preview — generate a 24-hour shareable preview URL
router.post("/share-preview", async (req, res): Promise<void> => {
  if (!_signingKey) {
    res.status(503).json({ error: "Preview sharing unavailable: SESSION_SECRET not configured" });
    return;
  }
  const ownerId = (req as any).clerkUserId as string;

  // Read the revocation watermark so we can guarantee the new token's issuedAt
  // is strictly AFTER it.  This prevents a same-millisecond race where revoke
  // and re-share happen in the same clock tick: new token issuedAt is advanced
  // to revokedAt + 1 when necessary.
  //
  // DO NOT clear sharePreviewRevokedAt: old (revoked) tokens must remain
  // rejected permanently, even after a fresh link is shared.
  // Invariant: revoke → old URL rejected → new URL accepted → old URL STILL rejected.
  const sf = await getOrCreateStorefront(ownerId);
  const revokedAtMs = sf.sharePreviewRevokedAt?.getTime() ?? 0;
  const TTL_MS = 24 * 60 * 60 * 1000;
  // Advance issuedAt past the watermark if necessary so new tokens always pass >= check.
  const issuedAt = Math.max(Date.now(), revokedAtMs + 1);
  const token = createShareToken(ownerId, TTL_MS, issuedAt);
  const expiresAt = issuedAt + TTL_MS;
  // Construct canonical HTTPS origin — same pattern as other routes in this codebase
  const origin = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://brandthread.app";
  const url = `${origin}/api/store/preview/${token}`;
  res.json({ token, url, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds: 86400 });
});

// DELETE /api/store/share-preview — revoke the seller's current preview link
// Any outstanding token for this seller will be rejected until a fresh one is generated.
router.delete("/share-preview", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);
  await db
    .update(storefronts)
    .set({ sharePreviewRevokedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(storefronts.id, sf.id));
  res.json({ ok: true, revokedAt: new Date().toISOString() });
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
