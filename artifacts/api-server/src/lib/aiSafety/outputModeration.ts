/**
 * Output moderation for AI-generated images, run on the server before the
 * bytes are returned to the client.
 *
 * Reuses the existing omni-moderation image provider (lib/imageModeration.ts)
 * so community uploads and AI outputs share one provider and one test seam.
 *
 * Failure policy: if the check cannot run (no OpenAI key, provider down) the
 * image is returned unless AI_OUTPUT_MODERATION_STRICT=1, in which case it is
 * withheld. Unchecked results are logged. A flagged image is always withheld.
 */
import { createHash } from "node:crypto";
import { moderateImage } from "../imageModeration";
import { logger } from "../logger";

export const AI_OUTPUT_BLOCKED_MESSAGE =
  "This result can't be shown because it may break Brandthread's content rules. Try a different description or photo.";
export const AI_OUTPUT_UNAVAILABLE_MESSAGE =
  "We couldn't check this result right now. Please try again in a moment.";

export type OutputVerdict =
  | { status: "allowed"; checked: boolean }
  | { status: "blocked"; categories: string[] }
  | { status: "unavailable" };

export function sniffImageMime(buf: Buffer): string {
  if (buf.length >= 8 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/png";
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function strictOutputModeration(): boolean {
  return process.env.AI_OUTPUT_MODERATION_STRICT === "1";
}

/**
 * Checks one generated image. Never throws.
 * `checked` is false when moderation could not run and the image was let through.
 */
export async function moderateGeneratedImage(buf: Buffer): Promise<OutputVerdict> {
  try {
    const verdict = await moderateImage(buf, sniffImageMime(buf));
    if (verdict.status === "rejected") return { status: "blocked", categories: verdict.categories };
    if (verdict.status === "allowed") return { status: "allowed", checked: true };
    if (strictOutputModeration()) return { status: "unavailable" };
    logger.warn("AI output returned without image moderation (provider unavailable)");
    return { status: "allowed", checked: false };
  } catch (err) {
    logger.warn({ err }, "AI output moderation threw");
    return strictOutputModeration() ? { status: "unavailable" } : { status: "allowed", checked: false };
  }
}
