/**
 * Image moderation for user-uploaded community photos (gore / violence /
 * nudity). Runs server-side on the raw bytes BEFORE the image is stored or
 * delivered to anyone — a rejected photo never gets a URL.
 *
 * Provider: OpenAI's omni moderation model (accepts images). It is behind a
 * swappable function so tests can inject a verdict, and so the app can move
 * providers without touching routes.
 *
 * Fail-closed: if the check cannot run (provider down / not configured) the
 * photo is NOT delivered; the caller gets an "unavailable" verdict and shows
 * a calm retry message. Text is never run through this — Dev's call is that
 * words are unfiltered; only pictures are.
 */
import { logger } from "./logger";

export type ImageModerationVerdict =
  | { status: "allowed" }
  | { status: "rejected"; categories: string[] }
  | { status: "unavailable" };

export type ImageModerationProvider = (input: { buffer: Buffer; mimeType: string }) => Promise<ImageModerationVerdict>;

/** Calm, non-accusatory copy shown to the uploader. */
export const IMAGE_REJECTED_MESSAGE =
  "This photo can't be shared in Brandthread communities. Try a different one.";
export const IMAGE_UNAVAILABLE_MESSAGE =
  "We couldn't check that photo right now. Please try again in a moment.";

const BLOCKED_CATEGORIES = [
  "sexual",
  "sexual/minors",
  "violence/graphic",
  "self-harm/graphic",
] as const;
/** Plain violence is only blocked when the model is very sure (fight clips, weapons pointed at people…). */
const VIOLENCE_SCORE_THRESHOLD = 0.85;

async function openAiProvider({ buffer, mimeType }: { buffer: Buffer; mimeType: string }): Promise<ImageModerationVerdict> {
  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const result = await openai.moderations.create({
      model: "omni-moderation-latest",
      input: [{ type: "image_url", image_url: { url: dataUrl } }],
    });
    const first = result.results?.[0];
    if (!first) return { status: "unavailable" };
    const flags = first.categories as unknown as Record<string, boolean>;
    const scores = first.category_scores as unknown as Record<string, number>;
    const hit = BLOCKED_CATEGORIES.filter((c) => flags[c]);
    if ((scores["violence"] ?? 0) >= VIOLENCE_SCORE_THRESHOLD) hit.push("violence" as never);
    return hit.length > 0 ? { status: "rejected", categories: [...hit] } : { status: "allowed" };
  } catch (err) {
    logger.warn({ err }, "Image moderation provider failed");
    return { status: "unavailable" };
  }
}

let provider: ImageModerationProvider = openAiProvider;

/** Test seam. Pass nothing to restore the default provider. */
export function setImageModerationProvider(next?: ImageModerationProvider): void {
  provider = next ?? openAiProvider;
}

export async function moderateImage(buffer: Buffer, mimeType: string): Promise<ImageModerationVerdict> {
  return provider({ buffer, mimeType });
}
