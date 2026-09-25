import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { clerkStubScript } from './clerk-stub.mjs';
import { BUYER_USER } from './demo-data.mjs';

const MOBILE_ROOT = '/home/user/brandthread/.claude/worktrees/agent-a9e6af4e4833e07b7/artifacts/mobile';
const PORT = process.env.CAP_PORT || '8098';
const OUT_PREFIX = process.argv[2] || 'after';
const OUT_DIR = process.argv[3] || '/tmp/claude-0/-home-user-brandthread/c32b3280-fb04-510b-894d-40f7dea89c93/scratchpad/shots';

const DEMO_CLERK_KEY = `pk_test_${Buffer.from('clerk.brandthread.test$').toString('base64')}`;

async function waitForServer(url, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200) return;
    } catch {}
    if (Date.now() > deadline) throw new Error('dev server did not come up in time');
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function main() {
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
  console.log('Starting expo web dev server on port', PORT);
  const child = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--port', PORT, '--non-interactive'], {
    cwd: MOBILE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => process.stdout.write(`[expo] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[expo!] ${d}`));

  try {
    await waitForServer(`http://127.0.0.1:${PORT}`);
    console.log('Server up. Launching browser…');
    const browser = await chromium.launch();

    const sizes = [
      { name: '390x844', width: 390, height: 844 },
      { name: '1440x900', width: 1440, height: 900 },
    ];

    for (const size of sizes) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      });
      await context.addInitScript(clerkStubScript(BUYER_USER));
      await context.addInitScript(() => {
        try {
          localStorage.setItem('bt:cookie-consent', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false }));
          localStorage.setItem('feed_gesture_guide_seen:anon', '1');
          localStorage.setItem('feed_gesture_guide_seen:user_jordan', '1');
        } catch {}
      });
      // Abort all real network except localhost, so nothing hangs on a real backend.
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
        if (url.hostname.endsWith('.brandthread.test')) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/(buyer)?bt_preview=buyer`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 30000 }).catch(() => {});
      // Give the video players time to mount + first frame / poster to paint.
      await page.waitForTimeout(3000);
      // Dismiss the cookie banner / first-time gesture guide if either still
      // slipped through the localStorage seed above.
      const guide = page.getByText('Watching Threads', { exact: true });
      if (await guide.count() > 0) {
        await page.mouse.click(size.width / 2, size.height / 2).catch(() => {});
        await page.waitForTimeout(500);
      }
      const acceptAll = page.getByText('Accept all', { exact: true });
      if (await acceptAll.count() > 0) await acceptAll.first().click().catch(() => {});
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT_DIR, `${OUT_PREFIX}-${size.name}.png`) });
      // Cropped bottom ~200px view for the 390x844 shot specifically.
      if (size.name === '390x844') {
        await page.screenshot({
          path: path.join(OUT_DIR, `${OUT_PREFIX}-${size.name}-bottom200.png`),
          clip: { x: 0, y: size.height - 200, width: size.width, height: 200 },
        });
      }
      await context.close();
      console.log(`Captured ${OUT_PREFIX} ${size.name}`);
    }

    await browser.close();
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
