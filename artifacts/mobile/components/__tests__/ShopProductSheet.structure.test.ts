import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sheetSource = readFileSync(
  resolve(process.cwd(), 'components/ShopProductSheet.tsx'),
  'utf8',
);
const cartSource = readFileSync(
  resolve(process.cwd(), 'services/cartService.ts'),
  'utf8',
);

describe('Thread shop drawer purchase actions', () => {
  it('labels cart and direct checkout as distinct actions with distinct icons', () => {
    expect(sheetSource).toContain("phase === 'added' ? 'View cart' : 'Add to cart'");
    expect(sheetSource).toContain('<Feather name="shopping-cart"');
    expect(sheetSource).toContain('<Text style={[ss.buyBtnText, { color: theme.onAccent }]}>Buy now</Text>');
    expect(sheetSource).toContain('<Feather name="arrow-right-circle"');
  });

  it('shows the full description before variant and quantity controls', () => {
    const descriptionIndex = sheetSource.indexOf("product.description.trim() || 'Product details are not available.'");
    const optionsIndex = sheetSource.indexOf('{product.options.map');
    const quantityIndex = sheetSource.indexOf('<QtyControl');

    expect(descriptionIndex).toBeGreaterThan(0);
    expect(descriptionIndex).toBeLessThan(optionsIndex);
    expect(optionsIndex).toBeLessThan(quantityIndex);
  });

  it('routes Buy now through a direct checkout session without updating the cart badge', () => {
    const buyNowHandler = sheetSource.slice(
      sheetSource.indexOf('async function handleBuyNow()'),
      sheetSource.indexOf('// View full detail'),
    );

    expect(buyNowHandler).toContain('createBuyNowSession(product, variant, qty, cart)');
    // Uses the thread-pull `push` (not plain router.push) so the checkout
    // push follows the same motion contract as the sheet's other thread-pull
    // navigations, and fires immediately (navigateAndDismiss) instead of
    // waiting for the sheet's own dismiss animation to finish — see
    // navigateAndDismiss's doc comment for why the old sequential
    // dismiss-then-push left the sheet's Modal/backdrop stuck on top of
    // Checkout.
    expect(buyNowHandler).toContain("navigateAndDismiss(() => push('/thread-checkout'");
    expect(buyNowHandler).not.toContain('addToCart(');
    expect(buyNowHandler).not.toContain('onCartUpdated');
    expect(cartSource).toContain('return createCheckoutSession(currentCart, true, [buyNowItem])');
  });

  it('keeps the product visible after adding and offers a direct View cart action', () => {
    expect(sheetSource).toContain("setShowAddedConfirmation(true)");
    expect(sheetSource).toContain('<Text style={ss.addedConfirmationText}>Added to cart</Text>');
    expect(sheetSource).toContain("phase === 'added' ? 'View cart' : 'Add to cart'");
    expect(sheetSource).toContain("router.push('/(buyer)/cart'");
    expect(sheetSource).not.toContain('setFlyingToCart(false);\\n      dismissSheet(onClose)');
  });
});