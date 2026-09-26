/**
 * Regression guard: opening the comments sheet on web must never trigger
 * React DOM's "validateDOMNesting(...): <button> cannot appear as a
 * descendant of <button>" warning.
 *
 * That warning showed up because CommentRow used to wrap the whole row
 * (avatar, text, Reply, more-options and like button) in one outer
 * Pressable — react-native-web renders accessibilityRole="button" as a real
 * <button> element, so nesting a Pressable-with-onPress inside another one
 * produced actual invalid nested <button> HTML (and caused the hover/press
 * flicker on the outer row reported separately). The fix restructured
 * CommentRow so the outer long-press area only wraps plain text, and Reply /
 * more / like are sibling Pressables on the meta row below (see
 * app/buyer-post-comments.tsx). This boots the real web dev server, opens
 * the comments sheet, and fails if that warning (or any nested-<button>
 * warning) is logged for this screen.
 *
 * Usage:  node tests/comments-no-dom-nesting.web.mjs
 */
import { spawn } from 'node:child_process';

const PORT = process.env.COMMENTS_DOM_NESTING_PORT || '8172';
const DEMO_CLERK_KEY = `pk_test_${Buffer.from('clerk.brandthread.test$').toString('base64')}`;

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    if (Date.now() > deadline) throw new Error('Expo web dev server did not come up in time');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const { chromium } = await import('playwright');
  const env = {
    ...process.env,
    EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST: '1',
    EXPO_PUBLIC_API_BASE_URL: 'https://api.brandthread.test',
    EXPO_PUBLIC_DOMAIN: 'api.brandthread.test',
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: DEMO_CLERK_KEY,
    EXPO_PUBLIC_CLERK_PROXY_URL: '',
    EXPO_PUBLIC_SENTRY_DSN: '',
    EXPO_PUBLIC_META_PIXEL_ID: '',
    EXPO_PUBLIC_TIKTOK_PIXEL_ID: '',
    CI: '1',
  };
  const child = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--port', PORT], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failed = false;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}`, 180_000);
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    await context.addInitScript((user) => {
      const clerkUser = { id: user.id, primaryEmailAddress: { emailAddress: user.email } };
      const session = { id: 'sess_demo', user: clerkUser, getToken: async () => 'demo-token' };
      window.Clerk = {
        loaded: true, user: clerkUser, session,
        addListener: () => () => {}, load: async () => {},
        signOut: async () => {},
      };
      try {
        localStorage.setItem('bt:cookie-consent', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false }));
      } catch {}
    }, { id: 'user_jordan', email: 'jordan@example.com' });

    const page = await context.newPage();
    // React's actual printed warning (from validateDOMNesting internally,
    // but the string it prints never contains that function's name) reads
    // like "In HTML, <button> cannot be a descendant of <button>." /
    // "<button> cannot contain a nested <button>." — match on that wording,
    // not on the internal function name.
    // Playwright's msg.text() joins console.error's format string and its
    // substitution args with spaces WITHOUT interpolating them — so the
    // phrase and the "button" tag name land as separate tokens in the same
    // message rather than one interpolated sentence. Check both separately.
    const NESTED_DOM_PHRASE_RE = /cannot (?:contain a nested|be a descendant of)/i;
    const domNestingWarnings = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (NESTED_DOM_PHRASE_RE.test(text) && /\bbutton\b/i.test(text)) {
        domNestingWarnings.push(text);
      }
    });
    page.on('pageerror', (err) => {
      if (NESTED_DOM_PHRASE_RE.test(err.message) && /\bbutton\b/i.test(err.message)) domNestingWarnings.push(err.message);
    });

    await page.goto(
      `http://127.0.0.1:${PORT}/buyer-post-comments?postId=preview-fashion-01&postAuthorName=${encodeURIComponent('Studio Nine')}&postType=photo` +
        `&bt_preview=buyer`,
      { waitUntil: 'load', timeout: 60_000 },
    );
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 30_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="comments-sheet"], [aria-label="Close comments"]', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Hover across every row so hover-triggered re-renders (rule 6/9) get a
    // chance to log too, not just the initial mount.
    const rowCount = await page.evaluate(() => document.querySelectorAll('[aria-label^="Comment by"]').length);
    for (let i = 0; i < Math.min(rowCount, 10); i += 1) {
      const el = (await page.$$('[aria-label^="Comment by"]'))[i];
      if (el) await el.hover().catch(() => {});
    }
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'tests/__screenshots__/comments-sheet-390x844.png' }).catch(() => {});

    if (domNestingWarnings.length > 0) {
      throw new Error(
        `validateDOMNesting fired ${domNestingWarnings.length} time(s) on the comments sheet:\n` +
          domNestingWarnings.slice(0, 5).join('\n'),
      );
    }
    console.log('[comments-no-dom-nesting] PASS: no nested-<button> DOM warnings on the comments sheet.');
  } catch (err) {
    failed = true;
    console.error('[comments-no-dom-nesting] FAILED:', err.message);
  } finally {
    child.kill('SIGTERM');
  }
  process.exit(failed ? 1 : 0);
}

main();
