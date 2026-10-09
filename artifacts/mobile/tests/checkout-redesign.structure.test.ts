/**
 * Guards for the one-page checkout (Shop "Review & Pay"–based rebuild):
 *  - no pressable nested inside another pressable anywhere on the screen
 *    (the Discover "For You" nested-<button> bug class, fixed in #213);
 *  - flat black page: no card containers, hairline dividers, a header bar
 *    fully below the notch;
 *  - the price breakdown renders once, the sticky CTA carries the total;
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
  const primitives = read('components/checkout/CheckoutPrimitives.tsx');

  it('has a Checkout title and a close (X) button in an opaque bar below the notch', () => {
    expect(screen).toContain("header('Checkout', leaveCheckout, 'Close checkout')");
    expect(screen).toContain('name="x"');
    // The same canonical inset every ScreenHeader uses, so this custom
    // (deliberately flat, theme-independent) header bar can't drift from it.
    expect(screen).toContain("import { useHeaderTopInset } from '@/hooks/useHeaderTopInset'");
    expect(screen).toContain('const headerTop = useHeaderTopInset();');
    expect(screen).toMatch(/header: \{[^}]*backgroundColor: ck\.bg/);
  });

  it('is one flat page: no card containers, hairline dividers, uppercase section labels', () => {
    for (const file of CHECKOUT_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/\bCheckoutCard\b/);
      expect(source, file).not.toMatch(/from '@\/components\/ui\/Glass'/);
    }
    // The checkout's palette now follows the active app theme (useCheckoutColors)
    // instead of a hardcoded black/white CK constant; the default (Monochrome)
    // theme still resolves to the same pure black/white the old CK hardcoded.
    expect(primitives).toContain('export function useCheckoutColors()');
    expect(primitives).toContain('divider: theme.borderSubtle');
    expect(primitives).toContain('bg: theme.background');
    const themeCtx = read('contexts/AppThemeContext.tsx');
    expect(themeCtx).toContain("const MONOCHROME = palette('#000000', '#000000', '#000000', '#FFFFFF'");
    // Section labels are sentence case (BRANDTHREAD_DESIGN.md: no all-caps labels).
    expect(primitives).not.toContain("textTransform: 'uppercase'");
    // Contact, shipping and payment all live on this one screen: no address sheet, no second screen.
    expect(screen).toContain('<ContactSection');
    expect(screen).toContain('<ShippingSection');
    expect(screen).toContain('<PaymentSection');
    expect(read('components/checkout/ShippingSection.tsx')).not.toContain('<Modal');
  });

  it('renders the price breakdown exactly once and puts the live total in the Pay button', () => {
    // GOAT Order review: one Total block (components/checkout/OrderReview.tsx).
    expect(screen.match(/<ReviewTotals\b/g)).toHaveLength(1);
    expect(screen).toContain('`Pay ${formatCents(totals.totalCents)}`');
  });

  it('shows a real delivery window, never "Rate set by seller"', () => {
    for (const file of [...CHECKOUT_FILES, 'services/cartService.ts']) {
      expect(read(file), file).not.toContain('Rate set by seller');
    }
    expect(read('components/checkout/OrderSummarySection.tsx')).toContain('deliveryWindowLabel(');
  });

  it('gates Pay on checkoutReadiness and shows what is missing', () => {
    expect(screen).toContain('getCheckoutBlockingSection(contact, address, current) === null');
    expect(screen).toContain('disabled={!ready}');
    expect(screen).toContain('getCheckoutNextStepHint(');
  });

  it('uses a plain terms line with links instead of a terms checkbox', () => {
    // GOAT's legal line: Buyer Protection Policy + Returns Policy links, no checkbox.
    expect(screen).toContain('<ReviewLegal ');
    const legal = read('components/checkout/OrderReview.tsx');
    expect(legal).toContain('LEGAL_DOCUMENTS.terms.route');
    expect(legal).toContain("LEGAL_DOCUMENTS['refund-policy'].route");
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
    const scrollViews = [screen, primitives]
      .flatMap(source => source.split(/<(?:ScrollView|FlatList)/).slice(1))
      // Skip type arguments like useRef<ScrollView>(null) — only JSX tags.
      .filter(chunk => /^\s/.test(chunk))
      .map(chunk => chunk.slice(0, tagEnd(chunk, 0)));
    expect(scrollViews.length).toBeGreaterThanOrEqual(3);
    for (const props of scrollViews) {
      expect(props).toContain('bounces={false}');
      expect(props).toContain('overScrollMode="never"');
    }
  });

  it('pays in the app with one PaymentIntent, and keeps the hosted flow as the fallback', () => {
    for (const call of [
      'api.buyer.checkout.paymentIntent.create(buildCreatePaymentIntentBody(',
      'api.buyer.checkout.paymentIntent.quote(',
      'api.buyer.checkout.paymentIntent.get(',
      'api.buyer.checkout.paymentIntent.cancel(',
      'controller.confirmCard(',
      'controller.confirmSaved(',
      'choosePaymentPath(',
      // hosted fallback, unchanged
      'api.buyer.checkout.createSession(',
      'api.guest.checkout.createSession(',
      'WebBrowser.openBrowserAsync(result.url)',
      'api.buyer.checkout.verifySession(',
      'api.guest.checkout.verifySession(',
      'validateCart(',
      'removeCartItems(',
      'api.buyer.addresses.create(',
      "createCheckoutSession(cart, source === 'buynow')",
    ]) {
      expect(screen).toContain(call);
    }
    // Preview keeps its no-Stripe path.
    expect(screen).toContain('placePreviewOrder(');
  });

  it('routes Track order with the verified order id only', () => {
    const confirmation = read('components/checkout/OrderConfirmation.tsx');
    expect(confirmation).toContain("'/buyer-order-detail?id=' + encodeURIComponent(firstVerified.id)");
    expect(confirmation).toContain('disabled={!firstVerified?.id}');
  });
});

describe('order confirmation actions', () => {
  const confirmation = read('components/checkout/OrderConfirmation.tsx');
  const actions = confirmation.slice(confirmation.indexOf('export function OrderConfirmationActions'), confirmation.indexOf('const styles = StyleSheet.create'));

  it('pins ONE primary button (Track order, or Check order status while finalizing)', () => {
    expect(actions.match(/<Button\b/g)).toHaveLength(2); // the finalizing and the confirmed branch, one each
    expect(actions).toContain('label="Track order"');
    expect(actions).not.toContain('View receipt');
    expect(actions).not.toContain('Continue shopping');
    expect(actions).not.toContain('Create an account');
  });

  it('moves View receipt, Continue shopping and Create an account into the scroll content as text rows', () => {
    const content = confirmation.slice(0, confirmation.indexOf('export function OrderConfirmationActions'));
    expect(content).toContain('label="View receipt"');
    expect(content).toContain('label="Continue shopping"');
    expect(content).toMatch(/label="Create an account[^"]*"\s+onPress=\{[^}]+\}\s+subtle/);
    expect(content).not.toMatch(/<Button[^>]*View receipt/);
  });
});

describe('cart matches the flat checkout', () => {
  const cart = read('app/(buyer)/cart.tsx');

  it('has no card containers, only checkout sections and hairlines', () => {
    expect(cart).not.toMatch(/<Card\b/);
    expect(cart).toContain("import { CheckoutSection } from '@/components/checkout/CheckoutPrimitives'");
    expect(cart).toContain('<CheckoutSection first={first}');
    expect(cart).toContain('<CheckoutSection title="Order summary"');
    expect(cart).not.toMatch(/cardGlass|cardElevatedGlass, borderBottomWidth/);
    expect(cart).toContain('backgroundColor: theme.background');
    expect(cart).not.toContain('opacity: 0.06');
  });
});
