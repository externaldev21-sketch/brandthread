/**
 * Manufacturer Hub redesign verification (clean landing + find-by-category),
 * seller preview at 390x844. Drives the flow by tapping, not by URL, so the
 * navigation is exercised too:
 *
 *   01 landing, demo seller with manufacturers (&demo=1)
 *   02 landing, fresh seller with none (empty state)
 *   03 category picker  (tap "Find a manufacturer")
 *   04 one category's results (tap "Denim")
 *   05 search within the results
 *   06 a landing section (tap "Quotes") — the existing screen, unchanged
 *
 * Usage: node scripts/store-screenshots/manufacturer-hub-redesign-verify.mjs [outDir]
 * (expects a preview web build at .store-screenshots/web-build — see harness.mjs).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, launchBrowser, serveBuild } from './harness.mjs';

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), 'docs', 'pr-screenshots', 'manufacturer-hub-redesign');
mkdirSync(OUT_DIR, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };

async function openPage(browser, server, pathAndQuery) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce',
  });
  // Preview never needs the network beyond the static build.
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${server.origin}${pathAndQuery}`);
  return { page, errors };
}

async function shot(page, name) {
  await page.waitForTimeout(700);
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file);
}

async function expectVisible(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 });
}

async function main() {
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const failures = [];
  try {
    // ── Demo seller: has manufacturers ─────────────────────────────────────
    const demo = await openPage(browser, server, '/manufacturer-hub?bt_preview=seller&demo=1');
    await expectVisible(demo.page, 'Your manufacturers');
    await expectVisible(demo.page, 'Porto Knit Collective');
    await expectVisible(demo.page, 'Okayama Denim Works');
    await shot(demo.page, '01-landing-with-manufacturers');

    await demo.page.getByTestId('button-find-manufacturer').click();
    await expectVisible(demo.page, 'Dye & wash');
    await shot(demo.page, '03-category-picker');

    await demo.page.getByTestId('find-category-denim').click();
    await expectVisible(demo.page, 'Medina Denim Mills');
    await expectVisible(demo.page, 'Okayama Denim Works');
    await expectVisible(demo.page, 'Compare');
    const count = await demo.page.getByTestId('category-result-count').innerText();
    if (count.trim() !== '2 manufacturers') failures.push(`Denim count was "${count}"`);
    await shot(demo.page, '04-category-results-denim');

    await demo.page.getByPlaceholder('Search denim').fill('okayama');
    await demo.page.waitForTimeout(800);
    const filtered = await demo.page.getByTestId('category-result-count').innerText();
    if (filtered.trim() !== '1 manufacturer') failures.push(`Search within Denim showed "${filtered}"`);
    await shot(demo.page, '05-category-results-search');

    // Back to the landing, then into an existing section.
    await demo.page.goto(`${server.origin}/manufacturer-hub?bt_preview=seller&demo=1`);
    await expectVisible(demo.page, 'Your manufacturers');
    await demo.page.getByTestId('hub-section-quotes').click();
    await demo.page.waitForTimeout(1200);
    await shot(demo.page, '06-section-quotes');
    if (demo.errors.length) failures.push(`page errors: ${demo.errors.join(' | ')}`);

    // ── Fresh seller: none yet ─────────────────────────────────────────────
    const fresh = await openPage(browser, server, '/manufacturer-hub?bt_preview=seller');
    await fresh.page.getByTestId('my-manufacturers-empty').waitFor({ state: 'visible', timeout: 20_000 });
    await shot(fresh.page, '02-landing-empty');
    if (fresh.errors.length) failures.push(`page errors (fresh): ${fresh.errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.close?.();
    server.child?.kill?.();
  }
  if (failures.length) {
    console.error('FAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('All checks passed.');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
