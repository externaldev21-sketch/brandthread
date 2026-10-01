#!/usr/bin/env node
/**
 * Disputes / chargebacks screenshots at 393x852 on the production web build
 * (store-screenshots harness, signed-in demo seller). The fake API speaks the
 * real shapes of routes/disputes.ts (list, get, timeline, evidence/upload).
 *
 *   node scripts/disputes-screenshots.mjs [--skip-build] [--label after|before] [--build-dir <dir>]
 *
 * Output: docs/pr-assets/disputes/
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const LABEL = arg('--label', 'after');
const BUILD_DIR = arg('--build-dir', DEFAULT_BUILD_DIR);
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/disputes');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DAY = 86_400_000;
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();

const row = (id, status, extra = {}) => ({
  id, stripeDisputeId: `dp_${id}`, orderId: `order-${id}`, orderNumber: extra.orderNumber, sellerId: 'seller',
  amount: extra.amount, amountCents: Math.round(extra.amount * 100), currency: 'usd', reason: extra.reason, status,
  customerClaim: extra.claim ?? 'Customer claims the product was not received.',
  evidenceDeadline: extra.due ?? null, evidence: [], stripeEvidenceDetails: {},
  evidenceSubmittedAt: extra.submittedAt ?? null, isChargeRefundable: true, networkReasonCode: null,
  createdAt: iso(now - (extra.age ?? 3) * DAY), updatedAt: iso(now - DAY),
  order: { id: `order-${id}`, orderNumber: extra.orderNumber, totalCents: Math.round(extra.amount * 100), trackingNumber: '1Z999AA10123456784', carrier: 'UPS', createdAt: iso(now - 10 * DAY) },
  evidenceFiles: extra.files ?? [],
});
const FILE_A = { id: 'f1', evidenceType: 'receipt', fileName: 'receipt-1042.pdf', contentType: 'application/pdf', sizeBytes: 184_320, uploadedAt: iso(now - DAY) };
const FILE_B = { id: 'f2', evidenceType: 'shipping_documentation', fileName: 'ups-delivery-confirmation.png', contentType: 'image/png', sizeBytes: 912_000, uploadedAt: iso(now - DAY) };

const disputes = [
  row('d-needs', 'needs_response', { orderNumber: '#BT-1042', amount: 148, reason: 'product_not_received', due: iso(now + 6 * DAY), age: 2, files: [FILE_A] }),
  row('d-review', 'under_review', { orderNumber: '#BT-1017', amount: 62, reason: 'fraudulent', due: iso(now - 4 * DAY), submittedAt: iso(now - 5 * DAY), age: 12, claim: 'Customer reports this as an unauthorized charge.', files: [FILE_A, FILE_B] }),
  row('d-won', 'won', { orderNumber: '#BT-0988', amount: 89, reason: 'product_unacceptable', submittedAt: iso(now - 30 * DAY), age: 40, claim: 'Customer claims the product was defective or not as described.', files: [FILE_A] }),
  row('d-lost', 'lost', { orderNumber: '#BT-0961', amount: 210, reason: 'general', age: 60, claim: 'Customer filed a general dispute.' }),
  row('d-soon', 'needs_response', { orderNumber: '#BT-1050', amount: 35, reason: 'duplicate', due: iso(now + 1 * DAY), age: 13, claim: 'Customer claims this is a duplicate charge.' }),
];

const steps = (d) => {
  const final = ['won', 'lost', 'closed'].includes(d.status);
  const submitted = !!d.evidenceSubmittedAt || d.status === 'under_review';
  const dueDetail = d.evidenceDeadline ? `Due ${new Date(d.evidenceDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : null;
  return [
    { key: 'opened', label: 'Dispute opened', state: 'done', at: d.createdAt, detail: null },
    { key: 'evidence_due', label: 'Evidence due', state: submitted ? 'done' : final ? 'skipped' : 'current', at: d.evidenceDeadline, detail: dueDetail },
    { key: 'submitted', label: 'Evidence submitted', state: submitted ? 'done' : final ? 'skipped' : 'upcoming', at: d.evidenceSubmittedAt, detail: null },
    { key: 'under_review', label: 'Under review', state: d.status === 'under_review' ? 'current' : submitted && final ? 'done' : final ? 'skipped' : 'upcoming', at: null, detail: null },
    { key: 'outcome', label: d.status === 'won' ? 'Won' : d.status === 'lost' ? 'Lost' : 'Outcome', state: final ? 'done' : 'upcoming', at: final ? iso(now - DAY) : null, detail: null },
  ];
};

const state = { uploads: [], calls: [] };

async function installApi(context) {
  const norm = (p) => p.replace(/^\/api\/v1\//, '/api/');
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(new URL(req.url()).pathname);
    const m = req.method();
    if (p.startsWith('/api/disputes')) state.calls.push(`${m} ${p}${new URL(req.url()).search}`);
    if (p === '/api/disputes' && m === 'GET') return json(disputes);
    const up = p.match(/^\/api\/disputes\/([^/]+)\/evidence\/upload$/);
    if (up && m === 'POST') {
      const d = disputes.find((x) => x.id === up[1]);
      const q = new URL(req.url()).searchParams;
      const file = {
        id: `f${d.evidenceFiles.length + 10}`, evidenceType: q.get('type'), fileName: q.get('filename') ?? 'photo.jpg',
        contentType: req.headers()['content-type'], sizeBytes: (req.postDataBuffer() ?? Buffer.alloc(0)).length, uploadedAt: iso(now),
      };
      d.evidenceFiles = [...d.evidenceFiles.filter((f) => f.evidenceType !== file.evidenceType), file];
      state.uploads.push(file);
      return json({ file }, 201);
    }
    const tl = p.match(/^\/api\/disputes\/([^/]+)\/timeline$/);
    if (tl) {
      const d = disputes.find((x) => x.id === tl[1]);
      return d ? json({ status: d.status, evidenceDeadline: d.evidenceDeadline, steps: steps(d), events: [], stripe: null }) : json({ error: 'not found' }, 404);
    }
    const one = p.match(/^\/api\/disputes\/([^/]+)$/);
    if (one && m === 'GET') {
      const d = disputes.find((x) => x.id === one[1]);
      return d ? json(d) : json({ error: 'Dispute not found' }, 404);
    }
    return route.fallback();
  });
}

async function open(browser, images, origin, target, ready) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await installApi(context);
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 600)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 700)));
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'seller', target);
    try { await ready(page).waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) { await page.screenshot({ path: path.join(WORK_DIR, 'disputes-debug.png') }); console.log((await page.locator('body').innerText()).slice(0, 600), state.calls); throw e; } }
  }
  await waitForQuietNetwork(activity).catch(() => {});
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(800);
  return { context, page };
}

const violations = [];

/** Text-fit and alignment check: flags clipped/ellipsised text and anything spilling out of its parent or the viewport. */
async function fitCheck(page, name) {
  const found = await page.evaluate(() => {
    const out = [];
    const hScroll = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) return true; } return false; };
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      if (/^[\uE000-\uF8FF\s]+$/.test(el.textContent || '')) continue; // icon-font glyphs
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight * 4) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const label = (el.textContent || '').trim().slice(0, 40);
      const range = document.createRange(); range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      const why = [];
      if (el.scrollWidth > el.clientWidth + 1) why.push(`scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      if (cs.textOverflow === 'ellipsis' && t.width > r.width + 1) why.push('ellipsised');
      if (t.right > r.right + 1 || t.left < r.left - 1) why.push('text spills out of its own box');
      const p = el.parentElement;
      if (p) { const pr = p.getBoundingClientRect(); if (!hScroll(el) && (r.right > pr.right + 1 || r.left < pr.left - 1) && getComputedStyle(p).overflowX === 'visible' && pr.width > 0) why.push('spills out of parent'); }
      if (!hScroll(el) && (r.right > innerWidth + 1 || r.left < -1)) why.push('outside viewport');
      const fs = parseFloat(cs.fontSize); if (fs < 11) why.push(`font ${fs}px`);
      if (why.length) out.push(`${label} :: ${why.join('; ')}`);
    }
    return out;
  });
  for (const f of found) violations.push(`${name}: ${f}`);
  if (found.length) console.log(`  FIT ${name}:`, found);
}

async function zoom(page, testId, name) {
  const loc = page.getByTestId(testId).first();
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await loc.screenshot({ path: path.join(OUT, `zoom-${name}.png`), animations: 'disabled' });
  console.log(`  ok zoom-${name}`);
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await fitCheck(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ok ${name}`);
}

async function scrollTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(BUILD_DIR, 'index.html'))) buildPreviewWeb(BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD_DIR);
  const origin = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const photoDir = path.join(WORK_DIR, 'demo-images');
  const photo = path.join(photoDir, readdirSync(photoDir).find((f) => f.endsWith('.jpg')));
  try {
    if (LABEL === 'before') {
      for (const id of ['d-needs', 'd-review']) {
        const { context, page } = await open(browser, images, origin, `/dispute-detail?disputeId=${id}`, (p) => p.getByText('Customer Claim').first());
        await shot(page, `before-dispute-detail-${id}`);
        await context.close();
      }
      return;
    }

    // List
    {
      const { context, page } = await open(browser, images, origin, '/disputes', (p) => p.getByTestId('dispute-row-d-needs'));
      await shot(page, 'list-open');
      await page.getByRole('tab', { name: 'Closed' }).click();
      await page.getByTestId('dispute-row-d-won').waitFor();
      await shot(page, 'list-closed');
      await context.close();
    }

    // Detail per status: top (timeline) of each
    for (const [id, name] of [['d-needs', 'needs-response'], ['d-soon', 'needs-response-due-tomorrow'], ['d-review', 'under-review'], ['d-won', 'won'], ['d-lost', 'lost']]) {
      const { context, page } = await open(browser, images, origin, `/dispute-detail?disputeId=${id}`, (p) => p.getByTestId('dispute-step-outcome'));
      await shot(page, `detail-${name}`);
      if (id === 'd-needs') await zoom(page, 'dispute-timeline-card', 'timeline-card');
      if (id === 'd-needs') {
        await page.getByText('Add Note').first().scrollIntoViewIfNeeded();
        await page.evaluate(() => { for (const d of document.querySelectorAll('div')) if (d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible') d.scrollTop = d.scrollHeight; });
        await page.waitForTimeout(400);
        await shot(page, 'detail-needs-response-bottom');
      }
      await context.close();
    }

    // Evidence section: needs response, then upload a photo
    {
      const { context, page } = await open(browser, images, origin, '/dispute-detail?disputeId=d-needs', (p) => p.getByText('Evidence files'));
      await scrollTo(page, page.getByText('Add a file'));
      await shot(page, 'evidence-section');
      await zoom(page, 'dispute-files-card', 'files-card');
      await zoom(page, 'dispute-add-file-card', 'add-file-card');
      await zoom(page, 'dispute-file-actions', 'file-buttons');
      await zoom(page, 'dispute-file-chips', 'file-type-chips');
      await page.getByRole('button', { name: 'Shipping proof' }).click();
      const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
      await page.getByText('Photo', { exact: true }).click();
      await (await chooser).setFiles(photo);
      await page.getByTestId('dispute-file-f11').waitFor({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await scrollTo(page, page.getByText('Add a file'));
      await shot(page, 'evidence-after-upload');
      console.log('  uploads:', JSON.stringify(state.uploads), state.calls.filter((c) => c.includes('upload')));
      await context.close();
    }
    // Locked evidence section (under review)
    {
      const { context, page } = await open(browser, images, origin, '/dispute-detail?disputeId=d-review', (p) => p.getByText('Evidence files'));
      await scrollTo(page, page.getByText('Evidence files'));
      await shot(page, 'evidence-locked-under-review');
      await context.close();
    }
    // Entry row in Finance
    {
      const { context, page } = await open(browser, images, origin, '/finance', (p) => p.getByText('Chargebacks').first());
      await scrollTo(page, page.getByText('Chargebacks').first());
      await shot(page, 'finance-entry-row');
      await page.getByText('Chargebacks').first().click();
      await page.getByTestId('dispute-row-d-needs').waitFor();
      await zoom(page, 'dispute-row-d-needs', 'list-row');
      await context.close();
    }
    if (violations.length) {
      console.log(`\nFIT VIOLATIONS (${violations.length}):\n${violations.join('\n')}`);
      process.exitCode = 1;
    } else console.log('\nFit check: no violations');
  } finally {
    await browser.close();
    await server.close?.();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
