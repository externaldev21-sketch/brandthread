import { test, expect } from '@playwright/test';

/**
 * Manual verification screenshots for item 132 (seller product list quick
 * price edit), matching Depop's "Set discount" sheet (mobbin.com/screens/
 * d7f04eb6-64b3-4407-8a85-95b65517b8a7): current price shown read-only above
 * a single editable price field, opened from the same "..." action sheet
 * Brandthread already uses for Edit / Duplicate / Archive / Delete.
 *
 * `services/productService.ts` is a local AsyncStorage-backed store, not a
 * network call, so there is nothing to mock with page.route() here — instead
 * this seeds the exact storage key the service reads
 * (`@brandthread/products:<userId>`) before navigation. AsyncStorage's web
 * shim is backed by localStorage, so an addInitScript write is visible to
 * the app on first load, the same way a real signed-in device's cached
 * catalog would be.
 *
 * The `?bt_preview=seller` dev bypass (see app/_layout.tsx's own comment on
 * it) renders straight past ClerkLoaded without waiting for clerk-js, so
 * `useAuth().userId` never resolves even with the clerkStub installed — a
 * pre-existing preview-tooling gap already documented in
 * seller-profile-actions.spec.ts for the same reason. initProductService()
 * therefore only ever sees `null` here and falls back to its 'anon' storage
 * scope, so the seed below is written under that key rather than the
 * clerkStub's user id. Confirmed by dumping localStorage after a bare
 * `?bt_preview=seller` load with no seed: only
 * `@brandthread/migration_*:anon` keys exist.
 */

const STORAGE_USER_ID = 'anon';

const SEED_PRODUCT = {
  id: 'p_quick_edit_seed',
  sellerId: STORAGE_USER_ID,
  name: 'Atelier Tee — Ivory',
  description: 'Boxy fit, heavyweight cotton.',
  category: 'T-shirt',
  tags: [],
  media: [],
  pricing: { priceCents: 4500, compareAtPriceCents: undefined, currency: 'USD' },
  options: [],
  variants: [],
  inventory: {
    productId: 'p_quick_edit_seed', trackQuantity: true, allowOverselling: false, policy: 'deny',
    lowStockThreshold: 5, totalStock: 20, availableStock: 20, reservedStock: 0, incomingStock: 0,
    locationStock: [], variantStock: [],
  },
  salesModel: 'pre-made',
  fulfillment: { type: 'ship' },
  manufacturing: { stage: 'none' },
  storeSettings: {
    status: 'active', collectionIds: [], featuredOnHomepage: false, relatedProductIds: [],
    seo: { searchVisible: true },
  },
  totalSales: 0,
  totalRevenueCents: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function seedProducts(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ key, product }) => {
      window.localStorage.setItem(key, JSON.stringify([product]));
    },
    { key: `@brandthread/products:${STORAGE_USER_ID}`, product: SEED_PRODUCT },
  );
}

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
}

test('seller product list — quick edit price @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await seedProducts(page);

  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/(tabs)/products?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByText('Atelier Tee — Ivory').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);
  await page.screenshot({ path: 'docs/polish/screenshots/product-quick-edit-price/before-390x844.png' });

  // Open the "..." action sheet from the product card, matching Depop's
  // bulk-actions sheet trigger (mobbin.com/screens/70f1931b-4449-4098-b910-5c575b7228c7).
  // ProductCard.tsx nests this button inside the card's own PressableScale
  // (pre-existing, out of scope for this PR). On web that means a pointer
  // click on the "more" button also grants the outer card's press
  // responder, firing both handlers at once and navigating to the product
  // instead of opening the sheet — confirmed by inspecting the real DOM
  // (a literal <button> inside a <button>) and by testing that a
  // stopPropagation() fix on the inner PressableScale's press event does
  // not stop it, since react-native-web's Pressability grants responders
  // from the original pointerdown hit-test, not from click bubbling. This
  // is exactly the class of bug the project's "no nested pressables" rule
  // exists to prevent — a real (if narrow) native/web behavior gap, not a
  // regression from this PR. Keyboard activation (focus + Enter) sidesteps
  // it because it fires a direct click on the focused node only, so that's
  // what this spec uses instead of a pointer click.
  const moreBtn = page.getByLabel('More actions for Atelier Tee — Ivory');
  await moreBtn.focus();
  await page.keyboard.press('Enter');
  await page.getByText('Quick edit price').waitFor({ timeout: 5_000 });
  await page.screenshot({ path: 'docs/polish/screenshots/product-quick-edit-price/action-sheet-390x844.png' });

  await page.getByText('Quick edit price').click();
  await page.getByText('Current price: $45.00').waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400); // let the action sheet's fade-out finish before capturing
  await page.screenshot({ path: 'docs/polish/screenshots/product-quick-edit-price/quick-edit-sheet-390x844.png' });

  const input = page.getByLabel('New price');
  await input.fill('');
  await input.fill('52.00');
  await page.getByText('Save price').click();

  // Sheet closes and the card + undo toast both reflect the new price.
  await page.getByText('$52.00').first().waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400); // let the quick-edit sheet's fade-out finish before capturing
  await page.screenshot({ path: 'docs/polish/screenshots/product-quick-edit-price/after-390x844.png' });

  await context.close();
});
