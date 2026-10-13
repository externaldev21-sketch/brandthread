#!/usr/bin/env node
/**
 * F7 plan-limits (items 117, 118) screenshots at 393x852 @2x on the web preview.
 *
 *   node scripts/f7-plan-limits-screenshots.mjs [--skip-build] [--phase after|before] [--build-dir DIR]
 *
 * --phase before runs against a build of origin/dev (pass its --build-dir) with
 * the server's old $5.99 entry pack; --phase after runs against this branch.
 *
 * - <phase>-add-product-limit.png: /add-product with a saved draft; Save hits a
 *   fake POST /api/products that answers 403 PLAN_LIMIT_REACHED (Starter, 25).
 * - <phase>-ai-credits.png: /ai-credits, Growth, healthy balance (pack prices).
 * - <phase>-ai-credits-empty.png: /ai-credits at 0 credits.
 * - after-ai-credits-insufficient.png: /ai-credits?reason=insufficient (the
 *   402 route) with 3 credits left.
 *
 * Fake API only; nothing reaches a real server.
 * Output: docs/pr-assets/f7/plan-limits/
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForQuietNetwork,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { IMAGE_HOST, SELLER_USER } from './store-screenshots/demo-data.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const PHASE = arg('--phase') ?? 'after';
const BUILD_DIR = arg('--build-dir') ?? DEFAULT_BUILD_DIR;
const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'f7', 'plan-limits');
const DEMO_API = 'https://api.brandthread.test';
const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};
const corsFor = (origin) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'authorization,content-type,x-store-context',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
});
const IMAGES = { 'leather-ankle-boots': path.join(MOBILE_ROOT, 'assets/images/products/leather-ankle-boots.jpg') };

const LIMIT_BODY = {
  error: 'Plan limit reached', code: 'PLAN_LIMIT_REACHED', resource: 'products',
  currentPlan: 'starter', requiredPlan: 'growth', limit: 25,
  message: 'Your Starter plan includes 25 products. Upgrade to add more.',
};

const entryPrice = PHASE === 'before' ? 599 : 499;
const PACKS = [
  { id: 'credits_500', credits: 500, amountCents: entryPrice, label: '500 credits' },
  { id: 'credits_1500', credits: 1500, amountCents: 1499, label: '1,500 credits' },
  { id: 'credits_5000', credits: 5000, amountCents: 4499, label: '5,000 credits' },
];
const TOOLS = [{ tool: 'logo', label: 'Logo', cost: 5 }, { tool: 'photoshoot', label: 'AI photoshoot', cost: 8 }];
function overview(balance) {
  return {
    plan: 'growth', unlimited: false, balance, monthlyBalance: Math.min(balance, 4000), rolloverBalance: 0, purchasedBalance: 0,
    monthlyAllowance: 4000, resetsAt: '2026-11-01T00:00:00.000Z', lowCreditsThreshold: 800, isLow: balance <= 800,
    packs: PACKS, tools: TOOLS, purchase: { stripe: true },
  };
}
const HISTORY = {
  entries: [
    { id: 'h1', kind: 'debit', delta: -8, toolKey: 'photoshoot', balanceAfter: 0, createdAt: '2026-10-12T15:10:00.000Z' },
    { id: 'h2', kind: 'debit', delta: -5, toolKey: 'logo', balanceAfter: 8, createdAt: '2026-10-12T11:42:00.000Z' },
    { id: 'h3', kind: 'monthly_grant', delta: 4000, toolKey: null, balanceAfter: 4000, createdAt: '2026-10-01T00:00:00.000Z' },
  ],
  nextCursor: null,
};

/** Routes registered after openContext's catch-all are tried first by Playwright. */
async function fakeApi(context, origin, { balance }) {
  const CORS = corsFor(origin);
  const json = (route, body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  const pre = (route) => route.request().method() === 'OPTIONS' && route.fulfill({ status: 204, headers: CORS });
  await context.route(/\/api(\/v1)?\/products$/, (route) => pre(route) || (route.request().method() === 'POST' ? json(route, LIMIT_BODY, 403) : route.fallback()));
  await context.route(/\/api(\/v1)?\/ai\/credits$/, (route) => pre(route) || json(route, overview(balance)));
  await context.route(/\/api(\/v1)?\/ai\/credits\/history/, (route) => pre(route) || json(route, HISTORY));
}

async function settle(page, activity) {
  await waitForQuietNetwork(activity, 800, 12_000);
  await page.waitForTimeout(900);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${PHASE}-${name}`) });
  console.log('wrote', `${PHASE}-${name}`);
}

async function session(browser, origin, target, opts = {}) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: IMAGES });
  await fakeApi(context, origin, { balance: opts.balance ?? 2964 });
  if (opts.draft) {
    // The screen can mount before the signed-in user scopes product storage, so seed both scopes.
    await context.addInitScript(({ keys, value }) => { for (const k of keys) localStorage.setItem(k, value); }, {
      keys: [SELLER_USER.id, 'anon'].map((uid) => `@brandthread/draft_${uid}_${opts.draft.id}`), value: JSON.stringify(opts.draft),
    });
  }
  if (process.env.F7_DEBUG) page.on('response', (r) => { if (/credits|\/products/.test(r.url())) console.log('  ', r.request().method(), r.url(), r.status()); });
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 200)));
  // A full load of the target (a client-side push from "/" doesn't always land).
  // The seller web preview refuses every write before it leaves the browser
  // (lib/api.ts rejectSellerPreviewApiRequest), so a save needs it off to reach the fake 403.
  await page.goto(`${origin}${target}${opts.writes ? `${target.includes('?') ? '&' : '?'}bt_preview=buyer` : ''}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  const at = await page.evaluate(() => window.location.pathname);
  if (!target.startsWith(at)) console.log('  landed on', at, 'for', target);
  await settle(page, activity);
  return { context, page, activity };
}

const DRAFT = {
  id: 'f7limit', name: 'Heavyweight hoodie', description: 'Garment-dyed 450gsm fleece.',
  category: 'Hoodies', tags: [], styleTags: [],
  pricing: { priceCents: 6800, currency: 'USD', estimatedShippingCostCents: 0, estimatedFeesCents: 0 },
  media: [{ id: 'm1', type: 'image', uri: `${IMAGE_HOST}/leather-ankle-boots.jpg`, isCover: true, sortOrder: 0, createdAt: '2026-10-12T10:00:00.000Z' }],
  storeSettings: { status: 'active' },
  options: [], variants: [],
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  try {
    {
      const { context, page, activity } = await session(browser, origin, `/add-product?editId=${DRAFT.id}`, { draft: DRAFT, writes: true });
          await page.getByTestId('add-product-save').first().click({ timeout: 8000 });
      await settle(page, activity);
      await page.waitForTimeout(600);
      await shot(page, 'add-product-limit.png');
      await context.close();
    }
    for (const [name, balance, query] of [['ai-credits.png', 2964, ''], ['ai-credits-empty.png', 0, ''], ['ai-credits-insufficient.png', 3, '?reason=insufficient']]) {
      if (PHASE === 'before' && query) continue;
      const { context, page } = await session(browser, origin, `/ai-credits${query}`, { balance });
      await shot(page, name);
      await context.close();
    }
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
