#!/usr/bin/env node
/**
 * Packer seat (item 58) on the store-screenshots harness (fake API).
 *
 *   node scripts/f4-team-screenshots.mjs <buildDir> <outDir> <before|after> [width] [height]
 *
 * Owner: Team → Invite with the role picker, and the Roles list. Packer
 * (demo preview `&demo=1&team_role=packer`): Home opens Orders, and a seller
 * screen outside order work shows the locked view. "before" captures only the
 * owner screens that exist on dev.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const VIEWPORT = { width: Number(process.argv[5] ?? 393), height: Number(process.argv[6] ?? 852) };
const TAG = `${MODE}-${VIEWPORT.width}x${VIEWPORT.height}`;
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// Mirrors api-server routes/team.ts ROLE_DEFINITIONS on this branch.
const ROLES_AFTER = [
  { key: 'owner', name: 'Owner', group: 'Organization', description: 'Full access to all features including billing, payouts, and team management', permissions: ['*'], staffCount: 1, pendingCount: 0 },
  { key: 'admin', name: 'Admin', group: 'Organization', description: 'Manage products, orders, inventory, analytics, customers, marketing, payouts and the team', permissions: [], staffCount: 1, pendingCount: 0 },
  { key: 'finance', name: 'Finance', group: 'Store', description: 'View balance, payouts, transactions and statements', permissions: [], staffCount: 0, pendingCount: 0 },
  { key: 'orders', name: 'Orders', group: 'Store', description: 'Manage orders, fulfillment and inventory', permissions: [], staffCount: 0, pendingCount: 0 },
  { key: 'packer', name: 'Packer', group: 'Store', description: "Sees orders to pack and ship. No sales, payouts, customers' contact details or store settings.", permissions: ['fulfillment'], staffCount: 1, pendingCount: 0 },
  { key: 'marketing', name: 'Marketing', group: 'Store', description: 'Manage ads, boosts and discount codes', permissions: [], staffCount: 0, pendingCount: 1 },
  { key: 'viewer', name: 'Viewer', group: 'Store', description: 'Read-only access to analytics and store data', permissions: [], staffCount: 0, pendingCount: 0 },
];

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`), caret: 'hide' });
  console.log(`  ok ${TAG}-${name}`);
}

async function overflowCheck(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const offScreen = r.right > vw + 1 || r.left < -1;
      if (ellipsis || offScreen) out.push({ text: text.slice(0, 40), ellipsis, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
}

async function context(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const ctx = await openContext(browser, { device, role: 'seller', origin, images });
  if (MODE === 'after') {
    await ctx.context.route(`${API}/**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fallback();
      const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
      if (p === '/api/team/roles') return json(route, ROLES_AFTER);
      return route.fallback();
    });
  }
  return ctx;
}

async function ownerFlow(browser, images, origin) {
  const { context: c, page, activity } = await context(browser, images, origin);
  await openScreen(page, activity, origin, 'seller', '/team', { extraQuery: '&demo=1' });
  await page.getByText('Staff Accounts').first().waitFor({ timeout: 20_000 });
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.getByText('Invite', { exact: true }).first().click();
  await page.getByPlaceholder('Email address or @username').waitFor({ timeout: 10_000 });
  if (MODE === 'after') await page.getByText('Packer', { exact: true }).first().click();
  await page.waitForTimeout(700);
  await shot(page, '01-invite-role-picker');
  await overflowCheck(page, 'invite');
  await c.close();

  const second = await context(browser, images, origin);
  await openScreen(second.page, second.activity, origin, 'seller', '/roles', { extraQuery: '&demo=1' });
  await second.page.getByText('Roles', { exact: true }).first().waitFor({ timeout: 20_000 });
  await waitForQuietNetwork(second.activity, 900, 15_000);
  await second.page.waitForTimeout(800);
  await shot(second.page, '02-roles');
  await overflowCheck(second.page, 'roles');
  await second.context.close();
}

async function packerFlow(browser, images, origin) {
  const extraQuery = '&demo=1&team_role=packer';
  {
    const { context: c, page, activity } = await context(browser, images, origin);
    await openScreen(page, activity, origin, 'seller', '/', { extraQuery });
    await page.waitForTimeout(5000);
    await waitForQuietNetwork(activity, 900, 15_000);
    console.log('  packer home landed on', new URL(page.url()).pathname);
    await shot(page, '03-packer-home-opens-orders');
    await overflowCheck(page, 'packer-orders');
    await c.close();
  }
  for (const [target, name] of [['/products', '04-packer-products-locked'], ['/store-settings', '05-packer-store-settings-locked']]) {
    const { context: c, page, activity } = await context(browser, images, origin);
    await openScreen(page, activity, origin, 'seller', target, { extraQuery });
    await page.getByTestId('packer-route-locked').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await shot(page, name);
    await overflowCheck(page, name);
    await c.close();
  }
}

const server = await serveBuild(BUILD);
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
try {
  await ownerFlow(browser, images, server.origin);
  if (MODE === 'after') await packerFlow(browser, images, server.origin);
} finally {
  await browser.close();
  await server.close();
}
