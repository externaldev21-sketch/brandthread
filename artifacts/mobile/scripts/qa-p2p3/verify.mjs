/**
 * QA P2/P3 before/after screenshots at 390x844 on the web preview (demo
 * account + fake API from scripts/store-screenshots). Each scenario opens a
 * route directly (like a deep link), optionally taps through, and saves
 * `<outDir>/<name>.png`. Run against a dev server of this branch and one of
 * origin/dev:
 *   node scripts/qa-p2p3/verify.mjs http://localhost:8081 <after-dir>
 *   node scripts/qa-p2p3/verify.mjs http://localhost:8082 <before-dir>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, waitForQuietNetwork } from '../store-screenshots/harness.mjs';

const [origin, outDir, only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const device = {
  viewport: { width: 390, height: 844 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const MFG = 'a1c3e5f7-2b4d-4e6f-8a1b-3c5d7e9f1a2b';

async function tapText(page, text, { exact = true, last = false } = {}) {
  const loc = page.getByText(text, { exact });
  const target = last ? loc.last() : loc.first();
  await target.click({ timeout: 8000 });
  await page.waitForTimeout(700);
}

async function scrollToText(page, text) {
  await page.getByText(text, { exact: false }).first().scrollIntoViewIfNeeded({ timeout: 8000 });
  await page.waitForTimeout(400);
}

const SCENARIOS = [
  // Web Alert.alert (QA-0302 / 0921): Sign out confirmation.
  { name: 'alert-sign-out', role: 'buyer', route: '/buyer-settings-menu', act: async (p) => { await scrollToText(p, 'out'); await tapText(p, /^(Log|Sign) out$/); } },
  // Validation alert on web (QA-0233 / 0614): invalid reply contact.
  { name: 'alert-request-sample-contact', role: 'seller', route: `/request-sample?manufacturerId=${MFG}`, act: async (p) => {
    await p.getByLabel('Reply contact').fill('asdf');
    // The seller tab bar overlaps this screen's bottom button (existing
    // layout), so press it through its accessibility label.
    await p.getByRole('button', { name: /Send sample request/ }).dispatchEvent('click');
    await p.waitForTimeout(700);
  } },
  // Missing-id deep links (QA-1364 / 0620 / 0316 / 0458 / 0277 / 0285 / 0611).
  { name: 'missing-id-product-reviews', role: 'buyer', route: '/product-reviews' },
  { name: 'missing-id-buyer-collection', role: 'buyer', route: '/buyer-collection' },
  { name: 'missing-id-post-viewer', role: 'buyer', route: '/buyer-post-viewer' },
  { name: 'missing-id-refund-request', role: 'buyer', route: '/buyer-refund-request' },
  { name: 'missing-id-freelancer-profile', role: 'buyer', route: '/freelancer-profile' },
  { name: 'missing-id-quote-detail', role: 'seller', route: '/quote-detail' },
  // Malformed share link (QA-0274 / 0327 / 0575).
  { name: 'drop-malformed-link', role: 'buyer', route: '/drops/demo' },
  // Help: Live Chat opens the in-app support chat; Full Docs removed (QA-0436).
  { name: 'help-live-chat', role: 'buyer', route: '/help', act: async (p) => { await scrollToText(p, 'Live Chat'); await tapText(p, 'Live Chat'); } },
  { name: 'help-contact-row', role: 'buyer', route: '/help', act: async (p) => { await scrollToText(p, 'Live Chat'); } },
  // Paywall copy (QA-0649 / 1343 / 1263).
  { name: 'plans-top', role: 'seller', route: '/plans' },
  { name: 'plans-footer', role: 'seller', route: '/plans', act: async (p) => { await scrollToText(p, 'renew automatically'); } },
  // Taxes & duties (QA-1348 / 1426).
  { name: 'taxes-duties', role: 'seller', route: '/taxes-duties', act: async (p) => { await scrollToText(p, 'International duties'); } },
  // Settings sections (QA-0297–0301 / 0815 / 0819).
  { name: 'settings-messages', role: 'buyer', route: '/buyer-settings-detail?section=messages' },
  { name: 'settings-content', role: 'buyer', route: '/buyer-settings-detail?section=content' },
  { name: 'settings-payments', role: 'buyer', route: '/buyer-settings-detail?section=payments' },
  { name: 'settings-about', role: 'buyer', route: '/buyer-settings-detail?section=about' },
  // Seller More (QA-0646 / 0647).
  { name: 'seller-more', role: 'seller', route: '/more', act: async (p) => { await scrollToText(p, 'Integrations'); } },
  // Vacation return date validation (QA-0751).
  { name: 'vacation-date-validation', role: 'seller', route: '/vacation-mode', act: async (p) => {
    const sw = p.getByRole('switch').first();
    if (!(await sw.isChecked().catch(() => false))) await sw.click();
    await p.waitForTimeout(500);
    const input = p.getByPlaceholder('YYYY-MM-DD');
    await input.fill('next week');
    await tapText(p, /Save/, { exact: false, last: true });
  } },
  // Push notifications route → real settings screen (QA-0580).
  { name: 'push-notifications', role: 'buyer', route: '/push-notifications' },
  // Rewards redeem input (QA-0622).
  { name: 'loyalty-redeem-long', role: 'buyer', route: '/loyalty', act: async (p) => {
    const input = p.getByPlaceholder('100');
    await input.scrollIntoViewIfNeeded();
    await input.fill('99999999999999999999');
  } },
  // Store publish address (QA-0576).
  { name: 'store-publish', role: 'seller', route: '/store-publish', act: async (p) => { await p.mouse.move(195, 400); await p.mouse.wheel(0, 700); await p.waitForTimeout(800); } },
];

const browser = await launchBrowser();
for (const s of SCENARIOS) {
  if (only && !s.name.includes(only)) continue;
  const { context, page, activity } = await openContext(browser, { device, role: s.role, origin, images: {} });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${origin}${s.route}${s.route.includes('?') ? '&' : '?'}bt_preview=${s.role}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitForQuietNetwork(activity, 900, 15_000);
    await page.waitForTimeout(1800);
    if (s.act) await s.act(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
    console.log(`ok   ${s.name}${errors.length ? `  (page errors: ${errors.join(' | ')})` : ''}`);
  } catch (e) {
    await page.screenshot({ path: path.join(outDir, `${s.name}.png`) }).catch(() => {});
    console.log(`FAIL ${s.name}: ${String(e.message).split('\n')[0]}`);
  }
  await context.close();
}
await browser.close();
