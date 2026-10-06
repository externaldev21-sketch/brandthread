/**
 * Caption / comment translation (server: POST /api/translate, api-server
 * lib/translation.ts). Pure helpers: the languages a viewer can translate
 * into, a cheap on-device language guess that decides whether to offer
 * "See translation" without any network call, and a small in-memory cache
 * so a caption is fetched once per session.
 */

export type TranslationLanguage = { code: string; name: string; nativeName: string };

/** Same languages as the seller Languages screen (app/languages.tsx) and the server's list. */
export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
];

export function translationLanguageName(code: string | undefined): string {
  return TRANSLATION_LANGUAGES.find(l => l.code === code)?.name ?? 'English';
}

export interface TranslationResult {
  text: string;
  translatedText: string;
  detectedLanguage: string;
  sameLanguage: boolean;
}

/** Strips what never needs translating: links, @handles, #tags, emoji, digits. */
export function translatableContent(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_.]+/gu, ' ')
    .replace(/[^\p{L}\s'’]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SCRIPTS: Array<[RegExp, string]> = [
  [/[가-힯ᄀ-ᇿ]/, 'ko'],
  [/[぀-ヿ]/, 'ja'],
  [/[一-鿿]/, 'zh'],
  [/[؀-ۿ]/, 'ar'],
  [/[Ѐ-ӿ]/, 'ru'],
  [/[֐-׿]/, 'he'],
  [/[Ͱ-Ͽ]/, 'el'],
  [/[฀-๿]/, 'th'],
  [/[ऀ-ॿ]/, 'hi'],
];

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'this', 'that', 'with', 'for', 'you', 'my', 'of', 'to', 'in', 'it', 'on', 'new', 'just', 'our', 'your', 'out', 'now', 'love', 'what', 'have', 'from', 'all', 'so', 'be', 'we', 'i'],
  es: ['el', 'la', 'los', 'las', 'que', 'y', 'es', 'en', 'de', 'un', 'una', 'para', 'con', 'mi', 'por', 'muy', 'nuevo', 'nueva', 'del', 'lo', 'este', 'esta', 'hola', 'pero', 'como', 'más', 'tu', 'gracias', 'hoy', 'ya'],
  fr: ['le', 'la', 'les', 'et', 'est', 'un', 'une', 'des', 'pour', 'avec', 'mon', 'ma', 'mes', 'dans', 'sur', 'nouveau', 'nouvelle', 'du', 'ce', 'cette', 'je', 'vous', 'nous', 'pas', 'très', 'bonjour', 'merci', 'qui', 'au', 'aux'],
  de: ['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'mit', 'für', 'mein', 'meine', 'ich', 'nicht', 'auf', 'neue', 'neu', 'den', 'dem', 'zu', 'sehr', 'wir', 'sie', 'es', 'im', 'auch', 'danke', 'heute', 'von', 'jetzt', 'bei'],
  pt: ['o', 'a', 'os', 'as', 'e', 'é', 'um', 'uma', 'para', 'com', 'meu', 'minha', 'em', 'do', 'da', 'dos', 'das', 'novo', 'nova', 'não', 'muito', 'que', 'obrigado', 'obrigada', 'você', 'hoje', 'mais', 'isso', 'esta', 'está'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'e', 'è', 'un', 'una', 'per', 'con', 'mio', 'mia', 'nel', 'della', 'del', 'di', 'che', 'nuovo', 'nuova', 'non', 'molto', 'sono', 'questo', 'questa', 'grazie', 'oggi', 'ciao', 'anche', 'alla'],
};

const DIACRITIC_HINTS: Array<[RegExp, string]> = [
  [/ñ|¿|¡/, 'es'],
  [/[ãõ]|ção|ções/, 'pt'],
  [/ß|[äöü]/, 'de'],
  [/[œ]|[êëîôû]|ç(?!ão)/, 'fr'],
];

/**
 * Best on-device guess at a text's language (ISO 639-1), or null when the
 * text is too short or too mixed to tell. Script-based for non-Latin text,
 * stopword-based for the Latin languages. The server's detection is the one
 * that decides what comes back; this only decides whether to offer the link.
 */
export function guessLanguage(text: string): string | null {
  const content = translatableContent(text);
  if (!content) return null;
  for (const [pattern, code] of SCRIPTS) {
    if (pattern.test(content)) return code;
  }
  const lower = content.toLowerCase();
  const words = lower.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const scores: Record<string, number> = {};
  for (const word of words) {
    for (const [code, list] of Object.entries(STOPWORDS)) {
      if (list.includes(word)) scores[code] = (scores[code] ?? 0) + 1;
    }
  }
  for (const [pattern, code] of DIACRITIC_HINTS) {
    if (pattern.test(lower)) scores[code] = (scores[code] ?? 0) + 2;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < 2) return null;
  if (second && second[1] === best[1]) return null;
  return best[0];
}

/** Offer "See translation" when the text looks like it is in another language than the viewer's. */
export function shouldOfferTranslation(text: string | null | undefined, targetLanguage: string): boolean {
  if (!text) return false;
  const guess = guessLanguage(text);
  return guess !== null && guess !== targetLanguage;
}

/** Session cache of server results, keyed by target language + text. */
export class TranslationMemo {
  private readonly results = new Map<string, TranslationResult>();
  private readonly inflight = new Map<string, Promise<TranslationResult>>();

  private key(text: string, lang: string) { return `${lang}\u0000${text.trim()}`; }

  peek(text: string, lang: string): TranslationResult | undefined {
    return this.results.get(this.key(text, lang));
  }

  /** Resolves from the cache, an in-flight request, or `fetcher` (called once per text + language). */
  get(text: string, lang: string, fetcher: () => Promise<TranslationResult>): Promise<TranslationResult> {
    const key = this.key(text, lang);
    const hit = this.results.get(key);
    if (hit) return Promise.resolve(hit);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const request = fetcher().then(
      (result) => { this.results.set(key, result); this.inflight.delete(key); return result; },
      (error) => { this.inflight.delete(key); throw error; },
    );
    this.inflight.set(key, request);
    return request;
  }

  clear() { this.results.clear(); this.inflight.clear(); }
}
