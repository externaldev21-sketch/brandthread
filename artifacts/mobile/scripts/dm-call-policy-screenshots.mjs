#!/usr/bin/env node
/**
 * DM call policy (Item 5) at 390×844 on the store-screenshots harness:
 *  01 — a message request I sent: voice / video call buttons disabled.
 *  02 — a message request I received: same, above the Accept panel.
 *  03 — a normal chat with someone who blocked me: tapping Voice call shows
 *       the existing call-ended screen with the server's BLOCKED copy.
 * The fake API answers with exactly what api-server returns
 * (conversation view, 403 { code } from POST /api/call/dm/calls).
 *
 *   node scripts/dm-call-policy-screenshots.mjs [buildDir] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2] ?? DEFAULT_BUILD_DIR);
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/dm-call-policy'));
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const API = 'https://api.brandthread.test';
const NOW = DEMO_NOW;

const OTHER = { userId: 'user_ava', name: 'Ava Stone', handle: '@avastone', initials: 'AS', color: '#3A3A40', accountType: 'buyer' };
const ME = { userId: BUYER_USER.id, name: 'Jordan Reyes', handle: '@jordanreyes', initials: 'JR', color: '#2B2B30', accountType: 'buyer' };

const CONVS = {
  'aaaaaaaa-0000-4000-8000-0000000000a1': { isRequest: true, requestedBy: ME.userId, from: ME, text: 'Hey! Love your last fit — where’s the jacket from?' },
  'aaaaaaaa-0000-4000-8000-0000000000a2': { isRequest: true, requestedBy: OTHER.userId, from: OTHER, text: 'Hi Jordan, are you selling the cargo pants?' },
  'aaaaaaaa-0000-4000-8000-0000000000a3': { isRequest: false, requestedBy: null, from: OTHER, text: 'See you Saturday' },
};

function conversationJson(id, now) {
  const c = CONVS[id];
  return {
    id, type: 'buyer_to_buyer', participants: [OTHER, ME],
    isRequest: c.isRequest, requestedBy: c.requestedBy ?? undefined,
    lastMessage: c.text, lastMessageTs: now - 6 * 60e3, unreadCount: 0,
    isFriendshipActive: true, isArchived: false, disappearingEnabled: false,
    updatedAt: new Date(now - 6 * 60e3).toISOString(),
  };
}
function messagesJson(id, now) {
  const c = CONVS[id];
  return [{
    id: `m-${id.slice(-2)}`, conversationId: id, fromId: c.from.userId, fromName: c.from.name, fromInitials: c.from.initials,
    fromColor: c.from.color, text: c.text, attachments: [], reactions: [], status: 'delivered', ts: now - 6 * 60e3, deletedForMe: false,
  }];
}

async function run() {
  const server = await serveBuild(BUILD);
  const ORIGIN = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const results = {};

  for (const [name, id, tapCall] of [
    ['01-request-sent-call-disabled', 'aaaaaaaa-0000-4000-8000-0000000000a1', false],
    ['02-request-received-call-disabled', 'aaaaaaaa-0000-4000-8000-0000000000a2', false],
    ['03-blocked-call-refused', 'aaaaaaaa-0000-4000-8000-0000000000a3', true],
  ]) {
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
    const createCalls = [];
    await context.route(`${API}/**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fallback();
      const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
      if (process.env.DEBUG_API) console.log('   api', request.method(), p);
      const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' };
      const json = (status, body) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
      let m;
      if ((m = p.match(/^\/api\/conversations\/([0-9a-f-]{36})$/)) && CONVS[m[1]]) return json(200, conversationJson(m[1], NOW));
      if ((m = p.match(/^\/api\/conversations\/([0-9a-f-]{36})\/messages$/)) && CONVS[m[1]]) return json(200, messagesJson(m[1], NOW));
      if (p.startsWith('/api/call/dm/conversations/')) return json(200, { calls: [] });
      if (p === '/api/call/dm/incoming') return json(200, { call: null });
      if (p === '/api/call/availability') return json(200, { configured: true, provider: 'agora' });
      if (p === '/api/call/dm/calls' && request.method() === 'POST') {
        createCalls.push(JSON.parse(request.postData() ?? '{}'));
        return json(403, { error: 'You can\'t call this person', code: 'BLOCKED' });
      }
      return route.fallback();
    });
    page.setDefaultNavigationTimeout(240_000);
    await openScreen(page, activity, ORIGIN, 'buyer', `/buyer-conversation?id=${id}`);
    // The app remounts its navigation once after the demo sign-in settles;
    // re-push the target until the chat is up (same as the cart script).
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await page.locator('[data-testid="conversation-call-voice"]').waitFor({ timeout: 10_000 });
        break;
      } catch (error) {
        if (attempt === 5) {
          await page.screenshot({ path: path.join(OUT, `debug-${name}.png`) });
          throw error;
        }
        await page.evaluate((url) => {
          history.pushState(history.state, '', url);
          dispatchEvent(new PopStateEvent('popstate'));
        }, `/buyer-conversation?id=${id}&bt_preview=buyer`);
      }
    }
    await waitForQuietNetwork(activity, 900, 20_000);
    await page.waitForTimeout(1200);
    const voice = page.locator('[data-testid="conversation-call-voice"]');
    const state = await voice.evaluate((el) => ({
      ariaDisabled: el.getAttribute('aria-disabled'),
      opacity: getComputedStyle(el.firstElementChild ?? el).opacity,
    }));
    if (tapCall) {
      await voice.click();
      await page.getByText('You can’t call this person.').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);
    } else {
      await voice.click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    results[name] = { ...state, createCallRequests: createCalls.length };
    console.log(`  ✓ ${name}`, JSON.stringify(results[name]));
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
