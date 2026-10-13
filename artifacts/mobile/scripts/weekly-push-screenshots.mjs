#!/usr/bin/env node
/**
 * Weekly digest + order anniversary notifications — Activity and the classic
 * notifications list, before (dev baseline build) vs after (this branch), at
 * 390x844 and 393x852. A fake GET /api/buyer/notifications serves the two new
 * rows next to existing ones (test scaffolding only). The "after" run also
 * taps each new row to show where it goes.
 *
 *   node scripts/weekly-push-screenshots.mjs [--skip-build]
 *
 * Before: /home/user/baseline-web-build (prebuilt, never rebuilt here).
 * Output: docs/pr-assets/weekly-push/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/weekly-push');
const AFTER_BUILD = path.join(MOBILE_ROOT, '.store-screenshots/web-build');
const BEFORE_BUILD = '/home/user/baseline-web-build';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = [
  { tag: '390x844', viewport: { width: 390, height: 844 } },
  { tag: '393x852', viewport: { width: 393, height: 852 } },
];

const MIN = 60_000;
const iso = (mins) => new Date(DEMO_NOW - mins * MIN).toISOString();
const FEED = [
  {
    id: 'wd1', category: 'social', type: 'digest', title: 'This week from brands you follow',
    body: 'Acme Studio, Nori and 3 more added 12 new pieces.', targetType: 'following_feed', cta: "See what's new", isRead: false, mins: 3,
  },
  {
    id: 'oa1', category: 'social', type: 'order_anniversary', title: 'One year ago today',
    body: "You got Wool Overshirt from Acme Studio. See what's new from Acme Studio.",
    actorId: 'seller-acme', actorName: 'Acme Studio', actorHandle: '@acmestudio', actorInitials: 'AS', actorColor: '#3F3F46',
    targetId: 'seller-acme', targetType: 'user', cta: "See what's new", isRead: false, mins: 60 * 5,
  },
  {
    id: 'np1', category: 'social', type: 'new_product', title: 'Nori just listed Linen Cap', body: 'New from a brand you follow.',
    actorId: 'seller-nori', actorName: 'Nori', actorHandle: '@nori', actorInitials: 'NO', actorColor: '#3F3F46',
    targetId: 'p-cap', targetType: 'product', isRead: true, mins: 60 * 26,
  },
  {
    id: 'nf1', category: 'social', type: 'new_follower', title: 'Priya Shah started following you', body: '',
    actorId: 'u-priya', actorName: 'Priya Shah', actorHandle: '@priya', actorInitials: 'PS', actorColor: '#3F3F46',
    targetId: 'u-priya', targetType: 'user', cta: 'Follow back', isRead: true, mins: 60 * 30,
  },
].map(({ mins, ...row }) => ({ isMuted: false, ...row, createdAt: iso(mins) }));

async function installFakeFeed(context) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const owns = (url) => url.origin === 'https://api.brandthread.test' && /^\/api\/buyer\/notifications(\/.*)?$/.test(norm(url.pathname));
  await context.route(owns, async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(new URL(req.url()).pathname);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(FEED);
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 2, latestId: 'wd1' });
    return json({ ok: true });
  });
}

async function capture(browser, images, buildDir, label) {
  const server = await serveBuild(buildDir);
  try {
    for (const d of DEVICES) {
      for (const screen of [
        { name: 'activity', route: '/activity-center' },
        { name: 'notifications', route: '/buyer-notifications' },
      ]) {
        const device = { viewport: d.viewport, scale: 2, isMobile: true, userAgent: UA };
        const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
        await installFakeFeed(context);
        const seen = [];
        page.on('request', (r) => { if (r.url().includes('api.brandthread')) seen.push(`${r.method()} ${r.url()}`); });
        for (let attempt = 1; ; attempt += 1) {
          await openScreen(page, activity, server.origin, 'buyer', screen.route);
          try { await page.getByText('One year ago today').first().waitFor({ timeout: 15_000 }); break; } catch (e) {
            if (attempt >= 3) {
              await page.screenshot({ path: path.join(OUT, `debug-${label}-${screen.name}.png`) });
              console.log('requests seen:', seen.slice(-15).join('\n'));
              throw e;
            }
          }
        }
        await waitForQuietNetwork(activity, 600, 8000);
        await waitForImages(page);
        await page.waitForTimeout(900);
        const file = path.join(OUT, `${label}-${screen.name}-${d.tag}.png`);
        await page.screenshot({ path: file });
        console.log('saved', path.relative(process.cwd(), file));

        if (label === 'after' && d.tag === '393x852') {
          // Tap targets: digest → Home on Following; anniversary → brand profile.
          await page.getByText('This week from brands you follow').first().click();
          await page.waitForTimeout(5000);
          console.log(`  ${screen.name} digest tap ->`, new URL(page.url()).pathname + new URL(page.url()).search);
          await page.screenshot({ path: path.join(OUT, `after-${screen.name}-tap-digest-${d.tag}.png`) });
        }
        await context.close();
      }
    }
  } finally {
    server.close?.();
  }
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(AFTER_BUILD, 'index.html'))) buildPreviewWeb(AFTER_BUILD);
  if (!existsSync(path.join(BEFORE_BUILD, 'index.html'))) throw new Error(`Baseline build missing: ${BEFORE_BUILD}`);
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await capture(browser, images, BEFORE_BUILD, 'before');
    await capture(browser, images, AFTER_BUILD, 'after');
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
