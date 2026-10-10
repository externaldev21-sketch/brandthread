/**
 * Caption / comment translation for POST /api/translate (routes/translate.ts).
 *
 * Uses the server-side OpenAI integration (lib/integrations-openai-ai-server,
 * env AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY); the
 * key never leaves the server. Every result is cached in translation_cache
 * (migration 120) keyed by sha256(target language + NUL + text), so a caption
 * many viewers translate costs one model call. When the integration is not
 * configured the route answers 503 TRANSLATION_NOT_CONFIGURED — it never
 * returns the original text dressed up as a translation.
 */
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, translationCache } from "@workspace/db";
import { z } from "@workspace/api-zod";

/** Same set as the seller Languages screen (artifacts/mobile/app/languages.tsx). */
export const TRANSLATION_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "it", name: "Italian" },
] as const;
export const TRANSLATION_LANGUAGE_CODES = ["en", "es", "fr", "de", "pt", "zh", "ja", "ko", "ar", "it"] as const;
export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGE_CODES)[number];

export const MAX_TRANSLATE_TEXTS = 20;
export const MAX_TRANSLATE_TEXT_CHARS = 2200;
export const TRANSLATION_MODEL = "gpt-5.4-mini";

export const translateBodySchema = z.object({
  texts: z.array(z.string().max(MAX_TRANSLATE_TEXT_CHARS)).min(1).max(MAX_TRANSLATE_TEXTS),
  targetLanguage: z.enum(TRANSLATION_LANGUAGE_CODES),
});

export interface TranslationResult {
  text: string;
  translatedText: string;
  /** ISO 639-1 code of the source text, or "und" when it has no language (emoji, numbers). */
  detectedLanguage: string;
  /** The source is already in the target language; `translatedText` is the source. */
  sameLanguage: boolean;
}

export class TranslationNotConfiguredError extends Error {
  constructor() {
    super("Translation is not configured");
    this.name = "TranslationNotConfiguredError";
  }
}

export class TranslationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationFailedError";
  }
}

export function translationConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() && env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim());
}

export function normalizeSourceText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export function translationCacheKey(targetLanguage: string, text: string): string {
  return createHash("sha256").update(`${targetLanguage}\u0000${normalizeSourceText(text)}`).digest("hex");
}

function languageName(code: string): string {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** Text with nothing to translate (emoji, digits, punctuation, @handles, #tags, links). */
export function hasTranslatableText(text: string): boolean {
  const stripped = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#][\p{L}\p{N}_.]+/gu, "");
  return /\p{L}/u.test(stripped);
}

type ModelItem = { detectedLanguage: string; translation: string };

/** Parses the model's JSON; throws TranslationFailedError when it does not match the request. */
export function parseModelItems(raw: string, expected: number): ModelItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TranslationFailedError("Model returned invalid JSON");
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length !== expected) {
    throw new TranslationFailedError("Model returned the wrong number of translations");
  }
  return items.map((item) => {
    const value = item as Record<string, unknown>;
    const translation = typeof value.translation === "string" ? value.translation : null;
    const detected = typeof value.detectedLanguage === "string" ? value.detectedLanguage.trim().toLowerCase() : "";
    if (translation === null) throw new TranslationFailedError("Model returned an item without a translation");
    return { detectedLanguage: /^[a-z]{2,3}$/.test(detected) ? detected : "und", translation };
  });
}

async function translateWithModel(texts: string[], targetLanguage: TranslationLanguageCode): Promise<ModelItem[]> {
  // Lazy: the integration's client throws at import when its env is missing.
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const completion = await openai.chat.completions.create({
    model: TRANSLATION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `You translate short social media captions and comments into ${languageName(targetLanguage)} (${targetLanguage}). ` +
          "For each input string, detect its language (ISO 639-1 code, or \"und\" if it has no language) and translate it. " +
          "Keep emoji, @mentions, #hashtags, links, line breaks and the author's tone. " +
          "If a string is already in the target language, return it unchanged. Never add commentary. " +
          'Answer with JSON only: {"items":[{"detectedLanguage":"xx","translation":"..."}]} with one item per input, in order.',
      },
      { role: "user", content: JSON.stringify({ texts }) },
    ],
  });
  return parseModelItems(completion.choices?.[0]?.message?.content ?? "", texts.length);
}

/**
 * Translates `texts` into `targetLanguage`, serving cached results and
 * translating only the misses (one model call for all of them).
 */
export async function translateTexts(
  texts: string[],
  targetLanguage: TranslationLanguageCode,
): Promise<TranslationResult[]> {
  const results: Array<TranslationResult | null> = texts.map((text) =>
    hasTranslatableText(text)
      ? null
      : { text, translatedText: text, detectedLanguage: "und", sameLanguage: true });

  const pendingIdx = results.flatMap((r, i) => (r === null ? [i] : []));
  if (pendingIdx.length === 0) return results as TranslationResult[];

  const keys = pendingIdx.map((i) => translationCacheKey(targetLanguage, texts[i]!));
  const cached = await db.select({
    cacheKey: translationCache.cacheKey,
    detectedLanguage: translationCache.detectedLanguage,
    translatedText: translationCache.translatedText,
  }).from(translationCache).where(inArray(translationCache.cacheKey, Array.from(new Set(keys))));
  const byKey = new Map(cached.map((row) => [row.cacheKey, row]));

  const misses: number[] = [];
  pendingIdx.forEach((i, n) => {
    const hit = byKey.get(keys[n]!);
    if (hit) {
      results[i] = {
        text: texts[i]!,
        translatedText: hit.translatedText,
        detectedLanguage: hit.detectedLanguage,
        sameLanguage: hit.detectedLanguage === targetLanguage,
      };
    } else {
      misses.push(i);
    }
  });

  if (misses.length > 0) {
    if (!translationConfigured()) throw new TranslationNotConfiguredError();
    // Identical strings in one request are translated once.
    const uniqueSources = Array.from(new Set(misses.map((i) => normalizeSourceText(texts[i]!))));
    const items = await translateWithModel(uniqueSources, targetLanguage);
    const bySource = new Map(uniqueSources.map((source, n) => {
      const item = items[n]!;
      const same = item.detectedLanguage === targetLanguage;
      return [source, { detectedLanguage: item.detectedLanguage, translatedText: same ? source : item.translation }];
    }));
    for (const i of misses) {
      const hit = bySource.get(normalizeSourceText(texts[i]!))!;
      results[i] = {
        text: texts[i]!,
        translatedText: hit.translatedText,
        detectedLanguage: hit.detectedLanguage,
        sameLanguage: hit.detectedLanguage === targetLanguage,
      };
    }
    await db.insert(translationCache)
      .values(uniqueSources.map((source) => ({
        cacheKey: translationCacheKey(targetLanguage, source),
        targetLanguage,
        detectedLanguage: bySource.get(source)!.detectedLanguage,
        translatedText: bySource.get(source)!.translatedText,
      })))
      .onConflictDoNothing();
  }
  return results as TranslationResult[];
}
