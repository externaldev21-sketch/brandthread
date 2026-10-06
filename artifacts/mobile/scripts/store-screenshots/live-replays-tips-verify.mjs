/**
 * Verification screenshots for live replays (list + player + owner manage)
 * and the live_tips flag in the live viewer.
 *
 * The demo API in harness.mjs has no replay/tips data, so this script
 * intercepts /api/live-replays/* and /api/config/features itself with small
 * fixtures (clearly not from a real backend). Nothing here touches a real DB.
 *
 * Run:  node scripts/store-screenshots/live-replays-tips-verify.mjs [--skip-build]
 * Out:  docs/pr-assets/claude/live-replays-profile-tips/ (repo root)
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, DEFAULT_BUILD_DIR,
} from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude/live-replays-profile-tips');
mkdirSync(OUT, { recursive: true });
const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const svg = (c) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="${c}"/></svg>`)}`;
const replays = [
  { streamId: '11111111-1111-4111-8111-111111111111', sellerId: 'seller_x', postId: 'p1', title: 'Fall drop live', description: null, thumbnailUrl: svg('#8a8a8a'), replayUrl: 'about:blank', peakViewerCount: 42, startedAt: '2026-09-01T10:00:00Z', endedAt: '2026-09-01T10:32:10Z', durationSeconds: 1930, isOwner: true, visibility: 'public' },
  { streamId: '22222222-2222-4222-8222-222222222222', sellerId: 'seller_x', postId: 'p2', title: 'Restock Q&A', description: null, thumbnailUrl: svg('#b5b5b5'), replayUrl: 'about:blank', peakViewerCount: 12, startedAt: '2026-08-20T10:00:00Z', endedAt: '2026-08-20T10:12:00Z', durationSeconds: 720, isOwner: true, visibility: 'hidden' },
];

const problems = [];

/** Text-fit & alignment pass: flags text clipped by its own box (scrollWidth >
 *  clientWidth or scrollHeight > clientHeight) and text/buttons whose box
 *  leaves the viewport or overflows their parent horizontally. */
async function fitCheck(page, name) {
  const found = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const label = (el.textContent || '').trim().slice(0, 40);
      if (hasText && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && cs.overflow !== 'scroll') {
        out.push(`clipped text "${label}" (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`);
      }
      if (hasText && (r.left < -1 || r.right > vw + 1)) out.push(`text outside viewport "${label}"`);
      const pr = el.parentElement?.getBoundingClientRect();
      if (hasText && pr && pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1) && getComputedStyle(el.parentElement).overflow === 'visible') {
        out.push(`text overflows parent "${label}"`);
      }
    }
    return out;
  });
  for (const f of found) problems.push(`${name}: ${f}`);
  console.log(`fit-check ${name}: ${found.length} problem(s)`);
}

async function shot(page, name) {
  await page.waitForTimeout(700);
  await fitCheck(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled' });
  console.log('saved', name);
}

async function open(browser, origin, target, flags) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
  const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console error: ${m.text().slice(0, 200)}`); });
  await page.route('**/live-replays/**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.includes('/by-seller/')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ replays, hasMore: false }) });
    const id = url.pathname.split('/').pop();
    const replay = replays.find((r) => r.streamId === id) ?? replays[0];
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ replay }) });
  });
  await page.route('**/config/features', (route) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ flags, updatedAt: null }) }));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, 'seller', target);
    await page.waitForTimeout(700);
    if ((await page.evaluate(() => window.location.pathname)).startsWith(target.split('?')[0])) break;
  }
  await waitForQuietNetwork(activity, 600, 8000);
  return { context, page };
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    let s = await open(browser, origin, '/live-replays?sellerId=seller_x', {});
    await shot(s.page, '01-replays-list-owner');
    await s.page.getByLabel(`Manage replay ${replays[0].title}`).click();
    await shot(s.page, '02-replays-manage-sheet');
    await s.context.close();

    s = await open(browser, origin, `/live-replay?streamId=${replays[0].streamId}`, {});
    await shot(s.page, '03-replay-player-owner');
    await s.page.screenshot({ path: path.join(OUT, '03b-replay-player-actions-zoom.png'), clip: { x: 0, y: 690, width: 393, height: 162 } });
    await s.context.close();
    if (problems.length) { console.log(problems.join('\n')); process.exitCode = 1; } else console.log('text-fit + console: clean');
  } finally {
    await browser.close();
    await close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
