/**
 * QA wiring/dead-route fixes — 390×844 screenshots on the store-screenshots
 * harness (signed-in demo account, fake API; per-shot API overrides below).
 * Build first: node -e "import('./scripts/store-screenshots/harness.mjs').then(h => h.buildPreviewWeb())"
 *   node scripts/qa-wiring-fixes-screenshots.mjs [name-filter ...]
 * Output: docs/pr-review/qa-wiring-fixes/<shot>.png
 */
import path from 'node:path';
const H = './store-screenshots/';
const { DEFAULT_BUILD_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } = await import(H + 'harness.mjs');
const { ensureDemoImages } = await import(H + 'demo-images.mjs');
const OUT = path.join(import.meta.dirname, '../docs/pr-review/qa-wiring-fixes');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const only = process.argv.slice(2);

const ok = (b) => [200, b];
const SHOTS = [
  { name: 'qa0007-buyer-checkout-empty', role: 'buyer', target: '/buyer-checkout', seed: { 'bt:cart:v1': null }, api: { '/api/buyer/cart': ok({ items: [] }) }, clearCart: true },
  { name: 'qa0012-thread-checkout-empty', role: 'buyer', target: '/thread-checkout', api: { '/api/buyer/cart': ok({ items: [] }) }, clearCart: true },
  { name: 'qa0150-shipping-presets', real: true, scrollEnd: true, role: 'seller', target: '/shipping', api: { '/api/package-presets': ok({ presets: [{ id: 'pp1', name: 'Tee mailer', weightOz: '8', lengthIn: '10.00', widthIn: '8.00', heightIn: '1.00', createdAt: '2026-09-01' }] }) } },
  { name: 'qa0118-seller-activity-route', role: 'seller', target: '/activity' },
  { name: 'qa0161-store-builder', role: 'seller', target: '/store-builder' },
  { name: 'qa0149-share-profile', role: 'seller', target: '/share-profile' },
  { name: 'qa0081-store-domain-unclaimed', real: true, role: 'seller', target: '/store-domain', api: {
      '/api/store/subdomain': ok({ subdomain: null, status: 'unclaimed', assignedSlug: 'store-1a2b3c4d', suggestion: 'ateliernoire', url: null, claimedAt: null }),
      '/api/store/subdomain/availability': ok({ subdomain: 'ateliernoire', available: true }), '/api/store/domains': ok([]) } },
  { name: 'qa0081-store-domain-active', real: true, role: 'seller', target: '/store-domain', api: {
      '/api/store/subdomain': ok({ subdomain: 'ateliernoire', status: 'active', assignedSlug: 'ateliernoire', suggestion: null, url: 'https://ateliernoire.brandthread.app', claimedAt: '2026-09-01T00:00:00Z' }),
      '/api/store/domains': ok([]) } },
  { name: 'qa0081-store-domain-taken', real: true, role: 'seller', target: '/store-domain', api: {
      '/api/store/subdomain': ok({ subdomain: null, status: 'unclaimed', assignedSlug: 'store-1a2b3c4d', suggestion: 'noir', url: null, claimedAt: null }),
      '/api/store/subdomain/availability': ok({ subdomain: 'noir', available: false, reason: 'taken', message: 'That subdomain is already taken.' }), '/api/store/domains': ok([]) } },
  { name: 'qa0080-store-domain-demo', role: 'seller', demo: true, target: '/store-domain' },
  { name: 'qa0172-vacation-mode', real: true, role: 'seller', target: '/vacation-mode', api: { '/api/seller/vacation': ok({ vacationMode: true, vacationMessage: 'Back on the 20th.', vacationUntil: '2026-09-20T00:00:00Z' }) } },
  { name: 'qa0172-vacation-mode-bottom', real: true, scrollEnd: true, role: 'seller', target: '/vacation-mode', api: { '/api/seller/vacation': ok({ vacationMode: true, vacationMessage: 'Back on the 20th.', vacationUntil: '2026-09-20T00:00:00Z' }) } },
  { name: 'qa0173-vacation-load-error', real: true, role: 'seller', target: '/vacation-mode', api: { '/api/seller/vacation': [500, { error: 'boom' }] } },
  { name: 'qa0140-ip-report-bottom', role: 'seller', target: '/ip-report', scrollEnd: true },
  { name: 'qa0076-discounts-new', role: 'seller', target: '/discounts', api: { '/api/discount-codes': ok([]) }, clickText: ['New code', 'Create code', 'Create'] },
  { name: 'qa0076-discounts-dates', role: 'seller', target: '/discounts', api: { '/api/discount-codes': ok([]) }, clickText: ['New code', 'Create code', 'Create'], scrollEnd: true },
  { name: 'qa0090-finance-statement-error', real: true, role: 'seller', target: '/finance', api: { '/api/finance/statement.csv': [500, { error: 'x' }] }, clickText: ['Download Statement (CSV)'], scrollEnd: true },
  { name: 'qa0121-payments', role: 'seller', target: '/payments', api: { '/api/drops': ok([]) } },
  { name: 'qa0128-privacy-safety', role: 'buyer', demo: true, target: '/conversation-privacy-safety?id=preview-conversation-01', api: { '/api/conversations/c1': ok({ id: 'c1', participants: [{ userId: 'buyer_demo', name: 'Me' }, { userId: 'u2', name: 'Kuro Line', username: 'kuroline' }] }) } },
  { name: 'qa0128-privacy-safety-missing', role: 'buyer', target: '/conversation-privacy-safety' },
  { name: 'qa0117-nicknames', role: 'buyer', demo: true, target: '/conversation-nicknames?id=preview-conversation-01', api: { '/api/conversations/c1': ok({ id: 'c1', participants: [{ userId: 'buyer_demo', name: 'Me' }, { userId: 'u2', name: 'Kuro Line', username: 'kuroline' }] }) } },
  { name: 'qa0037-buyer-profile-demo', role: 'buyer', demo: true, target: '/profile' },
  { name: 'qa0135-prompt-edit', role: 'seller', target: '/design-prompt-edit' },
  { name: 'qa0126-boost-preselect', role: 'seller', demo: true, target: '/boost?targetType=post&targetId=preview-video-1' },
  { name: 'qa0113-design-campaign-existing', real: true, role: 'seller', target: '/design-campaign?campaignId=c1', api: { '/api/ad-campaigns/c1': ok({ campaign: { id: 'c1', sellerId: 's', status: 'draft', mediaKind: 'photos', mediaObjectPaths: ['/objects/a'], mediaMimeTypes: ['image/jpeg'], mediaUrls: ['https://cdn.brandthread.test/demo/look-1.jpg'], headline: 'Fall drop', description: 'New season pieces', ctaKind: 'shop_now', ctaDestinationKind: null, ctaDestinationId: null, formats: [], budgetCents: 5000, durationDays: 14, estimatedReachLow: 0, estimatedReachHigh: 0, estimatedReach: { low: 0, high: 0, label: 'estimate' }, stripeCheckoutSessionId: null, paidAt: null, startsAt: null, endsAt: null, creativeConfig: null, createdAt: '2026-09-01', updatedAt: '2026-09-01' } }) } },
];

const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(import.meta.dirname, '../.store-screenshots/demo-images')).catch(() => ({}));
const log = [];
for (const shot of SHOTS) {
  if (only.length && !only.some((o) => shot.name.includes(o))) continue;
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: shot.role, origin: server.origin, images: images ?? {} });
  const calls = [];
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    calls.push(`${req.method()} ${p}`);
    const hit = shot.api?.[p];
    if (hit && (req.method() === 'GET' || p.endsWith('.csv'))) {
      return route.fulfill({ status: hit[0], contentType: 'application/json', headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(hit[1]) });
    }
    return route.fallback();
  });
  try {
    await openScreen(page, activity, server.origin, shot.demo ? `${shot.role}&demo=1` : shot.role, shot.real ? '/' : shot.target, {
      beforeNavigate: shot.clearCart ? async () => { await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/cart|checkout/i.test(k)) localStorage.removeItem(k); }); } : undefined,
    });
    await waitForQuietNetwork(activity, 900, 12_000);
    const want = shot.target.split('?')[0];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2500);
      const u = new URL(page.url());
      if (u.pathname === want && !(shot.real && u.searchParams.has('bt_preview'))) break;
      await page.evaluate(([url, real]) => {
        if (real) localStorage.removeItem('user_role');
        history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, [shot.real ? shot.target : `${shot.target}${shot.target.includes('?') ? '&' : '?'}bt_preview=${shot.role}`, !!shot.real]);
      await waitForQuietNetwork(activity, 900, 12_000);
    }
    await page.waitForTimeout(1500);
    for (const t of shot.clickText ?? []) {
      const el = page.getByText(t, { exact: true }).first();
      if (await el.count()) { await el.click().catch(() => {}); await page.waitForTimeout(1200); break; }
    }
    if (shot.scrollEnd) {
      await page.evaluate(() => { document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; }); });
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
    const dbg = await page.evaluate(() => JSON.stringify({ s: location.search, d: localStorage.getItem('bt_preview_demo'), r: localStorage.getItem('user_role') }));
    log.push(`${shot.name}: ok ${dbg} url=${page.url().replace(server.origin, '')}  api=${[...new Set(calls)].join(', ')}${errs.length ? '\n   ERRORS: ' + errs.slice(0,6).join('\n   ') : ''}`);
  } catch (e) {
    log.push(`${shot.name}: FAILED ${e.message.split('\n')[0]}`);
  }
  await context.close();
}
await browser.close();
server.close();
console.log(log.join('\n'));
