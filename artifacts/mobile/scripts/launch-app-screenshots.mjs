#!/usr/bin/env node
/**
 * Verification shots for BT-372 (AI consent sheet) and BT-374 (signed-out
 * /help Support URL) on the local Expo web preview at 393x852.
 *
 *   expo start --web --port 8193   (placeholder Clerk key, no API)
 *   node scripts/launch-app-screenshots.mjs --port 8193
 *
 * Output: ../../screenshots/revenue-p1/launch-app/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { clerkStubScript } from './store-screenshots/clerk-stub.mjs';
import { SELLER_USER } from './store-screenshots/demo-data.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(ROOT, '../../screenshots/revenue-p1/launch-app');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const ORIGIN = `http://localhost:${arg('port', '8193')}`;

async function dismissOverlay(page) {
  // The placeholder Clerk key cannot load Clerk JS; close the dev error overlay if shown.
  for (let i = 0; i < 3; i++) {
    const btn = page.getByRole('button', { name: /dismiss|close/i }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
  const necessary = page.getByText('Necessary only', { exact: true }).first();
  if (await necessary.isVisible().catch(() => false)) await necessary.click().catch(() => {});
  await page.waitForTimeout(500);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark',
  });
  // Signed-out Clerk stand-in (the stub's demo session removed), so the
  // placeholder key does not raise Clerk's dev error toast over the screen.
  await ctx.addInitScript(clerkStubScript(SELLER_USER));
  await ctx.addInitScript(() => {
    const c = window.Clerk;
    const client = { id: 'client_demo', sessions: [], activeSessions: [], lastActiveSessionId: null, signIn: {}, signUp: {} };
    const empty = { client, session: null, user: null, organization: null };
    c.session = null; c.user = null; c.client = client;
    c.__internal_lastEmittedResources = empty;
    c.addListener = (listener) => { listener(empty); return () => undefined; };
  });
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on('request', (r) => { if (/\/api\//.test(r.url())) apiCalls.push(`${r.method()} ${r.url()}`); });

  // BT-374: signed out, straight to the Support URL.
  await page.goto(`${ORIGIN}/help`, { waitUntil: 'load', timeout: 590000 });
  await page.waitForTimeout(15000);
  await dismissOverlay(page);
  console.log('help url after load:', page.url());
  await page.screenshot({ path: path.join(OUT, 'help-signed-out-top.png') });
  await page.getByText('Email support@brandthread.app').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'help-signed-out-contact.png') });
  console.log('api calls on signed-out /help:', JSON.stringify(apiCalls));

  // BT-372: agent conversation (seeded preview thread, ?bt_preview=buyer, no
  // backend); the first send shows the consent sheet.
  const page2 = await ctx.newPage(); // same signed-out Clerk stand-in
  page2.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.close();
  const pageRef = page2;
  await pageRef.goto(`${ORIGIN}/buyer-conversation?id=preview-conversation-brandthread&bt_preview=buyer&demo=1`, { waitUntil: 'load', timeout: 590000 });
  await pageRef.waitForTimeout(14000); // seeded welcome types in first
  try { await pageRef.getByText('Necessary only', { exact: true }).first().click({ timeout: 1500 }); } catch { /* none */ }
  const input = pageRef.locator('textarea, input[type="text"]').last();
  await input.click();
  await input.fill('what is thread cash');
  await pageRef.waitForTimeout(400);
  await pageRef.keyboard.press('Enter');
  await pageRef.waitForTimeout(800);
  if (!(await pageRef.getByTestId('ai-consent-sheet').isVisible().catch(() => false))) {
    await pageRef.getByLabel(/send/i).last().click().catch(() => {});
    await pageRef.waitForTimeout(800);
  }
  await pageRef.waitForTimeout(800);
  await pageRef.screenshot({ path: path.join(OUT, 'agent-consent-sheet.png') });
  console.log('sheet visible:', await pageRef.getByTestId('ai-consent-sheet').isVisible().catch(() => false));
  // Not now keeps the draft and sends nothing; Allow then sends it.
  await pageRef.getByTestId('ai-consent-not-now').click();
  await pageRef.waitForTimeout(800);
  console.log('draft kept after Not now:', await input.inputValue());
  await pageRef.screenshot({ path: path.join(OUT, 'agent-after-not-now.png') });
  await pageRef.getByLabel(/send/i).last().click().catch(() => {});
  await pageRef.waitForTimeout(800);
  await pageRef.getByTestId('ai-consent-allow').click();
  await pageRef.waitForTimeout(3500);
  await pageRef.screenshot({ path: path.join(OUT, 'agent-after-allow.png') });
  await browser.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
