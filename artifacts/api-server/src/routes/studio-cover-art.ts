/**
 * Studio carousel cover-art — admin-only generation/selection, plus a public
 * read-only manifest the app (and a signed-out preview) can fetch freely.
 * See src/lib/studioCoverArt.ts for the prompt template and generation job.
 */
import { Router } from "express";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";
import { db, studioCoverArt } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  generateStudioCoverArtCandidates,
  getStudioCoverArtManifest,
  isKnownStudioCoverCard,
  selectStudioCoverArt,
  STUDIO_COVER_SUBJECTS,
  type StudioCoverVariant,
} from "../lib/studioCoverArt";

function normalizeVariant(raw: unknown): StudioCoverVariant {
  return raw === "gel" ? "gel" : "mono";
}

const objectStorage = new ObjectStorageService();

const router = Router();

function normalizeCardId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** GET /config/studio-cover-art — public, same pattern as /config/features.
 *  Returns only the chosen cover per card; candidates never leak here. */
router.get("/", async (_req, res, next) => {
  try {
    const manifest = await getStudioCoverArtManifest();
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.json({ covers: manifest });
  } catch (error) {
    next(error);
  }
});

/** GET /config/studio-cover-art/:cardId/candidates — admin-only. Every
 *  candidate ever generated for this card, each as a signed (1hr) GET URL,
 *  plus which one (if any) is currently chosen — what an admin reviews
 *  before calling /select. */
router.get("/:cardId/candidates", requireAuth, requireModerator, async (req, res, next) => {
  const cardId = normalizeCardId(req.params.cardId);
  if (!isKnownStudioCoverCard(cardId)) {
    res.status(400).json({ error: `Unknown card id "${cardId}"` });
    return;
  }
  try {
    const [row] = await db.select().from(studioCoverArt).where(eq(studioCoverArt.cardId, cardId)).limit(1);
    const candidates = await Promise.all((row?.candidates ?? []).map(async (c) => ({
      objectPath: c.objectPath,
      createdAt: c.createdAt,
      variant: c.variant ?? "mono",
      url: await objectStorage.getObjectEntityDownloadURL(c.objectPath, 3600),
      chosen: c.objectPath === row?.chosenObjectPath,
    })));
    res.json({ cardId, candidates });
  } catch (error) {
    next(error);
  }
});

/** POST /config/studio-cover-art/:cardId/generate — admin-only. Body:
 *  { count?: number, variant?: 'mono' | 'gel' } (defaults to 4, 'mono').
 *  Returns the freshly generated candidates (their object paths, not signed
 *  URLs — an admin reviewing candidates uses the /candidates listing below,
 *  which does sign them). */
router.post("/:cardId/generate", requireAuth, requireModerator, async (req, res, next) => {
  const cardId = normalizeCardId(req.params.cardId);
  if (!isKnownStudioCoverCard(cardId)) {
    res.status(400).json({ error: `Unknown card id "${cardId}"`, knownIds: Object.keys(STUDIO_COVER_SUBJECTS) });
    return;
  }
  const count = Number.isInteger(req.body?.count) ? Math.min(Math.max(req.body.count, 1), 8) : 4;
  const variant = normalizeVariant(req.body?.variant);
  try {
    const candidates = await generateStudioCoverArtCandidates(cardId, count, variant);
    res.json({ cardId, variant, generated: candidates });
  } catch (error) {
    next(error);
  }
});

/** POST /config/studio-cover-art/:cardId/select — admin-only. Body:
 *  { objectPath: string } — must be one of that card's existing candidates. */
router.post("/:cardId/select", requireAuth, requireModerator, async (req, res, next) => {
  const cardId = normalizeCardId(req.params.cardId);
  const objectPath = req.body?.objectPath;
  if (!isKnownStudioCoverCard(cardId)) {
    res.status(400).json({ error: `Unknown card id "${cardId}"` });
    return;
  }
  if (typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "Provide the objectPath of one of this card's generated candidates." });
    return;
  }
  try {
    await selectStudioCoverArt(cardId, objectPath);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
