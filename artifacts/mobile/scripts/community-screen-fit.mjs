#!/usr/bin/env node
/**
 * Community screen fixes — 393x852 screenshots plus a text-fit / console audit.
 * Fails (exit 1) on any console error or page error, any nested <button>, any
 * clipped/ellipsised text, or any text box that overflows its parent.
 *
 *   node scripts/community-screen-fit.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude-community-screen-fixes');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const problems = [];
const network404 = [];

const go = (page, target) => page.evaluate((url) => {
  history.pushState(history.state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}, target);

async function nav(page, url, text) {
  for (let i = 0; i < 5; i += 1) {
    await go(page, url);
    await page.waitForTimeout(2200);
    if (await page.getByText(text).first().isVisible().catch(() => false)) return;
  }
  throw new Error(`screen did not open: ${url}`);
}

/** Text-fit audit over everything currently on screen. */
async function audit(page, label) {
  const found = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    document.querySelectorAll('button button').forEach((b) => out.push(`nested <button>: "${(b.textContent || '').trim().slice(0, 40)}"`));
    const texts = [...document.querySelectorAll('div, span, p')].filter((el) => el.childElementCount === 0 && (el.textContent || '').trim());
    for (const el of texts) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const t = (el.textContent || '').trim().slice(0, 40);
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') out.push(`clipped text: "${t}"`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`ellipsis: "${t}"`);
      if (r.left < -1 || r.right > vw + 1) out.push(`off-screen: "${t}"`);
      const p = el.parentElement?.getBoundingClientRect();
      if (p && (r.right > p.right + 1 || r.bottom > p.bottom + 1)) out.push(`overflows parent: "${t}"`);
    }
    return out;
  });
  for (const f of found) problems.push(`${label}: ${f}`);
  console.log(`  ${found.length ? '✗' : '✓'} fit audit ${label}${found.length ? `\n    - ${found.join('\n    - ')}` : ''}`);
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

/** Scrolls the screen's own list (RN-web FlatList container), not the window. */
const scrollList = (page, toEnd) => page.evaluate((end) => {
  const scroller = [...document.querySelectorAll('div')].find((d) => {
    const cs = getComputedStyle(d);
    return /(auto|scroll)/.test(cs.overflowY) && d.scrollHeight > d.clientHeight + 10;
  });
  if (scroller) scroller.scrollTop = end ? scroller.scrollHeight : 0;
  else window.scrollTo(0, end ? document.body.scrollHeight : 0);
}, toEnd);

async function zoom(page, name, selector, nth = 0) {
  const el = page.locator(selector).nth(nth);
  if (!(await el.count())) { console.log(`  ! zoom target missing: ${name}`); return; }
  await el.screenshot({ path: path.join(OUT, `zoom-${name}.png`) });
  console.log(`  ✓ zoom-${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url ?? '';
      // Demo fixture hosts (cdn/api.brandthread.test) serve no images/tips here; a 404 on them is
      // harness noise, not an app error. Everything else is a failure.
      if (/Failed to load resource/.test(m.text()) && /\.brandthread\.test\//.test(url)) { network404.push(url); return; }
      problems.push(`console.error: ${m.text().slice(0, 200)} @ ${url}`);
    });
    await openScreen(page, activity, origin, 'buyer', '/community', {
      beforeNavigate: async () => { await page.evaluate(() => localStorage.setItem('bt_preview_demo', '1')); },
    });
    await page.waitForTimeout(6000);

    console.log('community');
    await nav(page, '/community?bt_preview=buyer', 'Create a group');
    await shot(page, '01-community');
    await audit(page, 'community');
    await zoom(page, 'create-row', '[aria-label="Create a group"]');
    await zoom(page, 'community-row', '[aria-label="Graphic Design Community, 12K members"] >> xpath=../..');
    await zoom(page, 'join-pill', '[aria-label^="Join "]');
    await scrollList(page, true);
    await page.waitForTimeout(600);
    await shot(page, '02-community-bottom');
    await audit(page, 'community (scrolled)');
    await scrollList(page, false);

    console.log('new group');
    await nav(page, '/community-create?bt_preview=buyer', 'Have an invite link?');
    await scrollList(page, true);
    await page.waitForTimeout(600);
    await shot(page, '03-new-group-invite');
    await audit(page, 'new group');
    await zoom(page, 'invite-row', '[aria-label="Invite link or code"] >> xpath=../..');
    await context.close();
  } finally {
    await browser.close();
    close();
  }
  if (network404.length) console.log(`  (ignored ${network404.length} demo-fixture 404s: ${[...new Set(network404)].join(', ')})`);
  if (problems.length) {
    console.log(`\n✗ ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\n✓ clean: zero console errors, zero nested buttons, zero text-fit issues');
}
run().catch((e) => { console.error(e); process.exit(1); });
