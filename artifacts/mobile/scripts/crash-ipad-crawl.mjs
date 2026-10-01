#!/usr/bin/env node
/**
 * Crash / iPad-size crawl of the web preview. Opens the main flows (signed-out,
 * demo buyer, demo seller) at phone and iPad viewports and records every
 * console error, uncaught page error and failed render (error-boundary text).
 * Read-only: uses the same fake Clerk + fake API harness as the store
 * screenshots, so no real account or service is involved.
 *
 *   node scripts/crash-ipad-crawl.mjs --skip-build
 *   node scripts/crash-ipad-crawl.mjs --skip-build --sizes iphone15,ipad-air --only buyer
 *
 * Output: scratch/crash-crawl/report.json (+ screenshots with --shots).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const SIZES = [
  { id: 'iphone15', width: 393, height: 852 },
  { id: 'iphone-max', width: 430, height: 932 },
  { id: 'ipad-air', width: 820, height: 1180 },
  { id: 'ipad-pro', width: 1024, height: 1366 },
  { id: 'ipad-air-land', width: 1180, height: 820 },
];

const BUYER = [
  '/(buyer)', '/discover', '/buyer-search', '/(buyer)/inbox', '/(buyer)/friends', '/(buyer)/profile', '/cart',
  '/buyer-checkout?source=cart', '/buyer-product-detail?productId=prod_nl_jacket_rust', '/(buyer)/orders',
  '/buyer-saved', '/buyer-archive', '/buyer-notifications', '/buyer-settings', '/buyer-addresses',
  '/buyer-payment-methods', '/buyer-problem-report', '/buyer-report', '/buyer-blocked', '/delete-account',
  '/help', '/privacy', '/terms', '/thread-explainer', '/plans', '/buyer-live', '/buyer-story-viewer',
  '/buyer-story-create', '/call-screen', '/share-profile', '/buyer-qr-code',
];
const SELLER = [
  '/(tabs)', '/(tabs)/studio', '/(tabs)/products', '/(tabs)/orders', '/(tabs)/analytics', '/(tabs)/marketing',
  '/(tabs)/profile', '/seller-settings', '/manufacturer-hub', '/create-post', '/camera-capture', '/design',
  '/design-canvas', '/ai-studio', '/store-builder', '/store-preview', '/product-editor', '/add-product',
  '/inventory', '/finance', '/payouts', '/seller-inbox', '/seller-go-live', '/seller-live',
  '/seller-verification', '/subscription', '/billing', '/share-store', '/post-analytics', '/app-theme',
];
const SIGNED_OUT = ['/', '/sign-in', '/onboarding', '/forgot-password', '/account-type', '/privacy', '/terms', '/help', '/splash'];

const IGNORABLE = [/Failed to load resource/i, /net::ERR/i, /NOT_SEEDED/i, /favicon/i, /the server responded with a status of 404/i];

function parse(argv) {
  const o = { skipBuild: false, sizes: null, only: null, shots: false, out: 'report.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--skip-build') o.skipBuild = true;
    else if (argv[i] === '--sizes') o.sizes = argv[++i].split(',');
    else if (argv[i] === '--only') o.only = argv[++i].split(',');
    else if (argv[i] === '--shots') o.shots = true;
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

async function visit(browser, origin, size, role, route, shotsDir) {
  const device = { viewport: { width: size.width, height: size.height }, scale: 1, isMobile: size.width < 700 };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images: {} });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).split('\n')[0]}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().split('\n')[0];
    if (!IGNORABLE.some((r) => r.test(t))) errors.push(`console: ${t.slice(0, 240)}`);
  });
  try {
    await openScreen(page, activity, origin, role, route);
    await waitForQuietNetwork(activity, 600, 8000).catch(() => {});
    await page.waitForTimeout(900);
    const boundary = await page.evaluate(() => /Something went wrong|Unexpected error|Application error/i.test(document.body.innerText));
    if (boundary) errors.push('render: error-boundary text visible');
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflowX > 2) errors.push(`layout: horizontal page overflow ${overflowX}px`);
    const clipped = await page.evaluate(() => {
      // Text elements whose content is wider than their box (truncated or
      // overflowing labels). Leaf text nodes only; ignores scroll containers.
      const out = [];
      for (const el of document.querySelectorAll('div, span, p, a, button')) {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        // Only text a user can actually see: on screen, not transparent, not aria-hidden.
        if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
        let hidden = false;
        for (let a = el; a && !hidden; a = a.parentElement) {
          if (a.getAttribute('aria-hidden') === 'true' || parseFloat(getComputedStyle(a).opacity) === 0) hidden = true;
        }
        if (hidden) continue;
        const hOver = el.scrollWidth - el.clientWidth;
        const truncated = cs.textOverflow === 'ellipsis' && hOver > 1;
        const clippedX = hOver > 1 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
        if (truncated || clippedX) out.push(`${el.textContent.trim().slice(0, 40)} (+${hOver}px)`);
      }
      return [...new Set(out)].slice(0, 6);
    });
    for (const c of clipped) errors.push(`text-fit: clipped "${c}"`);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${role}-${size.id}-${route.replace(/[^a-z0-9]+/gi, '_')}.png`) });
  } catch (e) {
    errors.push(`navigation: ${String(e.message).split('\n')[0]}`);
  } finally {
    await context.close();
  }
  return errors;
}

async function visitSignedOut(browser, origin, size, route) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.width < 700, colorScheme: 'dark' });
  await context.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).split('\n')[0]}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().split('\n')[0];
    if (!IGNORABLE.some((r) => r.test(t))) errors.push(`console: ${t.slice(0, 240)}`);
  });
  try {
    await page.goto(`${origin}${route}`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2500);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflowX > 2) errors.push(`layout: horizontal page overflow ${overflowX}px`);
  } catch (e) {
    errors.push(`navigation: ${String(e.message).split('\n')[0]}`);
  } finally {
    await context.close();
  }
  return errors;
}

const o = parse(process.argv.slice(2));
if (!o.skipBuild || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
const outDir = path.join(MOBILE_ROOT, 'scratch', 'crash-crawl');
mkdirSync(outDir, { recursive: true });
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const sizes = SIZES.filter((s) => !o.sizes || o.sizes.includes(s.id));
const plan = [
  ['signed-out', SIGNED_OUT], ['buyer', BUYER], ['seller', SELLER],
].filter(([r]) => !o.only || o.only.includes(r));
const report = [];
try {
  for (const size of sizes) {
    for (const [role, routes] of plan) {
      for (const route of routes) {
        const errors = role === 'signed-out'
          ? await visitSignedOut(browser, server.origin, size, route)
          : await visit(browser, server.origin, size, role, route, o.shots ? outDir : null);
        report.push({ size: size.id, role, route, errors });
        console.log(`${errors.length ? 'x' : '.'} ${size.id.padEnd(14)} ${role.padEnd(10)} ${route}${errors.length ? `\n    ${errors.slice(0, 3).join('\n    ')}` : ''}`);
      }
    }
  }
} finally {
  await browser.close();
  server.close();
  writeFileSync(path.join(outDir, o.out), JSON.stringify(report, null, 2));
}
const bad = report.filter((r) => r.errors.length);
console.log(`\n${report.length - bad.length}/${report.length} clean; ${bad.length} with errors. Report: scratch/crash-crawl/${o.out}`);
