/**
 * Before/after captures for the feed + sheets polish pass at 390x844 on the
 * `demo=1` web preview (no API: every /api/ call answers `{}`).
 *   node e2e/polish-feed-sheets-shots.mjs <outDir> <prefix> [scenario...]
 * Scenarios: home following search comments share carousel signedout-like
 */
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'docs/screenshots/polish-feed-sheets';
const prefix = process.argv[3] ?? 'after';
const only = process.argv.slice(4);
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8081';
const W = 390;
const H = 844;

const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function open(query = 'bt_preview=buyer&demo=1', path = '/', routes = null, setup = null) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  if (setup) await setup(page);
  await page.route(/\/api\//, (route) => {
    const hit = routes && Object.entries(routes).find(([frag]) => route.request().url().includes(frag));
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
      body: route.request().method() === 'OPTIONS' ? '' : JSON.stringify(hit ? hit[1] : {}),
    });
  });
  await page.goto(`${base}${path}?${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.addStyleTag({ content: '#error-overlay,#error-toast{display:none!important}' }).catch(() => {});
  await page.waitForTimeout(12000);
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2500 }).catch(() => {});
  const guide = page.getByTestId('feed-gesture-guide');
  if (await guide.isVisible().catch(() => false)) { await guide.click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(600); }
  await page.waitForTimeout(1500);
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png` });
  console.log(`${prefix}-${name}.png`);
}

async function nextThread(page, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.mouse.move(W / 2, H / 2);
    await page.mouse.wheel(0, H);
    await page.waitForTimeout(1400);
  }
}

// A real (UUID) post with no comments, viewed signed out: empty state + locked composer.
const EMPTY_POST = '0b6f3c1e-2a4d-4f8e-9c7b-5d1e2f3a4b5c';
const special = {
  'comments-empty': ['bt_preview=buyer&postId=' + EMPTY_POST, '/buyer-post-comments', {
    [`/posts/${EMPTY_POST}/comments`]: { comments: [], hiddenByMutedWords: 0, commentsDisabled: false, canComment: false, isPostOwner: false, nextCursor: null },
  }],
};

// Test-only fixture: three accepted friends in the preview's local social
// store ('anon' user), so the "Send to" people row renders. The signed-out
// preview never calls /api/conversations, so recent chats can't be shown here.
const friend = (userId, name, initials, color) => ({
  id: 'f-' + userId, userId, name, handle: name.toLowerCase().replace(/\s+/g, ''), initials, color,
  status: 'accepted', mutualFriendsCount: 0, updatedAt: '2026-10-17T00:00:00.000Z',
});
const SEEDED_FRIENDS = [friend('u1', 'Maya Chen', 'MC', '#7C5CFF'), friend('u2', 'Toby Nguyen', 'TN', '#E4572E'), friend('u3', 'Ava Thompson', 'AT', '#2E86AB')];
special['share-people'] = ['bt_preview=buyer&demo=1', '/', null, (page) => page.addInitScript((rows) => {
  window.localStorage.setItem('bt:social:anon:friendships:v1', JSON.stringify(rows));
}, SEEDED_FRIENDS)];

const scenarios = {
  async 'comments-empty'(page) { await shot(page, 'comments-empty-signedout'); },
  async home(page) { await shot(page, 'home-header'); },
  async following(page) {
    await page.getByText('Following', { exact: true }).first().click();
    await page.waitForTimeout(20000);
    await shot(page, 'following');
  },
  async search(page) {
    await page.getByRole('button', { name: /^Search/ }).first().click();
    await shot(page, 'search');
  },
  async 'search-focused'(page) {
    await page.getByRole('button', { name: /^Search/ }).first().click();
    await page.waitForTimeout(1500);
    await page.getByTestId('buyer-search-field').click();
    await page.waitForTimeout(600);
    // Outline the Cancel tap target so its size is visible in the capture.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="buyer-search-cancel"]');
      if (el) el.style.outline = '1px dashed #ff3b30';
    });
    await shot(page, 'search-focused');
  },
  async comments(page) {
    await page.getByRole('button', { name: /^Comments/ }).first().click();
    await shot(page, 'comments');
  },
  async share(page) {
    await page.getByRole('button', { name: /^Share/ }).first().click();
    await shot(page, 'share');
  },
  async 'share-people'(page) {
    await page.getByRole('button', { name: /^Share/ }).first().click();
    await shot(page, 'share-people');
  },
  async carousel(page) {
    for (let i = 0; i < 8; i += 1) {
      if (await page.getByTestId('photo-carousel').first().isVisible().catch(() => false)) break;
      await nextThread(page);
    }
    await shot(page, 'carousel');
  },
  async 'signedout-like'(page) {
    await page.getByRole('button', { name: /^Like/ }).first().click();
    await page.waitForTimeout(400);
    await shot(page, 'signedout-like');
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (only.length && !only.includes(name)) continue;
  const { context, page } = await open(...(special[name] ?? []));
  try { await run(page); } catch (e) { console.log(`${name} failed: ${e.message.split('\n')[0]}`); await shot(page, `${name}-error`); }
  await context.close();
}
await browser.close();
