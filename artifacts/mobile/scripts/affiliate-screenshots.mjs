/**
 * Screenshots of the creator program screens at 393x852 in the dev web preview
 * (?bt_preview=...&demo=1 for the seeded demo, none for the fresh state).
 *   node scripts/affiliate-screenshots.mjs [outDir]
 * Reuses the store-screenshot harness (build + static server + Chromium).
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { buildPreviewWeb, serveBuild, launchBrowser, DEFAULT_BUILD_DIR } from './store-screenshots/harness.mjs';

const out = path.resolve(process.argv[2] ?? '../../screenshots/affiliate-program');
mkdirSync(out, { recursive: true });
if (!process.env.SKIP_BUILD) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();

const shots = [
  ['seller-program-demo', 'seller', 'seller-creator-program', true],
  ['seller-program-fresh', 'seller', 'seller-creator-program', false],
  ['seller-settings', 'seller', 'seller-creator-settings', true],
  ['seller-creator-detail', 'seller', 'seller-creator-detail?id=c1', true],
  ['creator-overview-demo', 'buyer', 'creator-program', true],
  ['creator-overview-fresh', 'buyer', 'creator-program', false],
  ['creator-payouts', 'buyer', 'creator-program#payouts', true],
  ['creator-join', 'buyer', 'creator-program-join?brand=northline', true],
];

for (const [name, role, route, demo] of shots) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.route('**/*', (r) => (new URL(r.request().url()).origin === server.origin ? r.continue() : r.abort()));
  await page.goto(`${server.origin}/?bt_preview=${role}${demo ? '&demo=1' : ''}`);
  await page.waitForTimeout(2500);
  await page.evaluate((url) => { history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, `/${route.split('#')[0]}${route.includes('?') ? '' : ''}`);
  await page.waitForTimeout(2500);
  if (route.endsWith('#payouts')) { await page.getByText('Payouts', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(600); }
  await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  // TEXT-FIT pass: flag clipped/ellipsized text and anything overflowing its parent or the 393px screen.
  const issues = await page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!ownText) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const label = el.textContent.trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') found.push(`clipped: "${label}"`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) found.push(`ellipsis: "${label}"`);
      if (r.right > window.innerWidth + 1 || r.left < -1) found.push(`off-screen: "${label}"`);
      const pr = el.parentElement?.getBoundingClientRect();
      if (pr && (r.right > pr.right + 1 || r.left < pr.left - 1)) found.push(`overflows parent: "${label}"`);
    }
    return [...new Set(found)];
  });
  console.log(`${name}: ${issues.length === 0 ? 'text-fit OK' : issues.join(' | ')}`);
  await page.setViewportSize({ width: 393, height: 1900 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${name}-full.png`) });
  await context.close();
  console.log('saved', name);
}
await browser.close();
server.close();
