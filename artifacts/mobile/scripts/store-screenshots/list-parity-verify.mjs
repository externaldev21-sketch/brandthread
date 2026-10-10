#!/usr/bin/env node
/**
 * Before/after parity check for screens whose list was converted from
 * ScrollView + map to FlatList (Content, Seller reviews) at 393x852.
 * Builds come from buildPreviewWeb() (see harness.mjs).
 *
 *   node scripts/store-screenshots/list-parity-verify.mjs --before <dir> --after <dir> --out <dir>
 *
 * For a short list and a long list (60 rows) it captures the top of each
 * screen and the screen after scrolling 700 px in both builds, reports
 * whether the PNGs (above the floating tab bar) are byte-identical, and how
 * many DOM nodes stay mounted.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEVICES } from './devices.mjs';
import { DEMO_NOW, respond } from './demo-data.mjs';
import { launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

function args() {
  const o = { before: null, after: null, out: null };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--before') o.before = path.resolve(a[++i]);
    else if (a[i] === '--after') o.after = path.resolve(a[++i]);
    else if (a[i] === '--out') o.out = path.resolve(a[++i]);
  }
  if (!o.before || !o.after || !o.out) throw new Error('Pass --before, --after and --out.');
  return o;
}

const DEVICE = { ...DEVICES.find((d) => d.id === 'iphone-6.9in'), viewport: { width: 393, height: 852 }, scale: 2 };
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const iso = (hoursAgo) => new Date(DEMO_NOW - hoursAgo * 3_600_000).toISOString();

function contentRows(count) {
  const base = respond({ method: 'GET', path: '/posts/mine', query: new URLSearchParams(), role: 'seller', options: {} }) ?? [];
  return Array.from({ length: count }, (_, i) => {
    const src = base[i % base.length];
    return { ...src, id: `${src.id}-copy-${i}`, caption: `${src.caption ?? 'Post'} (${i + 1})`, createdAt: iso(i + 1) };
  });
}

function reviewRows(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `rev-${i}`,
    buyer_id: `buyer-${i}`,
    seller_id: 'seller',
    rating: 3 + (i % 3),
    body: `Reviewer note ${i + 1}: fits well and ships fast.`,
    created_at: iso((i + 1) * 20),
    product_name: 'Heavyweight Hoodie',
    buyer_name: `Reviewer ${i + 1}`,
    seller_reply: i % 4 === 0 ? 'Thank you for the kind words.' : undefined,
    seller_replied_at: i % 4 === 0 ? iso(i * 20) : undefined,
  }));
}

const SCENARIOS = [
  { id: 'content', path: '/content', ready: ['Content library', 'Drop 04 is live'], endpoint: '**/posts/mine*', rows: contentRows, short: 2 },
  { id: 'seller-reviews', path: '/seller-reviews', ready: ['Reviewer note 1'], endpoint: '**/reviews/mine*', rows: reviewRows, short: 3 },
];

async function capture(browser, origin, scenario, count, label, out) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
  try {
    const rows = scenario.rows(count);
    await context.route(scenario.endpoint, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify(rows),
    }));
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, 'seller', scenario.path);
      try {
        await page.waitForFunction((needles) => needles.every((text) => document.body.innerText.includes(text)), scenario.ready, { timeout: 20_000 });
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
      }
    }
    await waitForQuietNetwork(activity, 800, 10_000);
    await page.waitForTimeout(600);
    // Parity is judged on everything above the floating tab bar: the bar's own
    // animated logo glyph differs between any two captures of the same build.
    const content = { x: 0, y: 0, width: 393, height: 760 };
    const top = await page.screenshot({ clip: content });
    writeFileSync(path.join(out, `${scenario.id}-${label}-${count}-top.png`), await page.screenshot());
    await page.mouse.move(196, 600);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(600);
    const scrolled = await page.screenshot({ clip: content });
    writeFileSync(path.join(out, `${scenario.id}-${label}-${count}-scrolled.png`), await page.screenshot());
    const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
    return { top: sha(top), scrolled: sha(scrolled), dom, scrolledDiffersFromTop: sha(top) !== sha(scrolled) };
  } finally {
    await context.close();
  }
}

const o = args();
mkdirSync(o.out, { recursive: true });
const browser = await launchBrowser();
const results = {};
try {
  for (const [label, dir] of [['before', o.before], ['after', o.after]]) {
    const server = await serveBuild(dir);
    try {
      results[label] = {};
      for (const scenario of SCENARIOS) {
        for (const count of [scenario.short, 60]) {
          results[label][`${scenario.id}:${count}`] = await capture(browser, server.origin, scenario, count, label, o.out);
        }
      }
    } finally {
      server.close();
    }
  }
} finally {
  await browser.close();
}
let failed = false;
for (const key of Object.keys(results.before)) {
  const b = results.before[key];
  const a = results.after[key];
  if (b.top !== a.top || b.scrolled !== a.scrolled) failed = true;
  console.log(`${key}: top ${b.top === a.top ? 'IDENTICAL' : 'DIFFERENT'}, scrolled ${b.scrolled === a.scrolled ? 'IDENTICAL' : 'DIFFERENT'} (scroll moved the screen: ${a.scrolledDiffersFromTop}), DOM nodes ${b.dom} -> ${a.dom}`);
}
process.exit(failed ? 1 : 0);
