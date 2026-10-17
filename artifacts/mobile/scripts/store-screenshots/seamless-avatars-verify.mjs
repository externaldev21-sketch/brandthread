#!/usr/bin/env node
/**
 * 390x844 before/after screenshots for "seamless avatars + circle crop":
 * profile header, inbox, comments, the official @brandthread chat + details,
 * and (after only) the profile-picture move-and-scale crop step.
 *
 * Runs against a DEV web export (`expo export --dev`, same env as
 * harness.buildPreviewWeb) because the app's own `?bt_preview=buyer&demo=1`
 * preview data only exists when __DEV__ is on — i.e. what Dev sees in the
 * Replit preview. One screenshot-only fixture (a public seller profile) is
 * layered on top; nothing here ships in the app.
 *
 *   node scripts/store-screenshots/seamless-avatars-verify.mjs <devBuildDir> <outDir> <prefix> [--crop]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { IMAGE_HOST } from './demo-data.mjs';

const [buildDir, outDir, prefix] = process.argv.slice(2);
const withCrop = process.argv.includes('--crop');
mkdirSync(outDir, { recursive: true });

const img = (name) => `${IMAGE_HOST}/${name}.jpg`;

// The only screenshot fixture: a public seller profile (the hero header with
// the old always-on white ring + "verified" accent ring has no demo=1 data).
// Everything else is the app's own demo=1 preview data.
const DEMO_SELLER = {
  clerkId: 'demo-seller-noire', brandName: 'Atelier Noire', username: 'ateliernoire', bio: 'Midnight tailoring, cut for movement.',
  verified: true, profileImageUrl: img('portrait-mono'), coverPosterUrl: img('look-mono'),
  productsCount: 12, videosCount: 8, likesCount: 12400, followersCount: 9800, followingCount: 120,
};

async function installFakeApi(context, origin) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  await context.route((url) => url.origin === 'https://api.brandthread.test', async (route) => {
    const req = route.request();
    const p = norm(new URL(req.url()).pathname);
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'POST' && /\/profile\/avatar\/upload$/.test(p)) {
      // Echo the uploaded crop back as the "stored" avatar, and keep a copy as proof of the 800x800 output.
      const body = req.postDataBuffer() ?? Buffer.alloc(0);
      const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      const end = body.lastIndexOf(Buffer.from([0xff, 0xd9]));
      const jpeg = start >= 0 && end > start ? body.subarray(start, end + 2) : null;
      if (jpeg) writeFileSync(path.join(outDir, `${prefix}-crop-output.jpg`), jpeg);
      return json({ profileImageUrl: jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null });
    }
    if (req.method() === 'GET' && p === '/api/public/sellers/demo-seller-noire') return json({ profile: DEMO_SELLER, products: [], posts: [] });
    return route.fallback();
  });
}

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(path.dirname(buildDir), 'demo-images'));
const server = await serveBuild(buildDir);
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const role = 'buyer';
const shotPath = (name) => path.join(outDir, `${prefix}-${name}.png`);

/** Loads `target` directly (deep link) in the demo=1 buyer preview — more reliable than a client-side push. */
async function open(page, activity, target) {
  await page.goto(`${server.origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}&demo=1`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
}

async function screen(target, name, waitText, after) {
  const { context, page, activity } = await openContext(browser, { device, role, origin: server.origin, images });
  await installFakeApi(context, server.origin);
  try {
    await open(page, activity, target);
    if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 25_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath(name) });
    console.log('saved', shotPath(name));
    if (after) await after(page);
  } catch (error) {
    console.error(`FAILED ${name}:`, error.message);
    await page.screenshot({ path: shotPath(`${name}-FAILED`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

await screen('/seller-profile?sellerId=demo-seller-noire', 'profile-header', 'Atelier Noire');
await screen('/profile', 'own-profile', 'Jordan Reyes');
await screen('/inbox', 'inbox', 'Brandthread Agent');
await screen('/buyer-post-comments?postId=preview-fashion-01&postAuthorName=Atelier%20Noire', 'comments', 'Reply');
await screen('/buyer-conversation?id=preview-conversation-brandthread', 'brandthread-chat', 'Brandthread Agent', async (page) => {
  // The chat header avatar opens the @brandthread details/profile card.
  await page.getByTestId('conversation-avatar').first().click();
  await page.getByText('@brandthread').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shotPath('brandthread-profile') });
  console.log('saved', shotPath('brandthread-profile'));
});

if (withCrop) {
  const { context, page, activity } = await openContext(browser, { device, role, origin: server.origin, images });
  await installFakeApi(context, server.origin);
  try {
    await open(page, activity, '/(buyer)/edit-profile');
    await page.getByText('Change profile photo or video').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await page.getByText('Change profile photo or video').first().click();
    await page.getByText('Choose from Library').first().waitFor({ timeout: 10_000 });
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await page.getByText('Choose from Library').first().click();
    await (await chooser).setFiles(images['look-rust']);
    await page.getByTestId('avatar-crop-stage').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath('crop-initial') });
    const box = await page.getByTestId('avatar-crop-stage').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Zoom in (wheel, about a point above centre) then drag the photo.
    await page.mouse.move(cx, cy - 60);
    for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, -60); await page.waitForTimeout(60); }
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 70, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    await page.screenshot({ path: shotPath('crop-moved-zoomed') });
    console.log('saved crop screens');
    await page.getByTestId('avatar-crop-done').click();
    await page.getByTestId('avatar-crop-stage').waitFor({ state: 'detached', timeout: 15_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath('crop-result-edit-profile') });
    // The saved picture itself (demo mode keeps the local crop instead of uploading it).
    const src = await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.src).find((u) => u.startsWith('data:image/jpeg') || u.startsWith('blob:')));
    if (src) {
      const b64 = await page.evaluate(async (u) => { const r = await fetch(u); const buf = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const c of buf) s += String.fromCharCode(c); return btoa(s); }, src);
      writeFileSync(path.join(outDir, `${prefix}-crop-output.jpg`), Buffer.from(b64, 'base64'));
    }
    console.log('saved crop result');
  } catch (error) {
    console.error('FAILED crop:', error.message);
    await page.screenshot({ path: shotPath('crop-FAILED') }).catch(() => {});
  } finally {
    await context.close();
  }
}

server.close();
await browser.close();
