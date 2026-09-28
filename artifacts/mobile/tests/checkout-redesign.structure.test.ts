/**
 * Guards for the checkout redesign (GOAT Order Review–based rebuild):
 *  - no pressable nested inside another pressable anywhere on the screen
 *    (the Discover "For You" nested-<button> bug class, fixed in #213);
 *  - the price breakdown renders once, the footer CTA carries the total;
 *  - terms are a plain line with links, not a checkbox;
 *  - no-bounce scroll views; the chat composer's bottom-inset floor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const PRESSABLE_TAGS = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'PressableScale', 'Button', 'IconButton'];

const CHECKOUT_FILES = [
  'app/buyer-checkout.tsx',
  ...readdirSync(resolve(process.cwd(), 'components/checkout'))
    .filter(name => name.endsWith('.tsx'))
    .map(name => `components/checkout/${name}`),
];

/** Index of the `>` closing the JSX opening tag starting at `start`, skipping `{…}` expressions (so `=>` doesn't count). */
function tagEnd(source: string, start: number): number {
  let braces = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '>' && braces === 0) return i;
  }
  return -1;
}

function maxPressableNestingDepth(source: string): number {
  const pattern = new RegExp(`<(/?)(?:${PRESSABLE_TAGS.join('|')})(?=[\\s>/])`, 'g');
  let depth = 0;
  let maxDepth = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1] === '/') { depth = Math.max(0, depth - 1); continue; }
    const end = tagEnd(source, match.index);
    const selfClosing = end > 0 && source[end - 1] === '/';
    depth += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (selfClosing) depth -= 1;
  }
  return maxDepth;
}

describe('checkout never nests a pressable inside another pressable', () => {
  for (const file of CHECKOUT_FILES) {
    it(`${file}`, () => {
      expect(maxPressableNestingDepth(read(file))).toBeLessThanOrEqual(1);
    });
  }

  it('the scanner itself catches a nested button', () => {
    expect(maxPressableNestingDepth('<PressableScale onPress={() => a()}><Button label="x" onPress={() => b()} /></PressableScale>')).toBe(2);
    expect(maxPressableNestingDepth('<PressableScale onPress={() => a()} /><Button label="x" onPress={() => b()} />')).toBe(1);
  });
});

describe('checkout screen structure', () => {
  const screen = read('app/buyer-checkout.tsx');

  it('has a Checkout title and a close (X) button', () => {
    expect(screen).toContain("header('Checkout', leaveCheckout, 'Close checkout')");
    expect(screen).toContain('name="x"');
  });

  it('renders the price breakdown exactly once and puts the live total in the CTA label', () => {
    expect(screen.match(/<PriceBreakdownCard\b/g)).toHaveLength(1);
    expect(screen).toContain("`${canRetryPayment ? 'Try again' : 'Place order'} · ${formatCents(totals.totalCents)}`");
    // No separate "Total" row in the sticky footer any more.
    expect(screen).not.toContain('stickyTotalRow');
  });

  it('item 110: the breakdown folds into the footer total, a sibling of Place order', () => {
    const footer = screen.slice(screen.indexOf('<StickyFooter'), screen.indexOf('</StickyFooter>'));
    expect(footer).toContain('<PriceBreakdownCard');
    expect(footer).toContain('collapsible={{');
    // The toggle and Place order are separate controls, not nested.
    expect(footer.indexOf('<PriceBreakdownCard')).toBeLessThan(footer.indexOf('testID="checkout-place-order"'));
    const card = read('components/checkout/PriceBreakdownCard.tsx');
    expect(card).toContain('Easing.out(Easing.cubic)');
    expect(card).not.toMatch(/Animated\.spring|bounciness/);
    expect(card).toContain('isReduceMotionEnabled');
    expect(card).toContain('accessibilityState={{ expanded }}');
  });

  it('gates Place order on checkoutReadiness and shows what is missing', () => {
    expect(screen).toContain('getCheckoutBlockingSection(contact, address, current) === null');
    expect(screen).toContain('disabled={!ready}');
    expect(screen).toContain('getCheckoutNextStepHint(');
  });

  it('uses a plain terms line with links instead of a terms checkbox', () => {
    expect(screen).toContain('<CheckoutTermsLine />');
    expect(screen).toContain('withoutImplicitTermsAck(');
    const terms = read('components/checkout/CheckoutTermsLine.tsx');
    expect(terms).toContain("link('Terms of Service', LEGAL_DOCUMENTS.terms.route)");
    expect(terms).toContain("link('Privacy Policy', LEGAL_DOCUMENTS.privacy.route)");
    expect(read('services/cartService.ts')).not.toContain("label: 'I agree to the Brandthread Terms of Service and Refund Policy.'");
  });

  it('keeps the sticky footer off the bottom edge with the composer inset floor', () => {
    expect(screen).toContain('Math.max(insets.bottom, SP.sm) + SP.sm');
  });

  it('never bounces its scroll views', () => {
    const scrollViews = [screen, read('components/checkout/ShippingAddressCard.tsx')]
      .flatMap(source => source.split('<ScrollView').slice(1))
      // Skip type arguments like useRef<ScrollView>(null) — only JSX tags.
      .filter(chunk => /^\s/.test(chunk))
      .map(chunk => chunk.slice(0, tagEnd(chunk, 0)));
    expect(scrollViews.length).toBeGreaterThanOrEqual(3);
    for (const props of scrollViews) {
      expect(props).toContain('bounces={false}');
      expect(props).toContain('overScrollMode="never"');
    }
  });

  it('keeps every existing payment/order call', () => {
    for (const call of [
      'api.buyer.checkout.createSession(',
      'api.guest.checkout.createSession(',
      'WebBrowser.openBrowserAsync(result.url)',
      'api.buyer.checkout.verifySession(',
      'api.guest.checkout.verifySession(',
      'validateCart(',
      'removeCartItems(',
      'api.buyer.addresses.create(',
      "trackAndRelayConversionEvent(\n            'Purchase'",
      "createCheckoutSession(cart, source === 'buynow')",
    ]) {
      expect(screen).toContain(call);
    }
  });

  it('routes Track order with the verified order id only', () => {
    const confirmation = read('components/checkout/OrderConfirmation.tsx');
    expect(confirmation).toContain("'/buyer-order-detail?id=' + encodeURIComponent(firstVerified.id)");
    expect(confirmation).toContain('disabled={!firstVerified?.id}');
  });
});
