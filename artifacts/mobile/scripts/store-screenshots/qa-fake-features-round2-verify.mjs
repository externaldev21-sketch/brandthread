/**
 * QA "fake features" round 2 verification, 390x844:
 *   1. Seller dashboard "Suggestions" card renders GET /api/ai/suggestions
 *      (and is absent, with no request, when Dashboard suggestions is off).
 *   2. "Preview as buyer" on a DRAFT product: the owner gets the product
 *      (server flags previewOnly) with a Preview marker and no purchase.
 *   3. /cart for a seller opens the real cart, not "Not found" (QA-0527).
 *   4. Signed-out seller preview: Add product → Save → Products tab lists
 *      the saved product; its "Preview as buyer" opens the local product.
 *
 * Run:  node scripts/store-screenshots/qa-fake-features-round2-verify.mjs [--skip-build] [--only=a,b]
 */
import path from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { clerkStubScript } from './clerk-stub.mjs';
import { DEMO_NOW, DEMO_TIME_ZONE, IMAGE_HOST, SELLER_PRODUCTS, SELLER_USER, localStorageSeed, respond } from './demo-data.mjs';
import { MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, serveBuild } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const BUILD_DIR = path.join(WORK_DIR, 'qa-fake-features-2-build');
const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/qa-fake-features');
mkdirSync(OUT, { recursive: true });

const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2 };
const DEMO_API = 'https://api.brandthread.test';
let IMAGES = {};

const failures = [];
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
}

const AI_ON = { enabled: true, suggestionsEnabled: true, sessionMemoryEnabled: true, brandMemoryEnabled: true };

async function openPage(browser, origin, { signedIn = true, seed: seedOver = {}, overrides = () => undefined, calls = [] } = {}) {
  const context = await browser.newContext({
    viewport: DEVICE.viewport, deviceScaleFactor: DEVICE.scale, isMobile: true, hasTouch: true,
    locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce',
  });
  await context.clock.install({ time: DEMO_NOW });
  if (signedIn) await context.addInitScript(clerkStubScript(SELLER_USER));
  const base = localStorageSeed('seller');
  // Signed in: the seller's product store under their own account key.
  const seed = signedIn
    ? { ...base, [`@brandthread/products:${SELLER_USER.id}`]: base['@brandthread/products'], [`@brandthread/migration_v2_scoped:${SELLER_USER.id}`]: '1' }
    : { 'bt:cookie-consent': base['bt:cookie-consent'] };
  Object.assign(seed, seedOver);
  await context.addInitScript((s) => {
    if (sessionStorage.getItem('bt:seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    sessionStorage.setItem('bt:seeded', '1');
  }, seed);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === IMAGE_HOST) {
      const name = url.pathname.split('/').pop().replace(/\.jpg$/, '');
      const file = IMAGES[name];
      return file ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(file) }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.origin !== DEMO_API) return route.abort();
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = url.pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
    let body = null;
    try { body = request.postDataJSON(); } catch {}
    calls.push({ method: request.method(), path: p, body, auth: !!request.headers().authorization });
    const custom = overrides({ method: request.method(), path: p, query: url.searchParams, body });
    if (custom) {
      return route.fulfill({ status: custom.status ?? 200, headers: cors, contentType: 'application/json', body: JSON.stringify(custom.body ?? {}) });
    }
    if (!signedIn) return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
    const fallback = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'seller', options: {} });
    if (fallback === undefined) {
      return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fallback) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  globalThis.__lastPage = page;
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  return { context, page };
}

// What GET /api/ai/suggestions computes for this seller's demo data
// (artifacts/api-server/src/routes/ai.ts): the out-of-stock cargo pant, the
// low-stock Bone hoodie, and the paid orders awaiting fulfilment.
const SUGGESTIONS = [
  {
    id: 'sug_ship_unfulfilled', title: '3 orders awaiting fulfilment',
    reason: '3 paid orders are awaiting fulfilment. The oldest has been waiting 30 hours.',
    expectedImpact: 'Fulfilling today protects your seller rating and customer satisfaction',
    actionLabel: 'View orders', actionRoute: '/(tabs)/orders', category: 'orders', priority: 'urgent',
  },
  {
    id: 'sug_stock_NL-RUST-M', title: 'Utility Cargo Pant — Rust (M) is out of stock',
    reason: 'This variant has 0 units left. Buyers who visit the product page will see it as sold out.',
    expectedImpact: 'Prevents ongoing missed revenue from visitors',
    actionLabel: 'View inventory', actionRoute: '/inventory', category: 'inventory', priority: 'urgent',
  },
  {
    id: 'sug_stock_NL-BONE-L', title: 'Low stock: Heavyweight Hoodie — Bone (L)',
    reason: 'Only 2 units remaining (threshold: 5). At current velocity, stock may deplete within days.',
    expectedImpact: 'Reordering now prevents ~4 lost sales',
    actionLabel: 'View inventory', actionRoute: '/inventory', category: 'inventory', priority: 'high',
  },
];

async function scrollTo(page, testId) {
  const el = page.getByTestId(testId).first();
  await el.waitFor({ timeout: 30_000 });
  await el.evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(600);
  return el;
}

async function dashboard(browser, origin) {
  // On: the card shows the server's suggestions.
  {
    const calls = [];
    const overrides = ({ path: p }) => {
      if (p === '/ai/settings') return { body: { settings: AI_ON, updatedAt: new Date(DEMO_NOW).toISOString() } };
      if (p === '/ai/suggestions') return { body: { suggestions: SUGGESTIONS } };
      return undefined;
    };
    const { context, page } = await openPage(browser, origin, { overrides, calls });
    await page.goto(`${origin}/?bt_preview=seller`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    if (process.env.DEBUG_CALLS) console.log(calls.map((c) => `${c.method} ${c.path}`).join('\n'));
    await scrollTo(page, 'seller-dashboard-ai-suggestions');
    check(calls.some((c) => c.method === 'GET' && c.path === '/ai/suggestions' && c.auth), 'AI suggestions: dashboard calls GET /api/ai/suggestions with the account token');
    for (const s of SUGGESTIONS) check(await page.getByText(s.title).count() > 0, `AI suggestions: shows "${s.title}"`);
    await page.evaluate(() => window.scrollBy(0, -90));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'dashboard-ai-suggestions.png') });

    await page.getByTestId('seller-dashboard-ai-suggestion-sug_stock_NL-BONE-L').click();
    await page.waitForURL(/\/inventory/, { timeout: 15_000 }).catch(() => {});
    check(/\/inventory/.test(page.url()), 'AI suggestions: tapping a suggestion opens its screen (/inventory)');
    await page.goBack();
    await scrollTo(page, 'seller-dashboard-ai-suggestions');
    await page.getByTestId('seller-dashboard-ai-suggestion-ask-sug_ship_unfulfilled').click();
    await page.waitForURL(/\/ai-brain/, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const composer = await page.locator('textarea, input[type="text"]').evaluateAll((els) => els.map((e) => e.value).join(' | '));
    check(/\/ai-brain/.test(page.url()) && composer.includes('3 orders awaiting fulfilment'), 'AI suggestions: "Ask AI" opens AI Brain with the suggestion as the prompt');
    await page.screenshot({ path: path.join(OUT, 'dashboard-ai-suggestions-ask-ai.png') });
    await context.close();
  }
  // Off: no card and no request.
  {
    const calls = [];
    const off = { ...AI_ON, suggestionsEnabled: false };
    const overrides = ({ path: p }) => {
      if (p === '/ai/settings') return { body: { settings: off, updatedAt: new Date(DEMO_NOW).toISOString() } };
      if (p === '/ai/suggestions') return { body: { suggestions: SUGGESTIONS } };
      return undefined;
    };
    const { context, page } = await openPage(browser, origin, { overrides, calls, seed: { 'bt:ai:settings:v1': JSON.stringify(off) } });
    await page.goto(`${origin}/?bt_preview=seller`, { waitUntil: 'load' });
    await page.getByTestId('seller-dashboard-hero-value').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    check(await page.getByTestId('seller-dashboard-ai-suggestions').count() === 0, 'AI suggestions off: no Suggestions card');
    check(!calls.some((c) => c.path === '/ai/suggestions'), 'AI suggestions off: GET /api/ai/suggestions is never called');
    await context.close();
  }
}

async function previewDraft(browser, origin) {
  const draft = SELLER_PRODUCTS.find((p) => p.status === 'draft');
  const calls = [];
  const row = {
    id: draft.id, ownerId: SELLER_USER.id, name: draft.name, description: draft.description,
    category: 'apparel', status: 'draft', images: draft.media.map((m) => m.uri), tags: draft.tags,
    variants: draft.variants.map((v, i) => ({ id: v.id, productId: draft.id, sku: v.sku, size: v.title, color: null, priceCents: draft.pricing.priceCents, stock: v.inventoryQuantity + (i === 0 ? 0 : 0) })),
    sellerDisplayName: 'Northline Studio', sellerVerified: true, sellerVacationMode: false, claimedUnits: 0, previewOnly: true,
  };
  const overrides = ({ path: p }) => (p === `/public/products/${draft.id}` ? { body: row } : undefined);
  const { context, page } = await openPage(browser, origin, { overrides, calls });
  // The harness's way in (openScreen): boot signed in, then navigate in-app.
  await page.goto(`${origin}/?bt_preview=seller`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.evaluate((url) => {
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, `/product-detail?id=${draft.id}&bt_preview=seller`);
  await page.waitForTimeout(1500);
  await page.getByText('Store page', { exact: true }).first().click();
  await page.waitForTimeout(800);
  const btn = page.getByText('Preview as buyer', { exact: true }).first();
  check(await btn.count() > 0, 'Preview as buyer: shown for a draft product');
  await btn.click();
  await page.getByTestId('product-seller-preview-marker').waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check(calls.some((c) => c.path === `/public/products/${draft.id}` && c.auth), 'Preview as buyer: draft is fetched from GET /api/public/products/:id as the owner');
  check(await page.getByTestId('product-seller-preview-marker').count() > 0, 'Preview as buyer: "Preview" marker on the buyer page');
  check(await page.getByText(draft.name).count() > 0, 'Preview as buyer: the draft product renders');
  const buy = page.getByTestId('product-seller-preview-buy');
  check(await buy.count() > 0 && (await buy.getAttribute('aria-disabled')) === 'true', 'Preview as buyer: purchase is disabled ("Not for sale yet")');
  check(!calls.some((c) => c.path.startsWith('/public/sellers/') && c.path.includes('visit')), 'Preview as buyer: the owner\'s preview is not recorded as a store visit');
  await page.screenshot({ path: path.join(OUT, 'preview-as-buyer-draft.png') });
  await context.close();
}

async function sellerCart(browser, origin) {
  // Signed-out design preview, the reported route.
  {
    const { context, page } = await openPage(browser, origin, { signedIn: false });
    await page.goto(`${origin}/cart?bt_preview=seller`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    check(await page.getByText(/not found/i).count() === 0, 'QA-0527: /cart?bt_preview=seller is not "Not found"');
    check(await page.getByText('Your cart is empty').count() > 0 || await page.getByText(/^Cart/).count() > 0, 'QA-0527: seller sees the real cart');
    check(new URL(page.url()).pathname === '/cart', 'QA-0527: stays on /cart');
    await page.screenshot({ path: path.join(OUT, 'seller-cart.png') });
    await context.close();
  }
  // A signed-in seller account (role correction for real accounts).
  {
    const { context, page } = await openPage(browser, origin);
    await page.goto(`${origin}/cart?bt_preview=seller`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    check(await page.getByText(/not found/i).count() === 0 && new URL(page.url()).pathname === '/cart', 'QA-0527: signed-in seller /cart opens the cart');
    await page.screenshot({ path: path.join(OUT, 'seller-cart-signed-in.png') });
    await context.close();
  }
}

async function productsAfterSave(browser, origin) {
  const { context, page } = await openPage(browser, origin, { signedIn: false });
  await page.goto(`${origin}/products?bt_preview=seller`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  check(await page.getByText('Washed Box Tee').count() === 0, 'Products tab (signed-out preview) starts without the product');
  await page.goto(`${origin}/add-product?bt_preview=seller`, { waitUntil: 'load' });
  await page.getByPlaceholder('e.g. Vintage Washed Tee').waitFor({ timeout: 30_000 });
  await page.getByPlaceholder('e.g. Vintage Washed Tee').fill('Washed Box Tee');
  await page.getByPlaceholder('0.00').first().fill('48');
  // A real photo through the web file picker, then the 3:4 crop step.
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-product-add-photos').first().click();
  await (await chooser).setFiles(IMAGES['hoodie-ember'] ?? Object.values(IMAGES)[0]);
  await page.getByTestId('media-cropper-save').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.getByTestId('media-cropper-save').click();
  await page.waitForTimeout(1500);
  await page.waitForTimeout(400);
  await page.getByTestId('add-product-save').click();
  await page.getByTestId('add-product-success-sheet').waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(800);
  check(await page.getByTestId('add-product-success-sheet').count() > 0, 'Add product (signed-out preview): Save succeeds');
  await page.goto(`${origin}/products?bt_preview=seller`, { waitUntil: 'load' });
  await page.getByText('Washed Box Tee').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  check(await page.getByText('Washed Box Tee').count() > 0, 'Products tab (signed-out preview) lists the saved product');
  check(await page.getByText('Heavyweight Hoodie').count() === 0, 'Products tab (signed-out preview) shows no seeded/demo products');
  await page.screenshot({ path: path.join(OUT, 'products-tab-after-save.png') });

  // Open it, then Preview as buyer → the locally stored product.
  await page.getByText('Washed Box Tee').first().click();
  await page.waitForURL(/product-detail/, { timeout: 15_000 }).catch(() => {});
  await page.getByText('Store page', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByText('Preview as buyer', { exact: true }).first().click();
  await page.getByTestId('product-seller-preview-marker').waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  check(/localPreview=1/.test(page.url()) && await page.getByText('Washed Box Tee').count() > 0, 'Preview as buyer (signed-out preview): opens the locally saved product');
  check(await page.getByTestId('product-seller-preview-marker').count() > 0, 'Preview as buyer (signed-out preview): Preview marker shown');
  check(await page.getByText('Saved on this device only. Buyers can’t see or buy it.').count() > 0, 'Preview as buyer (signed-out preview): says it is local and not for sale');
  await page.screenshot({ path: path.join(OUT, 'preview-as-buyer-local.png') });
  await context.close();
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  IMAGES = await ensureDemoImages(browser, path.join(WORK_DIR, 'images'));
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const runs = { dashboard, previewDraft, sellerCart, productsAfterSave };
  try {
    for (const [name, fn] of Object.entries(runs)) {
      if (only && !only.split(',').includes(name)) continue;
      console.log(`\n── ${name}`);
      try { await fn(browser, origin); } catch (e) { await globalThis.__lastPage?.screenshot({ path: path.join(OUT, `debug-${name}.png`) }).catch(() => {}); check(false, `${name} crashed: ${e.message.split('\n')[0]}`); }
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
