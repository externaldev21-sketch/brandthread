/**
 * Seller Brand Assets library (Design Studio → Brand Assets).
 * GET /api/seller/brand-assets  — the seller's saved logos / colors / fonts / images
 * PUT /api/seller/brand-assets  — replace the library ({ assets: BrandAsset[] })
 *
 * Stored in storefronts.brand_assets.library (migration 270) so it survives a
 * reinstall or a new phone. Images are uploaded first through the existing
 * POST /api/products/images route and referenced here by their private
 * `/objects/...` path; this route signs a fresh display URL on every read.
 * Device-local URIs (file://, content://, data:, ph://) are refused — they
 * would be meaningless on any other device.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, storefronts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { getOrCreateStorefront } from "./store";

const router = Router();
router.use(requireAuth);
const objectStorage = new ObjectStorageService();

export const BRAND_ASSET_TYPES = [
  "logo", "icon", "font", "color", "pattern", "graphic", "photo", "mockup", "packaging", "text_style",
] as const;
const MAX_ASSETS = 300;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface StoredBrandAsset {
  id: string;
  name: string;
  type: (typeof BRAND_ASSET_TYPES)[number];
  objectPath?: string;
  remoteUrl?: string;
  color?: string;
  fontFamily?: string;
  tags: string[];
  createdAt: string;
}

/** Validates one submitted asset; returns an error message or the clean value. */
export function parseBrandAsset(raw: unknown): StoredBrandAsset | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Each asset must be an object.";
  const a = raw as Record<string, unknown>;
  if (typeof a.id !== "string" || !a.id.trim() || a.id.length > 100) return "Each asset needs an id.";
  if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 120) return "Each asset needs a name (up to 120 characters).";
  if (typeof a.type !== "string" || !(BRAND_ASSET_TYPES as readonly string[]).includes(a.type)) return "Unknown asset type.";
  const out: StoredBrandAsset = {
    id: a.id.trim(),
    name: a.name.trim(),
    type: a.type as StoredBrandAsset["type"],
    tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string" && t.length <= 60).slice(0, 20) : [],
    createdAt: typeof a.createdAt === "string" && !Number.isNaN(Date.parse(a.createdAt)) ? a.createdAt : new Date().toISOString(),
  };
  if (a.objectPath !== undefined && a.objectPath !== null) {
    if (typeof a.objectPath !== "string" || !/^\/objects\/[A-Za-z0-9/_.-]+$/.test(a.objectPath)) {
      return "Image assets must be uploaded before saving.";
    }
    out.objectPath = a.objectPath;
  }
  if (a.remoteUrl !== undefined && a.remoteUrl !== null) {
    if (typeof a.remoteUrl !== "string" || !/^https:\/\//i.test(a.remoteUrl) || a.remoteUrl.length > 2000) {
      return "Image assets must be uploaded before saving.";
    }
    out.remoteUrl = a.remoteUrl;
  }
  if (a.color !== undefined && a.color !== null) {
    if (typeof a.color !== "string" || !HEX_RE.test(a.color)) return "Colors must be a 6-digit hex value like #0EA5E9.";
    out.color = a.color.toUpperCase();
  }
  if (a.fontFamily !== undefined && a.fontFamily !== null) {
    if (typeof a.fontFamily !== "string" || !a.fontFamily.trim() || a.fontFamily.length > 100) return "Font names must be 1-100 characters.";
    out.fontFamily = a.fontFamily.trim();
  }
  if (out.type === "color" && !out.color) return "A color asset needs a hex color.";
  if (out.type === "font" && !out.fontFamily) return "A font asset needs a font name.";
  if (out.type !== "color" && out.type !== "font" && out.type !== "text_style" && !out.objectPath && !out.remoteUrl) {
    return "Image assets must be uploaded before saving.";
  }
  return out;
}

function storedLibrary(brandAssets: unknown): StoredBrandAsset[] {
  const lib = (brandAssets as Record<string, unknown> | null)?.library;
  if (!Array.isArray(lib)) return [];
  return lib.map(parseBrandAsset).filter((a): a is StoredBrandAsset => typeof a !== "string");
}

async function withDisplayUrls(assets: StoredBrandAsset[]) {
  return Promise.all(assets.map(async (a) => ({
    ...a,
    uri: a.objectPath
      ? await objectStorage.getObjectEntityDownloadURL(a.objectPath).catch(() => null)
      : a.remoteUrl ?? null,
  })));
}

router.get("/", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(clerkId);
  res.json({ assets: await withDisplayUrls(storedLibrary(sf.brandAssets)) });
});

router.put("/", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const raw = req.body?.assets;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "assets must be an array" });
    return;
  }
  if (raw.length > MAX_ASSETS) {
    res.status(400).json({ error: `You can keep up to ${MAX_ASSETS} brand assets.` });
    return;
  }
  const assets: StoredBrandAsset[] = [];
  for (const item of raw) {
    const parsed = parseBrandAsset(item);
    if (typeof parsed === "string") {
      res.status(400).json({ error: parsed });
      return;
    }
    assets.push(parsed);
  }

  const sf = await getOrCreateStorefront(clerkId);
  const known = new Set(storedLibrary(sf.brandAssets).map((a) => a.objectPath).filter(Boolean));
  for (const a of assets) {
    if (!a.objectPath || known.has(a.objectPath)) continue;
    // A newly referenced upload must belong to this seller.
    try {
      const file = await objectStorage.getObjectEntityFile(a.objectPath);
      const allowed = await objectStorage.canAccessObjectEntity({
        userId: clerkId, objectFile: file, requestedPermission: ObjectPermission.WRITE,
      });
      if (!allowed) {
        res.status(403).json({ error: "That image does not belong to this account." });
        return;
      }
    } catch {
      res.status(400).json({ error: "That image upload could not be found. Upload it again." });
      return;
    }
  }

  const brandAssets = { ...((sf.brandAssets as Record<string, unknown> | null) ?? {}), library: assets };
  await db.update(storefronts)
    .set({ brandAssets, updatedAt: new Date() })
    .where(eq(storefronts.id, sf.id));
  res.json({ assets: await withDisplayUrls(assets) });
});

export default router;
