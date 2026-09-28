#!/usr/bin/env node
/**
 * One-off live verification for the Monochrome Avatar Sweep — Part 2 —
 * not part of the store screenshot pipeline. Production web export + a fake
 * API, same pattern as activity-monochrome-verify.mjs / activity-people-
 * verify.mjs.
 *
 * `isPreviewCatalogEnabled()` (lib/previewCatalog.ts) requires `__DEV__`,
 * which `expo export`'s production bundle strips to `false` — so the
 * lib/previewInboxData.ts / lib/previewActivity.ts / buyer-search.tsx
 * PREVIEW_ACCOUNTS fallback paths are dead code in ANY static export, not
 * just this harness's. The disclosed substitute (this sandbox's egress to
 * *.replit.dev is blocked, so the real dev-server preview Dev views is
 * unreachable here) is to feed the fake API the SAME values these seed
 * files actually compute — via `pickAvatarColorReplica`, a byte-for-byte
 * copy of lib/avatarColors.ts's pickAvatarColor algorithm — so this checks
 * the real render pipeline for the exact colors the fixed source files now
 * produce, including the exact "Forme 22" / preview-seller-06 row the
 * orchestrator flagged as still purple (#6D28D9) after PR #296.
 *
 * The data-correctness side (that lib/previewInboxData.ts, previewActivity.ts,
 * searchData.ts and buyer-search.tsx's PREVIEW_ACCOUNTS literally contain no
 * hardcoded colorful hex any more) is separately, and more strongly, checked
 * by lib/__tests__/avatarColors.test.ts (direct import + source inspection).
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/monochrome-avatars-part2-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, SELLER_USER } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/monochrome-avatars-part2'));
mkdirSync(OUT, { recursive: true });

// ── Exact copy of lib/avatarColors.ts (kept byte-for-byte in sync) ─────────
const AVATAR_NEUTRAL_PALETTE = ['#2A2A2E', '#333338', '#3D3D42', '#71717A'];
function pickAvatarColorReplica(seed) {
  if (!seed) return AVATAR_NEUTRAL_PALETTE[2];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_NEUTRAL_PALETTE[Math.abs(hash) % AVATAR_NEUTRAL_PALETTE.length];
}

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();

// Same identities as lib/previewInboxData.ts / lib/previewActivity.ts, with
// colors computed the same way those files now compute theirs.
const FORME22 = { userId: 'preview-seller-06', name: 'Forme 22', initials: 'F2' };
const PEOPLE = [
  { userId: 'preview-seller-01', name: 'Atelier Noire', initials: 'AN' },
  { userId: 'preview-seller-02', name: 'Maison Vela', initials: 'MV' },
  FORME22,
  { userId: 'preview-seller-07', name: 'Astrae', initials: 'AS' },
];

function conversationsPayload() {
  // Deliberately NOT "preview-conversation-*" — that prefix is the app's own
  // reserved dev-preview id namespace (lib/previewInbox.ts's
  // isPreviewConversationId), which short-circuits straight to
  // getPreviewConversation() and skips the network entirely (dead code in
  // this production export, since isPreviewCatalogEnabled() requires
  // __DEV__). Using a plain id here forces the real GET /api/conversations/:id
  // fetch this fake API answers, exercising the real render pipeline.
  return PEOPLE.map((p, i) => ({
    id: `cv-demo-${i + 1}`,
    type: 'buyer_to_seller',
    participants: [
      { userId: p.userId, name: p.name, handle: `@${p.userId}`, initials: p.initials, color: pickAvatarColorReplica(p.userId), accountType: 'seller' },
      { userId: 'demo-buyer', name: 'Jordan Reyes', handle: '@jordanreyes', initials: 'JR', color: pickAvatarColorReplica('demo-buyer'), accountType: 'buyer' },
    ],
    lastMessage: `Hey — thanks for the order!`,
    lastMessageTs: DEMO_NOW - (i + 1) * 40 * MIN,
    unreadCount: i === 0 ? 1 : 0,
    isFriendshipActive: true,
    isArchived: false,
    isRequest: false,
    updatedAt: iso((i + 1) * 40 * MIN),
  }));
}

function notificationsPayload() {
  return PEOPLE.map((p, i) => ({
    id: `preview-notif-${i + 1}`, category: 'social', type: 'new_follower',
    title: `${p.name} started following you`, body: '', isRead: i > 0, isMuted: false,
    actorId: p.userId, actorName: p.name, actorHandle: `@${p.userId}`,
    actorInitials: p.initials, actorColor: pickAvatarColorReplica(p.userId),
    targetId: p.userId, targetType: 'user', createdAt: iso((i + 1) * 30 * MIN),
  }));
}

function searchPeoplePayload() {
  return PEOPLE.map((p) => ({
    userId: p.userId, name: p.name, username: p.userId, handle: `@${p.userId}`,
    initials: p.initials, color: pickAvatarColorReplica(p.userId), bio: null, isFollowing: false,
  }));
}

async function installFakeApi(context, origin) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const OWNED = /^\/api\/(conversations(\/.*)?|buyer\/notifications(\/.*)?|social\/search)$/;
  const owns = (url) => url.origin === 'https://api.brandthread.test' && OWNED.test(norm(url.pathname));
  await context.route(owns, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(url.pathname);
    if (p === '/api/conversations' && req.method() === 'GET') return json(conversationsPayload());
    const convMatch = p.match(/^\/api\/conversations\/([^/]+)$/);
    if (convMatch && req.method() === 'GET') {
      const conv = conversationsPayload().find((c) => c.id === convMatch[1]);
      return conv ? json(conv) : route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
    }
    const msgMatch = p.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (msgMatch && req.method() === 'GET') return json([]);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(notificationsPayload());
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 1 });
    if (p === '/api/social/search') return json(searchPeoplePayload());
    return json({ ok: true });
  });
}

/**
 * Every distinct circular avatar background color visible on screen. Only
 * counts a circle as an "avatar" when its own direct text content is a
 * short (<=3 char) initials string (AN, MV, F2, JR…) — this excludes icon
 * buttons/badges (the money/camera/follow-request circles, the "+" story
 * badge) which are also circular but are UI chrome, not avatars, and use
 * the app's own unrelated theme tokens (e.g. FG '#F7F7FA').
 */
async function avatarColorAudit(page) {
  return page.evaluate((palette) => {
    const offenders = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('div')) {
      const directText = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('');
      if (!directText || directText.length > 3 || !/^[A-Za-z0-9]+$/.test(directText)) continue;
      const style = getComputedStyle(el);
      const bg = style.backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const radius = parseFloat(style.borderRadius);
      const isCircle = radius > 0 && Math.abs(radius - Math.min(rect.width, rect.height) / 2) < 3;
      if (!isCircle) continue;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [r, g, b] = m[1].split(',').map((v) => parseFloat(v));
      const key = `${Math.round(rect.left)},${Math.round(rect.top)},${bg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hex = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
      if (!palette.includes(hex)) offenders.push({ hex, text: directText, rect: { x: Math.round(rect.x), y: Math.round(rect.y) } });
    }
    return offenders;
  }, AVATAR_NEUTRAL_PALETTE);
}

async function run(browser, images, origin) {
  const role = 'buyer';
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await installFakeApi(context, origin);
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const settle = async (ms = 900) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  const results = {};
  results.expectedForme22Color = pickAvatarColorReplica('preview-seller-06');

  // 1. Inbox
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, role, '/(buyer)/inbox');
    try { await page.getByText('Forme 22').first().waitFor({ timeout: 15_000 }); break; } catch (error) {
      if (attempt >= 4) {
        console.error('DEBUG body text:', (await page.locator('body').innerText().catch(() => '<err>')).slice(0, 2000));
        throw error;
      }
    }
  }
  await settle();
  await shot('01-inbox.png');
  results.inbox = await avatarColorAudit(page);

  // 2. Chat header — the exact row the orchestrator flagged.
  await page.getByText('Forme 22').first().click();
  await settle();
  await shot('02-chat-header-forme22.png');
  results.chatHeader = await avatarColorAudit(page);

  // 3. Activity — same-type follow rows merge into "X and N others" groups,
  // so Forme 22's name may not appear directly; wait for the screen itself.
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, role, '/activity-center');
    try { await page.getByText('Atelier Noire').first().waitFor({ timeout: 15_000 }); break; } catch (error) {
      if (attempt >= 4) {
        console.error('DEBUG activity body text:', (await page.locator('body').innerText().catch(() => '<err>')).slice(0, 2000));
        throw error;
      }
    }
  }
  await settle(1200);
  await shot('03-activity.png');
  results.activity = await avatarColorAudit(page);

  // 4. Search → People
  await openScreen(page, activity, origin, role, '/buyer-search');
  await settle();
  await page.getByPlaceholder(/search/i).first().fill('Forme').catch(() => {});
  await settle(1200);
  await shot('04-search-people.png');
  results.search = await avatarColorAudit(page);

  await context.close();
  return results;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const results = await run(browser, images, origin);
    console.log('\n[buyer]', JSON.stringify(results, null, 2));
    const totalOffenders = ['inbox', 'chatHeader', 'activity', 'search'].reduce((n, k) => n + (results[k]?.length ?? 0), 0);
    if (totalOffenders > 0) {
      console.error(`\nFAIL: ${totalOffenders} non-neutral avatar-circle color(s) found.`);
      process.exit(1);
    }
    console.log('\nOK: every circular avatar on screen used a neutral palette color.');
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
