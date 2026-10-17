/**
 * Buyer "app language" preference.
 *
 * English is the only language the app UI is translated into today. The
 * preference is still saved (server: /api/me/settings appLanguage; device:
 * AsyncStorage) so it follows the account and can be honoured once
 * translations exist — but nothing here changes the UI language.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AppLanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

export const APP_LANGUAGES: readonly AppLanguageOption[] = [
  { code: 'en', name: 'English',              nativeName: 'English' },
  { code: 'es', name: 'Spanish',              nativeName: 'Español' },
  { code: 'fr', name: 'French',               nativeName: 'Français' },
  { code: 'de', name: 'German',               nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portuguese',           nativeName: 'Português' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '中文' },
  { code: 'ja', name: 'Japanese',             nativeName: '日本語' },
  { code: 'ko', name: 'Korean',               nativeName: '한국어' },
  { code: 'ar', name: 'Arabic',               nativeName: 'العربية' },
  { code: 'it', name: 'Italian',              nativeName: 'Italiano' },
];

export const DEFAULT_APP_LANGUAGE = 'en';

/** Languages the app UI is actually translated into. */
const TRANSLATED_APP_LANGUAGES = new Set<string>(['en']);

export function isAppUiTranslated(code: string): boolean {
  return TRANSLATED_APP_LANGUAGES.has(normalizeAppLanguage(code));
}

/** Any value -> one of APP_LANGUAGES' codes (unknown -> 'en'). */
export function normalizeAppLanguage(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_APP_LANGUAGE;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return APP_LANGUAGES.some(l => l.code === primary) ? primary : DEFAULT_APP_LANGUAGE;
}

export function appLanguageName(code: string): string {
  return APP_LANGUAGES.find(l => l.code === normalizeAppLanguage(code))?.name ?? 'English';
}

/** Copy shown after saving a language the UI isn't translated into. */
export function untranslatedNotice(code: string): string {
  return `${appLanguageName(code)} is saved as your preferred language, but the Brandthread app isn't translated yet — everything stays in English for now.`;
}

export function appLanguageStorageKey(userId: string | null | undefined): string {
  return userId ? `bt:appLanguage:${userId}` : 'bt:appLanguage';
}

/** Device copy of the preference; null when unset or storage is unavailable. */
export async function readLocalAppLanguage(userId: string | null | undefined): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(appLanguageStorageKey(userId));
    return raw ? normalizeAppLanguage(raw) : null;
  } catch {
    return null;
  }
}

export async function writeLocalAppLanguage(userId: string | null | undefined, code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(appLanguageStorageKey(userId), normalizeAppLanguage(code));
  } catch { /* non-fatal: the server copy is authoritative */ }
}
