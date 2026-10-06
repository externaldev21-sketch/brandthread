/**
 * aiSettingsStore.ts
 *
 * Persistence for per-account AI settings (`ai_assistant_settings`,
 * migration 116). Kept separate from the pure policy helpers in
 * ./aiSettings.ts so routes can be tested with this module mocked.
 */

import { db, aiAssistantSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  DEFAULT_AI_ASSISTANT_SETTINGS,
  normalizeAiSettings,
  type AiAssistantSettings,
} from "./aiSettings";

export interface StoredAiSettings {
  settings: AiAssistantSettings;
  updatedAt: string | null;
}

/** Returns the account's settings, or the defaults when no row exists. Throws on DB error. */
export async function loadAiSettings(userId: string): Promise<StoredAiSettings> {
  const [row] = await db
    .select({ settings: aiAssistantSettings.settings, updatedAt: aiAssistantSettings.updatedAt })
    .from(aiAssistantSettings)
    .where(eq(aiAssistantSettings.userId, userId))
    .limit(1);
  if (!row) return { settings: { ...DEFAULT_AI_ASSISTANT_SETTINGS, dataSources: { ...DEFAULT_AI_ASSISTANT_SETTINGS.dataSources } }, updatedAt: null };
  return {
    settings: normalizeAiSettings(row.settings),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/**
 * Settings used to enforce a request. A read failure falls back to the
 * defaults (the same behavior every seller had before settings were stored
 * server-side) rather than failing the assistant outright; the client also
 * sends its own settings, which mergeStricter() applies on top.
 */
export async function loadAiSettingsForEnforcement(userId: string): Promise<AiAssistantSettings> {
  try {
    return (await loadAiSettings(userId)).settings;
  } catch {
    return normalizeAiSettings(undefined);
  }
}

export async function saveAiSettings(userId: string, raw: unknown): Promise<StoredAiSettings> {
  const settings = normalizeAiSettings(raw);
  const now = new Date();
  await db
    .insert(aiAssistantSettings)
    .values({ userId, settings: settings as unknown as Record<string, unknown>, updatedAt: now })
    .onConflictDoUpdate({
      target: aiAssistantSettings.userId,
      set: { settings: settings as unknown as Record<string, unknown>, updatedAt: now },
    });
  return { settings, updatedAt: now.toISOString() };
}
