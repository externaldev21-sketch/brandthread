/**
 * Reviews (photos, verified badge, seller reply, helpful) + product Q&A,
 * captured at 393x852 from the real web build.
 *
 * Uses the store-screenshot harness (signed-in demo buyer, fake API). The
 * review and Q&A responses below are fixtures served by this script only; they
 * are NOT the &demo=1 preview seed.
 *
 *   node scripts/store-screenshots/reviews-qa-screenshots.mjs [--skip-build]
 *
 * Output: <repo>/docs/pr-assets/reviews-qa/*.png
 */
import path from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { checkTextFit } from '../textFitCheck.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { CATALOGUE, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/reviews-qa');
mkdirSync(OUT, { recursive: true });
const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const DEMO_API = 'https://api.brandthread.test';
const PRODUCT = CATALOGUE[0];
const ago = (d) => new Date(Date.parse('2026-09-18T23:30:00Z') - d * 86400e3).toISOString();
const photo = (n) => `${IMAGE_HOST}/demo/${n}.jpg`;
const FAKE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLFRgTEQ4dHR8bGBQVFR4pIRwjKykpJi01Pi01LVBLTU9WV1lZWVlZWVn/2wBDAQkJCQwLDBYPDxYaFRUVGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhr/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AKAP/9k=',
  'base64',
);

const REVIEWS = {
  avgRating: 4.7, totalCount: 3,
  reviews: [
    {
      id: 'r1', rating: 5, body: 'Heaviest hoodie I own and it still drapes. Sized true and the ember colour is even better in person.',
      buyerName: 'Jordan R.', createdAt: ago(3), verifiedPurchase: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0,
      photos: [photo('hoodie-ember'), photo('look-mono')], helpfulCount: 12, viewerHelpful: false,
      sellerReply: 'Thank you Jordan. Glad the colour landed, it was dyed in small batches.', sellerRepliedAt: ago(2),
    },
    {
      id: 'r2', rating: 4, body: 'Great fit, sleeves run slightly long.',
      buyerName: 'Priya K.', createdAt: ago(9), verifiedPurchase: true, sizeBought: 'S', fitNote: 'Runs large', fitScale: 1,
      photos: [], helpfulCount: 4, viewerHelpful: true,
    },
    { id: 'r3', rating: 5, body: 'Fast shipping and exactly like the video.', buyerName: 'Sam T.', createdAt: ago(20), verifiedPurchase: true, photos: [], helpfulCount: 0, viewerHelpful: false },
  ],
};

let questions = [
  { id: 'q1', productId: PRODUCT.id, body: 'Is the hoodie pre-shrunk? I am between a M and an L.', askerName: 'Alex T.', createdAt: ago(4), mine: false,
    answer: { id: 'a1', body: 'Yes, it is garment washed and pre-shrunk. Most people stay true to size.', createdAt: ago(3) } },
  { id: 'q2', productId: PRODUCT.id, body: 'Does this restock in black?', askerName: 'Morgan L.', createdAt: ago(1), mine: false, answer: null },
];

const json = (route, origin, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
  headers: {
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context,idempotency-key',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  },
});

function installFixtures(context, origin) {
  context.route(/api\.brandthread\.test\/api(\/v1)?\/(reviews|product-qa|buyer\/orders\/)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api(\/v1)?/, '');
    if (req.method() === 'OPTIONS') return json(route, origin, {}, 204);
    if (p.startsWith('/reviews/product/')) return json(route, origin, REVIEWS);
    if (p === '/reviews/photos') return json(route, origin, { objectPath: '/objects/reviews/user_jordan/fixture' }, 201);
    if (p === '/reviews' && req.method() === 'POST') return json(route, origin, { id: 'new' }, 201);
    if (p.startsWith('/product-qa/product/') && req.method() === 'GET') return json(route, origin, { questions, totalCount: questions.length });
    if (p.startsWith('/product-qa/product/') && req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}').body;
      const q = { id: `q${questions.length + 1}`, productId: PRODUCT.id, body, askerName: 'Jordan R.', createdAt: ago(0), mine: true, answer: null };
      questions = [q, ...questions];
      return json(route, origin, q, 201);
    }
    if (p === '/product-qa/seller') {
      return json(route, origin, {
        unansweredCount: 1,
        questions: [
          { id: 'q2', productId: PRODUCT.id, productName: PRODUCT.name, body: 'Does this restock in black?', askerName: 'Morgan L.', createdAt: ago(1), answer: null },
          { id: 'q1', productId: PRODUCT.id, productName: PRODUCT.name, body: questions[0].body, askerName: 'Alex T.', createdAt: ago(4), answer: questions[0].answer },
        ],
      });
    }
    if (/^\/buyer\/orders\/[^/]+$/.test(p)) {
      // Delivered order with a real-looking UUID so the review CTA shows.
      return json(route, origin, {
        id: '5b0a1c52-7f3e-4c9e-9a51-0b1d7a3f9c11', orderNumber: 'BT-10482', ownerId: 'user_northline', sellerDisplayName: 'Northline Studio',
        status: 'delivered', paidAt: ago(8), createdAt: ago(9), subtotalCents: PRODUCT.priceCents, shippingCents: 0, totalCents: PRODUCT.priceCents,
        items: [{ productId: PRODUCT.id, productName: PRODUCT.name, variantLabel: 'M', quantity: 1, priceCents: PRODUCT.priceCents, imageUri: photo(PRODUCT.image) }],
        shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
      });
    }
    return route.fallback();
  });
}

const ISSUES = [];
async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  ok', name);
  ISSUES.push(...(await checkTextFit(page, name)));
}

async function zoom(page, name, clip) {
  await page.screenshot({ path: path.join(OUT, `zoom-${name}.png`), clip });
  console.log('  ok zoom', name);
}

async function need(page, locator, name) {
  try { await locator.first().waitFor({ timeout: 20000 }); } catch (e) {
    await page.screenshot({ path: path.join(WORK_DIR, `fail-${name}.png`) });
    console.log('  FAILED waiting for', name, 'url', page.url());
    throw e;
  }
}

async function open(browser, images, origin, role, target) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role, origin, images });
  installFixtures(context, origin);
  page.on('pageerror', (e) => console.log('  PAGEERROR', String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  CONSOLE', m.text().slice(0, 200)); });
  // The app remounts once after sign-in; retry if that lands us on "/".
  for (let attempt = 0; attempt < 4; attempt++) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname === target.split('?')[0]) break;
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  return { context, page };
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const pq = `productId=${encodeURIComponent(PRODUCT.id)}&productName=${encodeURIComponent(PRODUCT.name)}`;
  try {
    let s;
    if (!process.env.ONLY) {
    s = await open(browser, images, server.origin, 'buyer', `/product-reviews?${pq}`);
    await need(s.page, s.page.getByText('Jordan R.'), 'reviews');
    await waitForImages(s.page);
    await shot(s.page, '01-review-card-photos-verified-seller-reply');
    await s.context.close();

    s = await open(browser, images, server.origin, 'buyer', `/buyer-product-detail?productId=${encodeURIComponent(PRODUCT.id)}`);
    await need(s.page, s.page.getByText('Ask a question'), 'pdp');
    await s.page.getByText('Ask a question').first().scrollIntoViewIfNeeded();
    await waitForImages(s.page);
    await shot(s.page, '02-product-detail-reviews-then-questions');
    await s.context.close();

    s = await open(browser, images, server.origin, 'buyer', '/buyer-order-detail?id=5b0a1c52-7f3e-4c9e-9a51-0b1d7a3f9c11');
    await need(s.page, s.page.getByLabel('Leave a review'), 'order');
    await s.page.getByLabel('Leave a review').first().click();
    await s.page.getByLabel('Runs small').click();
    await shot(s.page, '03-review-sheet-fit-and-add-photos');
    for (let i = 0; i < 2; i++) {
      const chooser = s.page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
      await s.page.getByLabel('Add photos').click();
      const fc = await chooser;
      if (fc) await fc.setFiles({ name: `p${i}.jpg`, mimeType: 'image/jpeg', buffer: readFileSync(images[i === 0 ? 'hoodie-ember' : 'look-mono']) });
      await s.page.waitForTimeout(400);
    }
    await shot(s.page, '04-review-sheet-with-photos');
    await zoom(s.page, '04-review-sheet-fit-photos-buttons', { x: 0, y: 620, width: 393, height: 232 });
    await s.context.close();

    }
    s = await open(browser, images, server.origin, 'buyer', `/product-questions?${pq}`);
    console.log('  url after open', s.page.url());
    await s.page.waitForTimeout(3000);
    console.log('  url after wait', s.page.url());
    await need(s.page, s.page.getByText('Waiting for the seller to answer'), 'qa');
    await shot(s.page, '05-questions-screen');
    await s.page.getByLabel('Ask a question').first().click();
    await s.page.getByLabel('Your question').fill('Does the ember colour fade after washing?');
    await shot(s.page, '06-questions-ask-composer');
    await zoom(s.page, '06-composer-buttons', { x: 0, y: 190, width: 393, height: 190 });
    await s.page.getByLabel('Post question').click();
    await s.page.getByText('Question posted').first().waitFor({ timeout: 10000 });
    await shot(s.page, '07-questions-posted');
    await s.context.close();

    s = await open(browser, images, server.origin, 'seller', '/seller-questions');
    await need(s.page, s.page.getByLabel('Answer this question'), 'seller');
    await s.page.getByLabel('Answer this question').first().click();
    await s.page.getByLabel('Your answer').fill('We are restocking in black next month.');
    await shot(s.page, '08-seller-answer-inbox');
    await zoom(s.page, '08-seller-answer-card', { x: 0, y: 110, width: 393, height: 420 });
    await s.context.close();
    console.log(`TEXT-FIT TOTAL ISSUES: ${ISSUES.length}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
