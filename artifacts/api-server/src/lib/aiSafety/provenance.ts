/**
 * Provenance registry for AI-generated media (table ai_generated_media).
 *
 * The guard records each generated image's SHA-256 here. Anything that later
 * stores or publishes media (assets, posts) can call isAiGeneratedHash() with
 * the bytes' hash to decide whether to set its own ai_generated flag.
 *
 * Both functions swallow errors: provenance must never break a generation.
 * The DB is imported lazily so the filter modules stay DB-free in unit tests.
 */
import { logger } from "../logger";

export async function recordAiProvenance(input: { ownerId: string; tool: string; sha256: string }): Promise<void> {
  try {
    const { db, aiGeneratedMedia } = await import("@workspace/db");
    await db.insert(aiGeneratedMedia).values(input).onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, tool: input.tool }, "Could not record AI provenance");
  }
}

/** True if any user's AI tool produced media with this hash. */
export async function isAiGeneratedHash(sha256: string): Promise<boolean> {
  try {
    const { db, aiGeneratedMedia } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select({ id: aiGeneratedMedia.id }).from(aiGeneratedMedia)
      .where(eq(aiGeneratedMedia.sha256, sha256)).limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn({ err }, "AI provenance lookup failed");
    return false;
  }
}
