#!/usr/bin/env node
/**
 * Screenshots + text-fit audit for the invite-only launch screens
 * (app/access-code.tsx, app/admin-invites.tsx) at 393x852.
 *
 *   node scripts/invite-only-screenshots.mjs [--skip-build]
 *
 * Output: <repo>/docs/pr-assets/invite-only/
 * The audit fails (exit 1) on any clipped/ellipsized text, any text box that
 * overflows its parent or the viewport, and any button/chip/card whose
 * horizontal padding is under 12px (buttons, chips) / 16px (cards).
 */
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'invite-only');
const DEVICE = { viewport: { width: 393, height: 852 }, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
const API = 'https://api.brandthread.test';
const failures = [];

async function openReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(900);
    if (await page.evaluate(() => window.location.pathname) === target.split('?')[0]) return;
  }
  throw new Error(`Navigation to ${target} never took effect`);
}

/** Fulfils a fake API call, answering the CORS preflight the browser sends first. */
function corsReply(origin, status, body) {
  return (route) => {
    const preflight = route.request().method() === 'OPTIONS';
    return route.fulfill({
      status: preflight ? 204 : status,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'content-type': 'application/json',
      },
      body: preflight ? '' : body,
    });
  };
}

async function audit(page, label) {
  const problems = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || !hasOwnText(el)) continue;
      // The floating seller tab bar is existing UI, not part of these screens.
      if (el.getBoundingClientRect().top > window.innerHeight - 110) continue;
      const cs = getComputedStyle(el);
      const text = el.textContent.trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') out.push(`clipped (scrollWidth>clientWidth): "${text}"`);
      if (cs.textOverflow === 'ellipsis' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push(`ellipsis: "${text}"`);
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`outside viewport: "${text}"`);
      const p = el.parentElement;
      if (p) {
        const pr = p.getBoundingClientRect();
        if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5) out.push(`overflows parent: "${text}"`);
      }
      // Nearest ancestor that draws a box (border or background) = the button/chip/card.
      let box = el.parentElement;
      while (box && box !== document.body) {
        const b = getComputedStyle(box);
        const hasBorder = parseFloat(b.borderLeftWidth) > 0;
        const hasBg = b.backgroundColor && b.backgroundColor !== 'rgba(0, 0, 0, 0)' && b.backgroundColor !== 'transparent';
        if (hasBorder || hasBg) break;
        box = box.parentElement;
      }
      if (box && box !== document.body && box.getAttribute('data-audited') !== '1') {
        box.setAttribute('data-audited', '1');
        const b = getComputedStyle(box);
        const bw = box.getBoundingClientRect().width;
        const h = box.getBoundingClientRect().height;
        // Pills centre their text, so an inner gutter is what matters; cards are the large boxes.
        const isCard = h > 70 && bw > 200;
        const min = isCard ? 16 : 12;
        const padL = parseFloat(b.paddingLeft); const padR = parseFloat(b.paddingRight);
        // Segmented container (padding 4) is a track, not a button: skip boxes that contain other boxed children with text.
        const isTrack = box.getAttribute('role') === 'tablist';
        const holdsBoxedChildren = isTrack || [...box.querySelectorAll('*')].some((c) => c !== el && parseFloat(getComputedStyle(c).borderLeftWidth) > 0 && c.textContent.trim());
        if (!holdsBoxedChildren && (padL < min || padR < min) && !(box.firstElementChild && getComputedStyle(box).display === 'flex' && getComputedStyle(box).alignItems === 'center' && padL === 0 && false)) {
          out.push(`${isCard ? 'card' : 'button/chip'} padding ${padL}/${padR} < ${min}: "${box.textContent.trim().slice(0, 30)}"`);
        }
      }
    }
    // Equal-size button groups: bordered buttons that share a row must share a size.
    for (const row of document.querySelectorAll('[data-testid$="-buttons-0"]')) {
      const kids = [...row.querySelectorAll('*')].filter((c) => parseFloat(getComputedStyle(c).borderLeftWidth) > 0 && c.textContent.trim());
      const sizes = kids.map((k) => { const r = k.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
      if (new Set(sizes).size > 1) out.push(`unequal button group: ${sizes.join(' vs ')}`);
    }
    return out;
  });
  const unique = [...new Set(problems)];
  if (unique.length) failures.push({ label, problems: unique });
  console.log(`  audit ${label}: ${unique.length ? unique.join(' | ') : 'ok'}`);
}

async function main() {
  if (!process.argv.includes('--skip-build') || !existsSync(DEFAULT_BUILD_DIR)) buildPreviewWeb();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, 'zoom'), { recursive: true });
  const browser = await launchBrowser();
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const origin = server.origin;
  try {
    for (const scale of [2, 3]) {
      const zoom = scale === 3;
      const dir = zoom ? path.join(OUT, 'zoom') : OUT;
      const device = { ...DEVICE, scale };
      const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled', caret: 'hide' });
      const clip = async (page, name, testIds) => {
        const boxes = [];
        for (const id of testIds) { const b = await page.locator(`[data-testid="${id}"]`).first().boundingBox(); if (b) boxes.push(b); }
        if (!boxes.length) return;
        const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 8);
        const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 8);
        const x2 = Math.min(393, Math.max(...boxes.map((b) => b.x + b.width)) + 8);
        const y2 = Math.max(...boxes.map((b) => b.y + b.height)) + 8;
        await page.screenshot({ path: path.join(OUT, 'zoom', `${name}.png`), clip: { x, y, width: x2 - x, height: y2 - y }, animations: 'disabled', caret: 'hide' });
      };

      // ── Access gate (signed-in new account; no API calls until a button is pressed) ──
      {
        const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
        await page.route(`${API}/api/v1/access/waitlist`, corsReply(origin, 200, '{"ok":true}'));
        await page.route(`${API}/api/v1/access/redeem`, corsReply(origin, 400, '{"error":"That code isn\'t valid.","code":"INVALID_CODE"}'));
        await openReliably(page, activity, origin, 'buyer', '/access-code');
        page.on('pageerror', (e) => console.log('  pageerror:', e.message.split('\n')[0]));
        await page.waitForSelector('[data-testid="access-code-input"]', { timeout: 20_000 }).catch(async (e) => {
          await page.screenshot({ path: path.join(OUT, 'debug.png') });
          console.log('  url:', page.url(), 'body:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
          throw e;
        });
        await page.waitForTimeout(600);
        if (!zoom) { await shot(page, '01-access-code'); await audit(page, 'access-code'); } else await clip(page, 'access-code-form', ['access-form']);
        await page.fill('[data-testid="access-code-input"]', 'WRONG123');
        page.on('request', (rq) => { if (rq.url().includes('/api/')) console.log('  req', rq.method(), rq.url()); });
        page.on('console', (m) => { if (m.type() === 'error') console.log('  console.error', m.text().slice(0, 200)); });
        await page.getByLabel('Continue', { exact: true }).first().click();
        await page.waitForTimeout(1200);
        console.log('  after continue url:', page.url());
        if (!zoom) { await shot(page, '02-access-code-invalid'); await audit(page, 'access-code-invalid'); }
        await page.getByLabel('Join the waitlist').first().click();
        await page.waitForSelector('[data-testid="access-waitlist-input"]');
        if (!zoom) { await shot(page, '03-waitlist'); await audit(page, 'waitlist'); } else await clip(page, 'waitlist-form', ['access-form']);
        await page.fill('[data-testid="access-waitlist-input"]', 'maya.ellison@example.com');
        await page.getByLabel('Join waitlist').first().click();
        await page.waitForTimeout(700);
        if (!zoom) { await shot(page, '04-waitlist-joined'); await audit(page, 'waitlist-joined'); } else await clip(page, 'waitlist-joined-form', ['access-form']);
        await context.close();
      }

      // ── Admin screen (demo data via &demo=1; no API) ──
      {
        const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
        await openReliably(page, activity, origin, 'seller', '/admin-invites?demo=1');
        await page.waitForSelector('[data-testid="invite-mode-card"]', { timeout: 20_000 });
        await page.waitForTimeout(600);
        if (!zoom) { await shot(page, '05-admin-invites-codes'); await audit(page, 'admin-codes'); } else {
          await clip(page, 'admin-mode-and-generate', ['invite-mode-card', 'invite-generate-card']);
        }
        await page.evaluate(() => document.querySelector('[data-testid="invite-code-card-0"]')?.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(300);
        if (!zoom) { await shot(page, '06-admin-invites-codes-list'); await audit(page, 'admin-codes-list'); } else {
          await clip(page, 'admin-code-cards', ['invite-code-card-0', 'invite-code-card-1']);
          await clip(page, 'admin-code-buttons', ['invite-code-buttons-0']);
        }
        await page.getByRole('tab', { name: /Waitlist/ }).click();
        await page.waitForSelector('[data-testid="waitlist-card-0"]');
        await page.waitForTimeout(300);
        if (!zoom) { await shot(page, '07-admin-invites-waitlist'); await audit(page, 'admin-waitlist'); } else {
          await clip(page, 'admin-waitlist-cards', ['waitlist-card-0', 'waitlist-card-1', 'waitlist-card-2']);
          await clip(page, 'admin-waitlist-buttons', ['waitlist-buttons-0']);
        }
        await context.close();
      }

      // ── Touches existing UI: settings row (moderators only) ──
      if (!zoom) {
        for (const moderator of [false, true]) {
          const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
          await page.route(`${API}/api/v1/moderation/me`, corsReply(origin, 200, JSON.stringify({ isModerator: moderator })));
          await openReliably(page, activity, origin, 'seller', '/seller-settings');
          await page.waitForTimeout(1500);
          await page.getByText('Muted words').first().scrollIntoViewIfNeeded().catch(() => {});
          await page.evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => d.textContent === 'Privacy & safety'); el?.scrollIntoView({ block: 'start' }); });
          await page.waitForTimeout(400);
          await shot(page, moderator ? '09-settings-after-moderator' : '08-settings-before-non-moderator');
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.close?.();
  }
  writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify({ failures }, null, 2));
  if (failures.length) { console.error('TEXT-FIT AUDIT FAILED', JSON.stringify(failures, null, 2)); process.exit(1); }
  console.log('text-fit audit passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
