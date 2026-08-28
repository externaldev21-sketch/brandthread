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
 * @param nonce    Optional entropy for distinct tokens issued in the same millisecond.
 * @param purpose  Separates short-lived private previews from public share links.
 */
function createShareToken(
  ownerId: string,
  ttlMs = 24 * 60 * 60 * 1000,
  issuedAt = Date.now(),
  nonce?: string,
  purpose: "private" | "share" = "private",
): string {
  if (!_signingKey) throw new Error("SESSION_SECRET not configured");
  const payload = Buffer.from(JSON.stringify({
    ownerId,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    purpose,
    ...(nonce ? { nonce } : {}),
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", _signingKey).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function hashShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function isCurrentShareToken(token: string, currentHash: string | null): boolean {
  if (!currentHash) return false;
  const tokenHash = Buffer.from(hashShareToken(token));
  const storedHash = Buffer.from(currentHash);
  return tokenHash.length === storedHash.length && crypto.timingSafeEqual(tokenHash, storedHash);
}

function verifyShareToken(token: string): {
  ownerId: string;
  issuedAt: number;
  expiresAt: number;
  purpose?: "private" | "share";
} | null {
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

const THREAD_THEME_LIGHT = {
  themeId: "thread",
  primaryColor: "#111111",
  secondaryColor: "#6B6B6B",
  accentColor: "#2B2B2B",
  backgroundColor: "#F7F7F5",
  textColor: "#111111",
  fontFamily: "Cormorant Garamond, Georgia, serif",
  borderRadius: 0,
};

const THREAD_THEME_DARK = {
  themeId: "thread",
  primaryColor: "#F5F5F3",
  secondaryColor: "#A7A7A3",
  accentColor: "#D7D7D2",
  backgroundColor: "#0B0B0B",
  textColor: "#F5F5F3",
  fontFamily: "Cormorant Garamond, Georgia, serif",
  borderRadius: 0,
};

const THREAD_THEME_SECTIONS = [
  {
    id: "thread-hero",
    type: "hero_image",
    title: "Hero Image",
    enabled: true,
    settings: {
      heading: "The new uniform.",
      description: "Considered pieces for everyday movement.",
      buttonLabel: "Shop the collection",
      fullWidth: true,
      sectionHeight: "tall",
    },
  },
  {
    id: "thread-products",
    type: "product_grid",
    title: "Product Grid",
    enabled: true,
    settings: {
      heading: "Current collection",
      description: "The pieces in rotation.",
      columns: 2,
      quickAdd: false,
    },
  },
  {
    id: "thread-story",
    type: "brand_story",
    title: "Brand Story",
    enabled: true,
    settings: {
      heading: "Designed with intention.",
      description: "Fewer pieces, better made, and meant to be worn often.",
    },
  },
  {
    id: "thread-newsletter",
    type: "newsletter",
    title: "Newsletter",
    enabled: true,
    settings: {
      heading: "Stay close.",
      description: "New releases, studio notes, and first access.",
      buttonLabel: "Join the list",
    },
  },
];

function normalizeThreadTheme(value: unknown): Record<string, unknown> {
  const theme = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  if (theme.themeId !== "thread") return theme;
  const dark = String(theme.backgroundColor ?? "").toUpperCase() === "#0B0B0B";
  return dark ? THREAD_THEME_DARK : THREAD_THEME_LIGHT;
}

// Helper — build self-contained HTML for a storefront (shared by /preview and /preview/:token)
async function buildPreviewHtml(ownerId: string): Promise<string> {
  const sf = await getOrCreateStorefront(ownerId);
  const theme    = (sf.theme    as any) ?? {};
  const branding = (sf.branding as any) ?? {};
  const seo      = (sf.seo     as any) ?? {};
  const sections: any[] = Array.isArray(sf.sections) ? sf.sections : [];

  // CSS values — validated to hex colors and safe font names only
  const primary   = safeCssColor(theme.primaryColor,   THREAD_THEME_LIGHT.primaryColor);
  const secondary = safeCssColor(theme.secondaryColor, THREAD_THEME_LIGHT.secondaryColor);
  const bg        = safeCssColor(theme.backgroundColor,THREAD_THEME_LIGHT.backgroundColor);
  const txt       = safeCssColor(theme.textColor,      THREAD_THEME_LIGHT.textColor);
  const font      = safeFontFamily(theme.fontFamily,   THREAD_THEME_LIGHT.fontFamily);

  // Text content — HTML-escaped before interpolation
  const title   = escapeHtml(sf.title ?? "My Store");
  const tagline = escapeHtml(branding.tagline ?? "");

  const sectionHtml = sections.map((s: any) => {
    const h = escapeHtml(s.settings?.heading ?? s.title ?? "");
    const d = escapeHtml(s.settings?.description ?? s.content ?? "");
    const t = String(s.type ?? "");
    if (t.startsWith("hero")) {
      const btnLabel = escapeHtml(s.settings?.buttonLabel ?? "Shop Now");
      const rawImage = String(s.settings?.imageUri ?? "");
      const image = /^https?:\/\//i.test(rawImage)
        ? `<img class="hero-image" src="${escapeAttr(rawImage)}" alt="">`
        : `<div class="hero-image hero-placeholder" aria-hidden="true"></div>`;
      return `<section class="hero">
        ${image}
        <div class="hero-copy">
          <p class="eyebrow">Brandthread / Collection</p>
          <h1>${h || title}</h1>
          <p>${d}</p>
          <a class="text-link" href="#">${btnLabel}<span aria-hidden="true">→</span></a>
        </div>
      </section>`;
    }
    if (t === "announcement") {
      const banner = escapeHtml(s.settings?.heading ?? s.settings?.text ?? "Free shipping on orders over $150");
      return `<div class="announcement">${banner}</div>`;
    }
    if (t === "product_grid" || t === "featured_collection") {
      return `<section class="collection">
        <div class="section-heading"><h2>${h || "Current collection"}</h2><p>${d}</p></div>
        <div class="product-grid">
          ${[1, 2, 3, 4].map((n) => `<article class="product-card">
            <div class="product-image"><span>0${n}</span></div>
            <div class="product-meta"><span>Edition ${n}</span><span>—</span></div>
          </article>`).join("")}
        </div>
      </section>`;
    }
    if (t === "brand_story") {
      return `<section class="story"><p class="eyebrow">The label</p><h2>${h}</h2><p>${d}</p></section>`;
    }
    if (t === "newsletter") {
      return `<section class="newsletter"><h2>${h}</h2><p>${d}</p><form><input aria-label="Email address" placeholder="Email address"><button type="button">${escapeHtml(s.settings?.buttonLabel ?? "Join")}</button></form></section>`;
    }
    return `<section class="standard-section">
      <h2>${h}</h2>
      <p>${d}</p>
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
body{background:${bg};color:${txt};font-family:Raleway,Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
nav{display:flex;align-items:center;justify-content:space-between;padding:22px clamp(20px,4vw,64px);background:${bg}f2;border-bottom:1px solid ${secondary};position:sticky;top:0;z-index:10;}
.logo{font:500 clamp(1.1rem,2vw,1.5rem)/1 ${font};color:${txt};letter-spacing:.08em;}
.nav-links{display:flex;gap:clamp(14px,3vw,36px);}
.nav-links a,.text-link{color:${txt};text-decoration:none;font-size:.72rem;text-transform:uppercase;letter-spacing:.14em;}
.preview-banner{background:${txt};padding:8px 24px;text-align:center;font-size:.65rem;color:${bg};letter-spacing:.14em;text-transform:uppercase;}
.hero{position:relative;min-height:min(82vh,820px);display:flex;align-items:flex-end;overflow:hidden;background:${primary};}
.hero-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:grayscale(1);opacity:.78;}
.hero-placeholder{background:linear-gradient(130deg,${primary},${secondary});}
.hero-copy{position:relative;z-index:1;width:min(760px,100%);padding:clamp(40px,8vw,110px) clamp(20px,7vw,96px);color:${bg};}
.eyebrow{font-size:.65rem;text-transform:uppercase;letter-spacing:.2em;margin-bottom:20px;opacity:.75;}
.hero h1{font:400 clamp(3.3rem,10vw,8.5rem)/.83 ${font};letter-spacing:-.04em;max-width:7ch;margin-bottom:26px;}
.hero-copy>p:not(.eyebrow){max-width:36rem;font-size:clamp(.9rem,1.4vw,1.1rem);line-height:1.6;margin-bottom:34px;}
.text-link{display:inline-flex;gap:14px;padding-bottom:7px;border-bottom:1px solid currentColor;color:${bg};}
.collection,.standard-section{padding:clamp(64px,10vw,140px) clamp(20px,4vw,64px);}
.section-heading{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:40px;}
.section-heading h2,.story h2,.newsletter h2,.standard-section h2{font:400 clamp(2.3rem,6vw,5rem)/.95 ${font};letter-spacing:-.03em;}
.section-heading p,.standard-section p{max-width:28rem;color:${secondary};line-height:1.6;}
.product-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(1px,1vw,16px);}
.product-card{min-width:0;}
.product-image{aspect-ratio:4/5;background:${primary};color:${bg};display:flex;align-items:flex-end;padding:14px;filter:grayscale(1);}
.product-image span{font-size:.65rem;letter-spacing:.14em;}
.product-meta{display:flex;justify-content:space-between;padding:12px 0 28px;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid ${secondary};}
.story{padding:clamp(100px,16vw,220px) clamp(20px,12vw,180px);text-align:center;border-top:1px solid ${secondary};}
.story>p:last-child{max-width:44rem;margin:28px auto 0;color:${secondary};font-size:clamp(1rem,2vw,1.35rem);line-height:1.8;}
.newsletter{margin:0 clamp(20px,4vw,64px);padding:clamp(64px,10vw,120px) 0;border-top:1px solid ${secondary};border-bottom:1px solid ${secondary};}
.newsletter p{margin:16px 0 34px;color:${secondary};}
.newsletter form{display:flex;max-width:560px;border-bottom:1px solid ${txt};}
.newsletter input{flex:1;background:transparent;border:0;padding:14px 0;color:${txt};font:inherit;outline:0;}
.newsletter button{background:transparent;border:0;color:${txt};text-transform:uppercase;letter-spacing:.12em;font-size:.68rem;}
.announcement{background:${txt};color:${bg};padding:10px 24px;text-align:center;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;}
footer{padding:64px 24px;text-align:center;opacity:.6;font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;}
@media(max-width:640px){.nav-links a:nth-child(n+3){display:none}.product-grid{gap:1px}.section-heading{display:block}.section-heading p{margin-top:14px}}
</style>
</head>
<body>
<div class="preview-banner">Private Preview link · Not yet published</div>
<nav>
  <span class="logo">${title}</span>
  <div class="nav-links"><a href="#">Shop</a><a href="#">Collections</a><a href="#">About</a><a href="#">Contact</a></div>
</nav>
${sectionHtml || `<section class="story">
  <p class="eyebrow">Thread Theme by Brandthread</p>
  <h1>${title}</h1>
  <p>${tagline || "Your storefront is ready. Publish to go live."}</p>
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

  // Public share links must be the one current link saved for this storefront.
  // Short-lived private preview tokens are intentionally independent of that
  // state: the authenticated WebView flow issues them for a five-minute preview.
  // Tokens from before purpose tagging fail closed, because their kind cannot be
  // determined safely.
  if (entry.purpose !== "private" && entry.purpose !== "share") {
    res.set("Content-Type", "text/html");
    res.status(410).send(EXPIRED_PAGE);
    return;
  }
  if (entry.purpose === "share") {
    // Check revocation: a token is invalid if it was issued at or before the
    // revocation watermark (revokedAt >= issuedAt).  Using >= means a token
    // issued in the exact same millisecond as a revocation is also rejected.
    const [sf] = await db
      .select({
        sharePreviewRevokedAt: storefronts.sharePreviewRevokedAt,
        sharePreviewTokenHash: storefronts.sharePreviewTokenHash,
      })
      .from(storefronts)
      .where(eq(storefronts.ownerId, entry.ownerId))
      .limit(1);
    if (
      !isCurrentShareToken(token, sf?.sharePreviewTokenHash ?? null)
      || (sf?.sharePreviewRevokedAt && sf.sharePreviewRevokedAt.getTime() >= entry.issuedAt)
    ) {
      res.set("Content-Type", "text/html");
      res.status(410).send(EXPIRED_PAGE);
      return;
    }
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
    .values({
      ownerId,
      slug,
      title: "My Store",
      theme: THREAD_THEME_LIGHT,
      sections: THREAD_THEME_SECTIONS,
      branding: { tagline: "", logoUrl: "", targetAudience: "" },
    })
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
      update[dbKey] = key === "theme"
        ? normalizeThreadTheme(req.body[key])
        : req.body[key];
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

  // Read the revocation watermark so the new token is always issued strictly
  // after it. Also replace the stored fingerprint: only this latest public
  // link is valid, even if prior links have not expired yet.
  //
  // DO NOT clear sharePreviewRevokedAt: old (revoked) tokens must remain
  // rejected permanently, even after a fresh link is shared.
  // Invariant: revoke → old URL rejected → new URL accepted → old URL STILL rejected.
  const sf = await getOrCreateStorefront(ownerId);
  const revokedAtMs = sf.sharePreviewRevokedAt?.getTime() ?? 0;
  const TTL_MS = 24 * 60 * 60 * 1000;
  // Advance issuedAt past the watermark if necessary so new tokens always pass >= check.
  const issuedAt = Math.max(Date.now(), revokedAtMs + 1);
  const token = createShareToken(
    ownerId,
    TTL_MS,
    issuedAt,
    crypto.randomBytes(16).toString("base64url"),
    "share",
  );
  const expiresAt = issuedAt + TTL_MS;
  await db
    .update(storefronts)
    .set({
      sharePreviewTokenHash: hashShareToken(token),
      updatedAt: new Date(),
    })
    .where(eq(storefronts.id, sf.id));
  // Construct canonical HTTPS origin — same pattern as other routes in this codebase
  const origin = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://brandthread.app";
  const url = `${origin}/api/store/preview/${token}`;
  res.json({ token, url, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds: 86400 });
});

// DELETE /api/store/share-preview — revoke the seller's current preview link
// Clearing the stored fingerprint immediately invalidates the latest token. The
// timestamp watermark also keeps any legacy token invalid after revocation.
router.delete("/share-preview", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);
  await db
    .update(storefronts)
    .set({
      sharePreviewRevokedAt: new Date(),
      sharePreviewTokenHash: null,
      updatedAt: new Date(),
    })
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
