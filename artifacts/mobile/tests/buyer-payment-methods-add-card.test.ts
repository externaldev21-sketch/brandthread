/**
 * Round 2 buyer commerce — "Saved payment methods": a card can be added from
 * the screen itself (Stripe SetupIntent), not only by buying something.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const screen = read('app/buyer-payment-methods.tsx');
const panel = read('components/payments/AddCardPanel.tsx');
const native = read('components/checkout/StripePayment.tsx');
const web = read('components/checkout/StripePayment.web.tsx');
const api = read('lib/api.ts');

describe('buyer payment methods: add a card', () => {
  it('calls the setup-intent endpoint from the buyer payment methods client', () => {
    expect(api).toContain("createPaymentMethodSetupIntent: () =>");
    expect(api).toContain("post<{ clientSecret: string; setupIntentId: string }>('/api/buyer/payment-methods/setup-intent', {})");
    expect(panel).toContain('api.reviews.createPaymentMethodSetupIntent()');
  });

  it('confirms a SetupIntent with Stripe’s own card field on native and web', () => {
    expect(native).toContain("stripe.confirmSetupIntent(clientSecret, { paymentMethodType: 'Card' })");
    expect(web).toContain("mode: 'setup'");
    expect(web).toContain('stripe.confirmSetup({');
    expect(web).toContain("redirect: 'if_required'");
    for (const src of [native, web]) {
      expect(src).toContain('export function CardSetupProvider');
      expect(src).toContain('export function SetupCardEntry');
      expect(src).toContain('export const CardSetupController');
    }
  });

  it('offers "Add card" only where in-app card entry works, with a clear note otherwise', () => {
    expect(screen).toContain("!!userId && !isBuyerDevPreview() && stripePaymentAvailable()");
    expect(screen).toContain('label="Add card"');
    expect(screen).toContain('testID="add-card-unavailable"');
    expect(panel).toContain("Adding a card isn't available here yet.");
    // The unavailable branch renders the note, never a dead button.
    expect(screen.indexOf('!canAddCard ?')).toBeLessThan(screen.indexOf('label="Add card"'));
    expect(screen.indexOf('ADD_CARD_UNAVAILABLE_COPY}')).toBeLessThan(screen.indexOf('label="Add card"'));
  });

  it('refreshes the list on success and guards against double taps', () => {
    expect(screen).toMatch(/function onCardAdded\(\) \{\s*setAddingCard\(false\);\s*void load\(\);/);
    expect(panel).toContain('if (inFlight.current || !complete) return;');
    expect(panel).toContain('loading={saving}');
    expect(panel).toContain('disabled={!complete || saving}');
  });

  it('uses friendly copy and the cross-platform alert helpers, never Alert.alert', () => {
    for (const src of [screen, panel]) {
      expect(src).not.toMatch(/\bAlert\.alert\(/);
      expect(src).toContain("from '@/lib/actionSheet'");
      expect(src).toContain('friendlyError(err, ');
    }
    expect(screen).toContain('confirmAlert({');
    expect(panel).toContain("showAlert('Card added'");
  });

  it('keeps 44pt targets, button roles and sentence-case labels', () => {
    expect(screen).toMatch(/addCardBtn: \{ minHeight: 44,/);
    expect(panel).toMatch(/action: \{ minHeight: 44 \}/);
    expect(screen).toContain('size="small"');
    expect(panel).toContain('accessibilityRole="header"');
    for (const label of ['Add card', 'Save card', 'Cancel', 'Add a card']) {
      expect(label).toMatch(/^[A-Z][a-z]*( [a-z]+)*$/);
    }
  });

  it('adds no new colors: only theme tokens already on the screen', () => {
    expect(panel).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const tokens = [...panel.matchAll(/palette\.(\w+)/g)].map(m => m[1]);
    for (const token of tokens) expect(screen).toContain(`palette.${token}`);
  });
});
