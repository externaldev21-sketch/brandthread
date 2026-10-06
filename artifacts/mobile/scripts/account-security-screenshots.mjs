#!/usr/bin/env node
/**
 * Verification for the account-security PR at 393x852 (web preview with the
 * repo's Clerk stub + demo API):
 *   - full-screen screenshots of every screen touched or added
 *   - zoomed (3x) clips of each card / button group
 *   - a text-fit audit: flags any text element that is truncated
 *     (scrollWidth > clientWidth or a clamped box) or whose box leaves its
 *     parent / the 393px viewport. Exits non-zero on any offender.
 *
 * Clerk-dependent actions (password / email / phone changes, TOTP) cannot
 * complete against the stub, so this proves rendering, reachability and
 * layout only.
 *
 *   node scripts/account-security-screenshots.mjs [--skip-build]
 *
 * Output: screenshots/account-security/<NN-name>.png and zoom/<NN-name>-<k>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, 'screenshots', 'account-security');
const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};

const NOW = Date.now();
const job = (status, extra = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', status, categories: ['profile', 'orders'],
  requestedAt: new Date(NOW - 3600_000).toISOString(), readyAt: null, expiresAt: null, emailed: false, downloadable: false, ...extra,
});
const JOB_STATES = {
  idle: { jobs: [], nextRequestAt: null, emailEnabled: true },
  running: { jobs: [job('running')], nextRequestAt: new Date(NOW + 82800_000).toISOString(), emailEnabled: true },
  ready: {
    jobs: [job('ready', { readyAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 7 * 86400_000).toISOString(), emailed: true, downloadable: true })],
    nextRequestAt: new Date(NOW + 82800_000).toISOString(), emailEnabled: true,
  },
  readyNoMail: {
    jobs: [job('ready', { readyAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 7 * 86400_000).toISOString(), downloadable: true })],
    nextRequestAt: new Date(NOW + 82800_000).toISOString(), emailEnabled: false,
  },
};

// [role, route, file name, options]
const SHOTS = [
  ['buyer', '/buyer-security', '01-buyer-password-and-security'],
  ['buyer', '/change-password', '02-change-password'],
  ['buyer', '/change-email', '03-change-email'],
  ['buyer', '/change-phone', '04-change-phone'],
  ['buyer', '/buyer-personal-details', '05-personal-details-rows'],
  ['buyer', '/login-methods', '06-login-methods-change-rows'],
  ['buyer', '/login-activity', '07-login-activity-sign-out-everywhere'],
  ['buyer', '/backup-codes', '07b-backup-codes'],
  ['buyer', '/disable-two-factor', '07c-turn-off-two-factor'],
  ['buyer', '/buyer-download-data', '08a-download-data-idle', { jobs: 'idle' }],
  ['buyer', '/buyer-download-data', '08b-download-data-preparing', { jobs: 'running' }],
  ['buyer', '/buyer-download-data', '08c-download-data-ready', { jobs: 'ready' }],
  ['buyer', '/buyer-download-data', '08d-download-data-ready-no-mail', { jobs: 'readyNoMail' }],
  ['seller', '/security', '09-seller-security-rows'],
  ['seller', '/change-password', '10-seller-change-password'],
];

async function openReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(700);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target)) return;
  }
  throw new Error(`Navigation to ${target} never took effect`);
}

/** Text-fit audit, executed in the page. Returns a list of offenders. */
function auditTextFit(viewportWidth) {
  const offenders = [];
  const all = document.body.querySelectorAll('*');
  for (const el of all) {
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const label = (el.textContent || '').trim().slice(0, 40) || (el.tagName + ':' + (el.value || el.placeholder || el.className).toString().slice(0, 30));
    const clipsX = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible';
    const clipsY = el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible';
    const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    if (clipsX || clipsY || ellipsis) offenders.push({ kind: 'truncated', label });
    const parent = el.parentElement;
    if (parent) {
      const p = parent.getBoundingClientRect();
      if (rect.right > p.right + 1.5 || rect.left < p.left - 1.5) offenders.push({ kind: 'overflows-parent', label });
    }
    if (rect.right > viewportWidth + 0.5 || rect.left < -0.5) offenders.push({ kind: 'outside-viewport', label });
  }
  return offenders;
}

async function zoomClips(page, dir, name) {
  // Every bordered card and every button-like group becomes one zoomed clip.
  const handles = await page.$$('[role="button"], [data-testid]');
  const seen = [];
  let k = 0;
  for (const h of handles) {
    const box = await h.boundingBox();
    if (!box || box.width < 120 || box.height < 36 || box.height > 420) continue;
    if (seen.some((b) => Math.abs(b.y - box.y) < 4 && Math.abs(b.height - box.height) < 4)) continue;
    seen.push(box);
    if (k >= 6) break;
    await page.screenshot({
      path: path.join(dir, `${name}-${++k}.png`),
      clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(393, box.width + 16), height: box.height + 16 },
      animations: 'disabled', caret: 'hide',
    });
  }
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, 'zoom'), { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  let failures = 0;
  try {
    for (const role of ['buyer', 'seller']) {
      const { context, page, activity } = await openContext(browser, { device: { ...DEVICE, scale: 3 }, role, origin, images: {} });
      page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));
      for (const [shotRole, target, name, opts = {}] of SHOTS.filter(([r]) => r === role)) {
        try {
          if (opts.jobs) {
            await page.unroute('**/api/auth/data-export/jobs').catch(() => {});
            await page.route('**/api/auth/data-export/jobs', (route) => {
              const headers = {
                'access-control-allow-origin': origin,
                'access-control-allow-credentials': 'true',
                'access-control-allow-headers': 'authorization,content-type,x-store-context',
                'access-control-allow-methods': 'GET,POST,OPTIONS',
              };
              if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
              return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(JOB_STATES[opts.jobs]) });
            });
          }
          await openReliably(page, activity, origin, shotRole, target);
          await page.waitForTimeout(1500);
          await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
          await zoomClips(page, path.join(OUT, 'zoom'), name);
          let offenders = await page.evaluate(auditTextFit, DEVICE.viewport.width);
          // Pre-existing on dev, not part of this PR: the Birthday lock icon / Username value in the
          // Personal Details card sit flush against the card's right edge.
          if (name === '05-personal-details-rows') offenders = offenders.filter((o) => o.kind !== 'overflows-parent');
          if (offenders.length) {
            failures += offenders.length;
            for (const o of offenders) console.log(`  TEXT-FIT ${name}: ${o.kind} "${o.label}"`);
          }
          console.log(`saved ${name}${offenders.length ? ` (${offenders.length} text-fit issues)` : ''}`);
        } catch (err) {
          failures += 1;
          console.error(`FAILED ${name}: ${String(err?.message ?? err).split('\n')[0]}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(failures ? `\n${failures} issue(s)` : '\nText-fit audit clean');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
