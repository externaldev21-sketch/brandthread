/**
 * Studio carousel "album cover" art — server-side generation.
 *
 * Dev's brief: real dark-studio, chrome/black/silver hero-object photographs
 * per card, "album covers or Apple product-launch hero art... one cohesive
 * series (same dark studio, same lighting language, same black/silver/
 * chrome palette, same camera angle and composition grid), but each card
 * gets its own hero object AND its own signature light colour temperature/
 * texture accent (e.g. brushed steel vs mirror chrome vs matte black
 * ceramic, different backdrop textures: seamless paper, concrete, velvet,
 * glass). Go Live keeps one small red light as its only colour."
 *
 * Reuses this app's existing image-generation integration (the same
 * gpt-image-1 setup already used for AI logos/mockups/photography/lifestyle
 * — see @workspace/integrations-openai-ai-server/image) rather than adding
 * a new provider. gpt-image-1 doesn't support the exact 1170x2532 pixel
 * size Dev asked for — its only sizes are 1024x1024, 1024x1536, 1536x1024,
 * and "auto" — so this generates at 1024x1536 (the closest portrait size)
 * and lets the app's own image pipeline scale/crop for display, same as
 * every other AI-generated image in this app already does.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { encode as encodeBlurhash } from "blurhash";
import { and, eq } from "drizzle-orm";
import { db, studioCoverArt } from "@workspace/db";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { ObjectStorageService } from "./objectStorage";

const objectStorage = new ObjectStorageService();

/** The Studio carousel's current 14 cards (components/SellerStudioRadialMenu.tsx's
 *  CARD_ORDER in the mobile app) — kept here as the single source of truth
 *  for which ids this job knows how to generate for for. If the carousel's
 *  own card list changes, this map is where a new entry gets added. */
export const STUDIO_COVER_SUBJECTS: Record<string, { object: string; materialAccent: string; backdropTexture: string }> = {
  "post-video": { object: "a chrome camera-phone propped upright with a small clapperboard leaning against its base", materialAccent: "polished mirror chrome finish", backdropTexture: "seamless white paper" },
  "add-product": { object: "a chrome garment hanger holding a single folded t-shirt, resting on a low pedestal", materialAccent: "brushed steel finish", backdropTexture: "seamless black paper" },
  "go-live": { object: "a chrome broadcast camera with exactly one small red tally light built into its housing (the only color allowed in the frame)", materialAccent: "polished mirror chrome finish", backdropTexture: "dark concrete" },
  "analytics": { object: "a rising sculptural stack of bars, like a bar chart cast in solid metal", materialAccent: "brushed steel finish", backdropTexture: "seamless grey paper" },
  "payouts": { object: "a short stack of coins with one coin frozen mid-flip just above the stack", materialAccent: "polished mirror chrome finish", backdropTexture: "dark velvet" },
  "customers": { object: "a small group of three featureless human figurines standing together", materialAccent: "matte black ceramic finish", backdropTexture: "seamless black paper" },
  "community": { object: "three interlocking rings, like a Venn diagram cast in solid metal", materialAccent: "polished mirror chrome finish", backdropTexture: "frosted glass" },
  "manufacturer": { object: "a single sewing machine", materialAccent: "brushed steel finish", backdropTexture: "dark concrete" },
  "design-studio": { object: "a stylus pen captured mid-stroke, drawing one light line across a surface", materialAccent: "polished mirror chrome finish", backdropTexture: "seamless white paper" },
  "mockup-to-model": { object: "a featureless mannequin torso on a stand", materialAccent: "matte black ceramic finish", backdropTexture: "seamless grey paper" },
  "remove-bg": { object: "a sphere, one half solid and the other half dissolving into a fine spray of particles", materialAccent: "polished mirror chrome finish", backdropTexture: "dark velvet" },
  "ai-design": { object: "a garment assembling itself mid-air from a swirl of fine metallic particles", materialAccent: "brushed steel finish", backdropTexture: "seamless black paper" },
  "campaign-gen": { object: "a megaphone", materialAccent: "polished mirror chrome finish", backdropTexture: "dark concrete" },
  "ai-photoshoot": { object: "a studio light stand standing beside a camera on a tripod", materialAccent: "matte black ceramic finish", backdropTexture: "frosted glass" },
};

export function isKnownStudioCoverCard(cardId: string): boolean {
  return Object.prototype.hasOwnProperty.call(STUDIO_COVER_SUBJECTS, cardId);
}

/** One shared template so every card reads as the same series — only the
 *  hero object, its material, and the backdrop texture vary per card. */
export function buildStudioCoverArtPrompt(cardId: string): string {
  const subject = STUDIO_COVER_SUBJECTS[cardId];
  if (!subject) throw new Error(`No cover-art subject defined for card id "${cardId}"`);
  return [
    `Product-launch hero photograph, single ${subject.object}, ${subject.materialAccent},`,
    `centered on a ${subject.backdropTexture} seamless studio backdrop,`,
    "one large overhead softbox, crisp specular highlights and reflections, subtle floor reflection,",
    "shallow depth of field, fine film grain, strictly monochrome black/silver palette",
    "(no color anywhere in the frame except where the subject's own description says otherwise),",
    "no text, no logo, no watermark, shot straight-on at eye level, 9:16 portrait composition.",
  ].join(" ");
}

const GENERATION_SIZE = "1024x1536" as const;

export interface StudioCoverCandidate {
  objectPath: string;
  createdAt: string;
}

/** Generates `count` fresh candidates for one card, uploads each to object
 *  storage, and appends them to that card's row (never replacing earlier
 *  candidates — a re-run adds more options rather than losing prior ones). */
export async function generateStudioCoverArtCandidates(
  cardId: string,
  count = 4,
): Promise<StudioCoverCandidate[]> {
  if (!isKnownStudioCoverCard(cardId)) {
    throw new Error(`Unknown Studio cover-art card id: "${cardId}"`);
  }
  const prompt = buildStudioCoverArtPrompt(cardId);

  const fresh: StudioCoverCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const buffer = await generateImageBuffer(prompt, GENERATION_SIZE, { quality: "high" });
    const objectPath = `/objects/studio-cover-art/${cardId}/${randomUUID()}.png`;
    await objectStorage.createObjectEntityFromBuffer(buffer, "image/png", objectPath);
    fresh.push({ objectPath, createdAt: new Date().toISOString() });
  }

  const [existing] = await db.select().from(studioCoverArt).where(eq(studioCoverArt.cardId, cardId)).limit(1);
  const candidates = [...(existing?.candidates ?? []), ...fresh];
  await db
    .insert(studioCoverArt)
    .values({ cardId, candidates, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: studioCoverArt.cardId,
      set: { candidates, updatedAt: new Date() },
    });

  // Dev: "the manifest picks candidate 1 by default so the app has covers
  // immediately, and I can swap picks after reviewing" — only on a card's
  // FIRST-ever generation (never overwrites a pick an admin already made on
  // a later re-run).
  if (!existing?.chosenObjectPath) {
    await selectStudioCoverArt(cardId, candidates[0].objectPath);
  }

  return fresh;
}

/** Marks one of a card's existing candidates as the chosen cover, computing
 *  and storing its blurhash so the app never has to decode the full image
 *  just to show a placeholder. */
export async function selectStudioCoverArt(cardId: string, objectPath: string): Promise<void> {
  const [row] = await db.select().from(studioCoverArt).where(eq(studioCoverArt.cardId, cardId)).limit(1);
  if (!row || !row.candidates.some((c) => c.objectPath === objectPath)) {
    throw new Error(`"${objectPath}" is not a known candidate for card "${cardId}"`);
  }

  const file = await objectStorage.getObjectEntityFile(objectPath);
  const [buffer] = await file.download();
  // Downscaled hard for the blurhash encode itself (blurhash only needs a
  // handful of pixels to describe a placeholder) — never the size actually
  // served to the app.
  const { data, info } = await sharp(buffer)
    .resize(32, 32, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const blurhash = encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 4);

  await db
    .update(studioCoverArt)
    .set({ chosenObjectPath: objectPath, chosenBlurhash: blurhash, updatedAt: new Date() })
    .where(and(eq(studioCoverArt.cardId, cardId)));
}

export interface StudioCoverManifestEntry {
  url: string;
  blurhash: string | null;
}

/** Every card with a chosen cover, as a signed (1hr) GET URL — the same
 *  "store privately, sign a URL on each read" pattern this app already uses
 *  for every other object-storage-backed image (see e.g.
 *  routes/manufacturer-public.ts), just with a longer TTL than the 15min
 *  default since these covers are meant to stay visible for a whole Studio
 *  page visit, not one quick read. */
export async function getStudioCoverArtManifest(): Promise<Record<string, StudioCoverManifestEntry>> {
  const rows = await db.select().from(studioCoverArt);
  const manifest: Record<string, StudioCoverManifestEntry> = {};
  await Promise.all(rows.map(async (row) => {
    if (!row.chosenObjectPath) return;
    const url = await objectStorage.getObjectEntityDownloadURL(row.chosenObjectPath, 3600);
    manifest[row.cardId] = { url, blurhash: row.chosenBlurhash ?? null };
  }));
  return manifest;
}
