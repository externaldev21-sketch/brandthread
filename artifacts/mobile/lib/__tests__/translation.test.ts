import { describe, expect, it, vi } from 'vitest';
import {
  TranslationMemo, guessLanguage, shouldOfferTranslation, translatableContent, translationLanguageName, translationLinkLabel,
} from '../translation';

describe('guessLanguage', () => {
  it('detects non-Latin scripts', () => {
    expect(guessLanguage('새로운 컬렉션 출시')).toBe('ko');
    expect(guessLanguage('新しいコレクションです')).toBe('ja');
    expect(guessLanguage('新品上市')).toBe('zh');
    expect(guessLanguage('مجموعة جديدة')).toBe('ar');
  });

  it('detects Latin languages from common words', () => {
    expect(guessLanguage('Hola amigos, nuevo drop hoy para todos')).toBe('es');
    expect(guessLanguage('The new drop is live, link in my bio')).toBe('en');
    expect(guessLanguage('Nouvelle collection pour vous, merci')).toBe('fr');
    expect(guessLanguage('Die neue Kollektion ist da und sehr schön')).toBe('de');
    expect(guessLanguage('Nova coleção para você, muito obrigada')).toBe('pt');
    expect(guessLanguage('Ciao, la nuova collezione è qui per voi, grazie')).toBe('it');
  });

  it('gives up on text too short or with nothing to read', () => {
    expect(guessLanguage('🔥🔥🔥')).toBeNull();
    expect(guessLanguage('#ootd @maison https://x.y')).toBeNull();
    expect(guessLanguage('Vibes')).toBeNull();
  });
});

describe('shouldOfferTranslation', () => {
  it('offers only when the guess differs from the viewer language', () => {
    expect(shouldOfferTranslation('Hola amigos, nuevo drop hoy', 'en')).toBe(true);
    expect(shouldOfferTranslation('Hola amigos, nuevo drop hoy', 'es')).toBe(false);
    expect(shouldOfferTranslation('The new drop is live for you', 'en')).toBe(false);
    expect(shouldOfferTranslation('', 'en')).toBe(false);
    expect(shouldOfferTranslation(null, 'en')).toBe(false);
  });
});

describe('helpers', () => {
  it('strips links, handles and tags before guessing', () => {
    expect(translatableContent('Nuevo drop @maison #ootd https://bt.app/x 🔥')).toBe('Nuevo drop');
  });

  it('names languages', () => {
    expect(translationLanguageName('es')).toBe('Spanish');
    expect(translationLanguageName('xx')).toBe('English');
  });
});

describe('TranslationMemo', () => {
  const result = { text: 'Hola', translatedText: 'Hello', detectedLanguage: 'es', sameLanguage: false };

  it('fetches once per text and language, sharing in-flight requests', async () => {
    const memo = new TranslationMemo();
    const fetcher = vi.fn(async () => result);
    const [a, b] = await Promise.all([memo.get('Hola', 'en', fetcher), memo.get(' Hola ', 'en', fetcher)]);
    expect(a).toBe(result);
    expect(b).toBe(result);
    await memo.get('Hola', 'en', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(memo.peek('Hola', 'en')).toBe(result);
    expect(memo.peek('Hola', 'fr')).toBeUndefined();
  });

  it('does not cache failures', async () => {
    const memo = new TranslationMemo();
    await expect(memo.get('Hola', 'en', async () => { throw new Error('503'); })).rejects.toThrow('503');
    const fetcher = vi.fn(async () => result);
    await memo.get('Hola', 'en', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('translationLinkLabel', () => {
  const result = { text: 'Hola', translatedText: 'Hello', detectedLanguage: 'es', sameLanguage: false };
  it('walks the Instagram-style states', () => {
    expect(translationLinkLabel({ offer: false, showingTranslation: false, status: 'idle', result: null })).toBeNull();
    expect(translationLinkLabel({ offer: true, showingTranslation: false, status: 'idle', result: null })).toBe('See translation');
    expect(translationLinkLabel({ offer: true, showingTranslation: false, status: 'loading', result: null })).toBe('Translating…');
    expect(translationLinkLabel({ offer: true, showingTranslation: true, status: 'idle', result })).toBe('See original');
    expect(translationLinkLabel({ offer: true, showingTranslation: false, status: 'unavailable', result: null })).toBe('Translation unavailable');
    expect(translationLinkLabel({ offer: true, showingTranslation: false, status: 'error', result: null })).toBe("Couldn't translate. Tap to retry");
    expect(translationLinkLabel({ offer: true, showingTranslation: false, status: 'idle', result: { ...result, sameLanguage: true } })).toBeNull();
  });
});
