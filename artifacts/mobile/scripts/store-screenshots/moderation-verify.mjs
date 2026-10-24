#!/usr/bin/env node
/**
 * Verification for the moderation PR (App Store 1.2): drives the production
 * web export at 390x844 through the post "⋯" menu Block flow (menu -> confirm
 * -> author's posts gone -> Settings › Blocked accounts -> Unblock) and the
 * Report flow (menu -> reason -> sent), and records the exact bodies POSTed
 * to /api/social/block and /api/reports.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/moderation-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/screenshots/moderation'));
mkdirSync(OUT, { recursive: true });

const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
const AUTHOR = { id: 'seller_northline', name: 'Northline Studio' };

/** Records block/report writes and serves the blocked list from them. */
async function installModerationApi(context, log) {
  const blocked = new Set();
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const owns = (url) => url.origin === 'https://api.brandthread.test'
    && /^\/api\/(social\/blocks?|social\/block\/.+|social\/block-status\/.+|reports)$/.test(norm(url.pathname));
  await context.route(owns, async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(new URL(req.url()).pathname);
    const body = req.postDataJSON?.() ?? null;
    if (req.method() !== 'GET') log.push({ method: req.method(), path: p, body });
    if (p === '/api/social/block' && req.method() === 'POST') { blocked.add(body.userId); return json({ ok: true }); }
    if (p.startsWith('/api/social/block/') && req.method() === 'DELETE') { blocked.delete(decodeURIComponent(p.split('/').pop())); return json({ ok: true }); }
    if (p.startsWith('/api/social/block-status/')) return json({ blockedByMe: blocked.has(decodeURIComponent(p.split('/').pop())), blockedMe: false });
    if (p === '/api/social/blocks') {
      return json([...blocked].map((userId) => ({
        userId, name: userId === AUTHOR.id ? AUTHOR.name : userId, handle: '@northlinestudio', initials: 'NS',
        avatarUrl: null, accountType: 'seller', color: '#3F3F46', blockedAt: new Date().toISOString(),
      })));
    }
    if (p === '/api/reports' && req.method() === 'POST') return json({ id: 'report_1', status: 'pending' }, 201);
    return json({ ok: true });
  });
}

async function main() {
  // CHROMIUM_PATH: use a preinstalled Chromium when Playwright's pinned build isn't downloaded.
  const browser = process.env.CHROMIUM_PATH
    ? await (await import('playwright')).chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
    : await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const log = [];
  const results = {};
  try {
    const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
    await installModerationApi(context, log);
    const settle = async (ms = 600) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
    const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log(`captured ${name}`); };
    const firstNorthlineTile = () => page.locator('[data-testid^="discover-tile-trend_post_trending_1"]').first();
    const openDiscover = async () => {
      // The client-side route push occasionally lands before the router is
      // ready; retry like the other verify scripts do.
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'buyer', '/discover');
        try { await firstNorthlineTile().waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
      }
      const accept = page.getByText('Accept all', { exact: true }).first();
      if (await accept.isVisible().catch(() => false)) await accept.click();
      await settle(900);
    };
    // Tap a tile -> full-screen viewer -> its "⋯" button opens the post menu.
    const openPostMenu = async () => {
      await firstNorthlineTile().click();
      const more = page.getByRole('button', { name: 'more-horizontal' }).first();
      await more.waitFor({ timeout: 10_000 });
      await settle(500);
      await more.click();
      await page.getByTestId('discover-safety-menu-backdrop').waitFor({ timeout: 10_000 });
      await settle(400);
    };

    // ── Report flow ──────────────────────────────────────────────────────────
    await openDiscover();
    await openPostMenu();
    await shot('report-01-post-menu');
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await page.getByTestId('report-sheet').waitFor({ timeout: 10_000 });
    await settle(700);
    await shot('report-02-reasons');
    await page.getByRole('button', { name: 'Counterfeit or IP violation' }).click();
    await settle(1200);
    await shot('report-03-sent');
    results.report = log.find((entry) => entry.path === '/api/reports')?.body ?? null;
    await page.getByRole('button', { name: 'Done' }).click().catch(() => {});
    await settle();

    // ── Block flow ───────────────────────────────────────────────────────────
    await openDiscover();
    // The demo trending feed's Northline posts are post_trending_1 and _5.
    const northlineTiles = () => page.locator('[data-testid="discover-tile-trend_post_trending_1"], [data-testid="discover-tile-trend_post_trending_5"]').count();
    results.northlinePostTilesBefore = await northlineTiles();
    await openPostMenu();
    await shot('block-01-post-menu');
    await page.getByRole('button', { name: `Block ${AUTHOR.name}` }).click();
    await page.getByText(`Block ${AUTHOR.name}?`).waitFor({ timeout: 10_000 });
    await settle(500);
    await shot('block-02-confirm');
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await settle(1200);
    // Blocking closes the viewer; back on the grid every Northline tile is gone.
    await shot('block-03-posts-hidden');
    results.block = log.find((entry) => entry.path === '/api/social/block')?.body ?? null;
    results.northlinePostTilesAfter = await northlineTiles();

    await openScreen(page, activity, origin, 'buyer', '/buyer-blocked');
    await page.getByText(AUTHOR.name).first().waitFor({ timeout: 15_000 });
    await settle(800);
    await shot('block-04-settings-blocked-accounts');
    await page.getByRole('button', { name: /Unblock/ }).first().click();
    await settle(500);
    await shot('block-05-unblock-confirm');
    const confirm = page.getByRole('button', { name: 'Unblock', exact: true }).last();
    if (await confirm.isVisible().catch(() => false)) { await confirm.click(); await settle(1000); }
    await shot('block-06-unblocked');
    results.unblock = log.find((entry) => entry.method === 'DELETE')?.path ?? null;

    await context.close();
  } finally {
    await close();
    await browser.close();
  }
  console.log(JSON.stringify({ results, writes: log }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
