// Serves the REAL api-server responses captured by
// api-server/src/routes/__tests__/dashboard-crosscheck.integration.test.ts to the
// signed-in dashboard and compares what the screen renders with the API numbers.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { clerkStubScript } from './clerkStub.mts';
const [fixturePath, OUT] = process.argv.slice(2);
const api = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const extra = {
  '/api/auth/me': { id: 'user_preview_verify', clerkId: 'user_preview_verify', accountType: 'seller', onboardingComplete: true, termsVersion: '2026-09-23', displayName: 'Northline Studio', brandName: 'Northline Studio', username: 'northline' },
  '/api/team/context': { role: 'owner' },
  '/api/team/my-memberships': { memberships: [] },
  // A launched store: every setup step done, checklist dismissed (keeps setup prompts off the cross-check).
  '/api/seller/launch-checklist': { steps: [{ id: 'first_product', done: true }, { id: 'publish', done: true }], doneCount: 2, total: 2, complete: true, handle: 'northline', dismissed: true },
  '/api/seller/launch-checklist/setup': { steps: [{ id: 'first_product', done: true }, { id: 'publish', done: true }], doneCount: 2, total: 2, complete: true, handle: 'northline', dismissed: true },
  '/api/seller/profile': { brandName: 'Northline Studio', displayName: 'Northline Studio', username: 'northline' },
  '/api/seller/connect/status': { connected: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, steps: [] },
  '/api/auth/sync': { id: 'user_preview_verify', clerkId: 'user_preview_verify', accountType: 'seller', onboardingComplete: true, displayName: 'Northline Studio', username: 'northline' },
  '/api/finance/balance': { available: { amount: 12345, currency: 'usd', formatted: '$123.45' }, pending: { amount: 0, currency: 'usd', formatted: '$0.00' }, connected: true, payoutsEnabled: true, bankConnected: true, processingCashout: null },
  '/api/display-preferences': {},
  '/api/auth/account-types': { accountTypes: {} },
  '/api/me/settings': {},
  '/api/access/status': {},
  '/api/app/config': {},
  '/api/first-run-tips/seen': { seenTipIds: [], skipAll: true },
  '/api/config/features': {},
  '/api/thread-cash': { balanceCents: 2500, cashableCents: 2500 },
};
const unknown = new Set();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'UTC' });
await ctx.addInitScript(clerkStubScript());
// Real signed-in mode: no dev preview role, so the dashboard uses the API source.
await ctx.addInitScript(() => { try { localStorage.setItem('bt:previewRole:explicit-v1', 'guest'); } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 400)); });
await page.route('**/api/**', (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname.replace(/^\/api\/v1\//, '/api/');
  const key = path + (url.searchParams.get('range') ? `?range=${url.searchParams.get('range')}` : '');
  let body = api[key] ?? extra[path];
  if (body === undefined) { unknown.add(`${route.request().method()} ${path}`); body = route.request().method() === 'GET' ? [] : {}; }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.goto('http://127.0.0.1:8081/', { waitUntil: 'networkidle', timeout: 240000 }).catch(() => {});
await page.getByTestId('seller-dashboard-hero-value').first().waitFor({ timeout: 60000 }).catch(async () => {
  await page.screenshot({ path: `${OUT}-stuck.png` });
  console.log('STUCK at', page.url(), errors.filter((e) => /boundary|TypeError|Error:/.test(e)).map((e) => e.slice(0, 700)));
  process.exit(2);
});
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(3000);
const text = async (id) => (await page.getByTestId(id).first().count()) ? (await page.getByTestId(id).first().innerText()).replace(/\s+/g, ' ').trim() : null;
const usd = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = api['/api/analytics/home?range=today'];
const pct = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
const rows = [];
const check = (what, apiValue, screen, ok) => rows.push({ what, api: String(apiValue), screen: screen ?? '(not rendered)', match: ok ?? (screen != null && screen.includes(String(apiValue))) });
const hero = await text('seller-dashboard-hero-value');
check('Total sales (Today)', usd(today.totalCents), hero, hero === usd(today.totalCents));
const delta = await text('seller-dashboard-hero-delta');
check('Sales change vs same hours yesterday', `${pct(today.totalCents, today.previous.totalCents)}%`, delta);
const tile = async (k) => text(`seller-dashboard-stat-tile-${k}`);
check('Orders tile', today.orderCount, await tile('orders'));
check('Visitors tile', today.visitorCount, await tile('visitors'));
check('Conversion tile', `${((today.orderCount / today.visitorCount) * 100).toFixed(1)}%`, await tile('conversion'));
check('AOV tile', usd(today.averageOrderCents), await tile('aov'));
const top = api['/api/analytics/products'].filter((p) => p.revenueCents > 0);
const topText = await text('seller-dashboard-top-products');
for (const p of top) check(`Top product ${p.name}`, `${p.name} ${p.unitsSold} ${p.unitsSold === 1 ? 'unit' : 'units'} sold ${usd(p.revenueCents)}`, topText);
const recentText = await text('seller-dashboard-recent-orders');
for (const o of api['/api/orders'].slice(0, 5)) check(`Recent order ${o.orderNumber}`, `${o.orderNumber} · ${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'}`, recentText);
const traffic = await text('seller-dashboard-traffic-sources');
for (const s of today.trafficSources.filter((x) => x.count > 0)) check(`Traffic ${s.source}`, s.count, traffic);
// The tile is the Orders tab's own "Unfulfilled" count (status pending/processing, paid or not).
const unfulfilled = api['/api/orders'].filter((o) => ['pending', 'processing'].includes(o.status)).length;
const paidUnfulfilled = api['/api/orders'].filter((o) => o.paidAt && ['pending', 'processing'].includes(o.status)).length;
check(`Orders to ship (= Orders tab Unfulfilled; ${paidUnfulfilled} of them paid)`, unfulfilled, await text('seller-dashboard-todo-ship'));
const todo = await text('seller-dashboard-todo');
const pendingReturns = api['/api/returns'].filter((r) => r.status === 'pending').length;
check('Returns to review', `${pendingReturns} ${pendingReturns === 1 ? 'return' : 'returns'} to review`, todo);
const live = api['/api/seller/live-map/today'];
check('Live (orders today)', live.total, await text('seller-live-map-count'), (await text('seller-live-map-count')) === String(live.total));
check('Globe caption', `${live.recent.length} ${live.recent.length === 1 ? 'order' : 'orders'} · last 7 days`, await text('seller-globe-caption'));
const globe = page.getByTestId('seller-dashboard-live-map').first();
await globe.scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('[data-testid="seller-dashboard-scroll"]')?.scrollBy(0, 160));
await page.waitForTimeout(1000);
// Tap each recent order's dot when it faces the viewer and compare its popover with the API row.
const box = await page.getByTestId('seller-globe-canvas').boundingBox();
const popovers = [];
// A one-time sheet from a stubbed endpoint sits over the page; dismiss it first.
await page.getByRole('button', { name: 'Done', exact: true }).first().click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(500);
for (const o of live.recent) {
  await page.evaluate(() => document.querySelector('[data-testid="seller-globe-popover"] [aria-label="Close order details"]')?.click());
  await page.waitForTimeout(150);
  // Rotate so this order faces the viewer: wait until its depth is high.
  let p = null;
  for (let i = 0; i < 160; i += 1) { p = await page.evaluate((id) => globalThis.__btOrderGlobe?.project(id), o.id); if (p && p[2] > 0.3) break; await page.waitForTimeout(250); }
  if (!p || p[2] <= 0.3) { popovers.push({ order: o.orderNumber, skipped: 'never faced the viewer (same spot as a newer order)' }); continue; }
  const b = await page.getByTestId('seller-globe-canvas').boundingBox();
  p = await page.evaluate((id) => globalThis.__btOrderGlobe?.project(id), o.id);
  await page.mouse.click(b.x + p[0], b.y + p[1]);
  await page.getByTestId('seller-globe-popover').first().waitFor({ timeout: 3000 }).catch(() => {});
  const shown = await page.getByTestId('seller-globe-popover').first().innerText().catch(() => '');
  const num = await text('seller-globe-popover-number');
  popovers.push({ order: o.orderNumber, popover: shown.replace(/\s+/g, ' '), match: num === o.orderNumber && shown.includes(usd(o.amountCents)) && shown.includes(o.item) });
  if (popovers.length === 2) await globe.screenshot({ path: `${OUT}-crosscheck-globe-popover.png` });
}
await page.screenshot({ path: `${OUT}-crosscheck-top.png` });
fs.writeFileSync(`${OUT}-crosscheck.json`, JSON.stringify({ rows, popovers, unknown: [...unknown], errors }, null, 1));
console.log(JSON.stringify({ rows, popovers, errors: errors.slice(0, 5) }, null, 1));
await browser.close();
