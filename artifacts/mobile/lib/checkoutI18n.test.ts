import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_LANGUAGES, CHECKOUT_TRANSLATIONS, TRANSLATED_LANGUAGES, languageFromLocale, resolveCheckoutLanguage,
  templateParts, translateCheckout,
} from './checkoutI18n';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).slice().sort();

describe('checkout language rule', () => {
  it('uses the store language for a single-seller checkout', () => {
    expect(resolveCheckoutLanguage({ sellerLanguages: ['fr'], deviceLocale: 'de-DE' })).toBe('fr');
    expect(resolveCheckoutLanguage({ sellerLanguages: ['en'], deviceLocale: 'es-MX' })).toBe('en');
    // Unknown (still loading, or unsupported) → English.
    expect(resolveCheckoutLanguage({ sellerLanguages: [undefined], deviceLocale: 'es-MX' })).toBe('en');
    expect(resolveCheckoutLanguage({ sellerLanguages: ['xx'], deviceLocale: 'es-MX' })).toBe('en');
  });

  it('uses the device language (else English) for a multi-seller cart', () => {
    expect(resolveCheckoutLanguage({ sellerLanguages: ['fr', 'ja'], deviceLocale: 'es-MX' })).toBe('es');
    expect(resolveCheckoutLanguage({ sellerLanguages: ['fr', 'ja'], deviceLocale: 'zh-Hans-CN' })).toBe('zh');
    expect(resolveCheckoutLanguage({ sellerLanguages: ['fr', 'ja'], deviceLocale: 'nl-NL' })).toBe('en');
    expect(resolveCheckoutLanguage({ sellerLanguages: ['fr', 'ja'], deviceLocale: null })).toBe('en');
    expect(languageFromLocale('pt_BR')).toBe('pt');
  });

  it('covers the Languages screen list', () => {
    expect([...CHECKOUT_LANGUAGES]).toEqual(['en', 'es', 'fr', 'de', 'pt', 'zh', 'ja', 'ko', 'ar', 'it']);
  });
});

describe('string tables', () => {
  it('translate every string into every store language, keeping placeholders', () => {
    const english = new Set<string>();
    for (const [en, row] of CHECKOUT_TRANSLATIONS) {
      expect(english.has(en), `duplicate row: ${en}`).toBe(false);
      english.add(en);
      for (const lang of TRANSLATED_LANGUAGES) {
        expect(row[lang], `${lang}: ${en}`).toBeTruthy();
        expect(placeholders(row[lang]), `${lang}: ${en}`).toEqual(placeholders(en));
      }
    }
    expect(english.size).toBeGreaterThan(150);
  });

  it('translates templates and already-filled English copy', () => {
    expect(translateCheckout('fr', 'Pay {amount}', { amount: '$48.00' })).toBe('Payer $48.00');
    expect(translateCheckout('de', 'Ships in 4 business days')).toBe('Versand in 4 Werktagen');
    expect(translateCheckout('ja', 'Subtotal ({n} items)', { n: 3 })).toBe('小計（3点）');
    expect(translateCheckout('es', 'Secured by Stripe. Items from 2 sellers are paid in 2 separate secure payments.'))
      .toBe('Protegido por Stripe. Los artículos de 2 vendedores se pagan en 2 pagos seguros separados.');
    expect(translateCheckout('en', 'Pay {amount}', { amount: '$1.00' })).toBe('Pay $1.00');
    // Copy outside the tables (e.g. a server message) stays as it is.
    expect(translateCheckout('it', 'Something custom from the server')).toBe('Something custom from the server');
  });

  it('splits the terms line around its links', () => {
    expect(templateParts('es', 'By placing your order you agree to the {terms} and {privacy}.')).toEqual([
      { text: 'Al realizar tu pedido aceptas los ' }, { slot: 'terms' }, { text: ' y la ' }, { slot: 'privacy' }, { text: '.' },
    ]);
  });
});
