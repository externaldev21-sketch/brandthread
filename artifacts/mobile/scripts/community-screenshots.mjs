#!/usr/bin/env node
/**
 * 393x852 screenshots for the community group chats PR. Drives the preview web
 * export in demo mode (`?bt_preview=<role>&demo=1`) — the lively local demo
 * store, no API calls — plus the default fresh preview for the read-only list.
 *
 *   node scripts/community-screenshots.mjs [--skip-build] [only-step-name]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findTextFitIssues } from './lib/text-fit.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/community-group-chats');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

/** Zoomed crop (CSS px) of a card / button group, at 3x, for the PR's close-up review. */
async function zoom(page, name, clip) {
  const png = await page.screenshot({ clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } });
  const sharp = (await import('sharp')).default;
  await sharp(png).resize({ width: clip[2] * 3, kernel: 'lanczos3' }).toFile(path.join(OUT, `zoom-${name}.png`));
  console.log(`  ⌕ zoom-${name}`);
}
const fitReport = {};
async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  // TEXT-FIT & ALIGNMENT pass on every captured screen (see scripts/lib/text-fit.mjs).
  const issues = await findTextFitIssues(page);
  fitReport[name] = issues;
  console.log(`  ${issues.length ? '✗' : '✓'} ${name}${issues.length ? `  (${issues.length} text-fit issue${issues.length === 1 ? '' : 's'})` : ''}`);
  for (const i of issues) console.log(`      - ${i.kind}: ${i.el} — ${i.detail}`);
}
const go = (page, target) => page.evaluate((url) => {
  history.pushState(history.state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}, target);

async function session(browser, origin, role, demo) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images: {} });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  await openScreen(page, activity, origin, role, '/community', {
    beforeNavigate: async () => { if (demo) await page.evaluate(() => localStorage.setItem('bt_preview_demo', '1')); },
  });
  return { context, page, activity };
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const steps = (await import('./community-screenshot-steps.mjs')).default;
    for (const [name, fn] of Object.entries(steps)) {
      if (only && name !== only) continue;
      console.log(name);
      try { await fn({ browser, origin, session, shot, go, zoom }); } catch (e) { console.log('  ! failed:', e.message.split('\n')[0]); }
    }
  } finally {
    writeFileSync(path.join(OUT, 'text-fit-report.json'), JSON.stringify(fitReport, null, 2));
    const bad = Object.entries(fitReport).filter(([, v]) => v.length);
    console.log(bad.length ? `\nTEXT-FIT: ${bad.length} screen(s) with issues` : '\nTEXT-FIT: clean on every screen');
    if (bad.length) process.exitCode = 2;
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
