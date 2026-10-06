/**
 * Account display preferences (migration 120, user_display_preferences):
 * caption translation language + auto-translate, in-app text size and
 * high-contrast icons. GET/PATCH /api/display-preferences
 * (routes/display-preferences.ts). The mobile app applies them app-wide
 * (artifacts/mobile/contexts/DisplayPrefsContext.tsx).
 */
import { eq } from "drizzle-orm";
import { db, userDisplayPreferences } from "@workspace/db";
import { z } from "@workspace/api-zod";
import { TRANSLATION_LANGUAGE_CODES, type TranslationLanguageCode } from "./translation";

export const TEXT_SIZES = ["default", "large", "larger"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface DisplayPreferences {
  translationLanguage: TranslationLanguageCode;
  autoTranslateCaptions: boolean;
  textSize: TextSize;
  highContrastIcons: boolean;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  translationLanguage: "en",
  autoTranslateCaptions: false,
  textSize: "default",
  highContrastIcons: false,
};

export const displayPreferencesPatchSchema = z.object({
  translationLanguage: z.enum(TRANSLATION_LANGUAGE_CODES).optional(),
  autoTranslateCaptions: z.boolean().optional(),
  textSize: z.enum(TEXT_SIZES).optional(),
  highContrastIcons: z.boolean().optional(),
}).strict();

/** A stored row (or nothing) as the preferences the API returns. Unknown values fall back to the defaults. */
export function normalizeDisplayPreferences(
  row?: Partial<Record<keyof DisplayPreferences, unknown>> | null,
): DisplayPreferences {
  const d = DEFAULT_DISPLAY_PREFERENCES;
  return {
    translationLanguage: TRANSLATION_LANGUAGE_CODES.includes(row?.translationLanguage as TranslationLanguageCode)
      ? row!.translationLanguage as TranslationLanguageCode
      : d.translationLanguage,
    autoTranslateCaptions: typeof row?.autoTranslateCaptions === "boolean" ? row.autoTranslateCaptions : d.autoTranslateCaptions,
    textSize: TEXT_SIZES.includes(row?.textSize as TextSize) ? row!.textSize as TextSize : d.textSize,
    highContrastIcons: typeof row?.highContrastIcons === "boolean" ? row.highContrastIcons : d.highContrastIcons,
  };
}

export async function loadDisplayPreferences(userId: string): Promise<DisplayPreferences> {
  const [row] = await db.select({
    translationLanguage: userDisplayPreferences.translationLanguage,
    autoTranslateCaptions: userDisplayPreferences.autoTranslateCaptions,
    textSize: userDisplayPreferences.textSize,
    highContrastIcons: userDisplayPreferences.highContrastIcons,
  }).from(userDisplayPreferences).where(eq(userDisplayPreferences.userId, userId)).limit(1);
  return normalizeDisplayPreferences(row ?? null);
}

export async function saveDisplayPreferences(
  userId: string,
  patch: Partial<DisplayPreferences>,
): Promise<DisplayPreferences> {
  const next = normalizeDisplayPreferences({ ...(await loadDisplayPreferences(userId)), ...patch });
  await db.insert(userDisplayPreferences)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userDisplayPreferences.userId,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}
