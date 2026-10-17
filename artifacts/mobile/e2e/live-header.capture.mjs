// Captures the buyer Threads Home header at 390x844 (2x) for the LIVE-in-header
// PR: Threads / Following / LIVE active, plus a bright video post for the top
// fade. Run against `expo start --web --port 8081`:
//   CLERK_STUB=<clerkStubScript() output> node e2e/live-header.capture.mjs <outDir> <prefix>
// The `demo=1` preview is the seeded fashion feed (dev preview only).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'docs/screenshots/live-header';
const prefix = process.argv[3] ?? 'after';
const demo = process.env.DEMO === '0' ? '' : '&demo=1';
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://localhost:8081';
const HEADER = { x: 0, y: 0, width: 390, height: 150 };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
if (process.env.CLERK_STUB) await page.addInitScript({ path: process.env.CLERK_STUB });

async function open() {
  await page.goto(`${BASE}/?bt_preview=buyer${demo}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.getByTestId('buyer-home-tabs').waitFor({ timeout: 300_000 });
  await page.getByText('Necessary only', { exact: true }).click({ timeout: 3000 }).catch(() => {});
  // First-run "Watching Threads" coach covers the feed — dismiss it.
  const guide = page.getByTestId('feed-gesture-guide');
  for (let i = 0; i < 5 && (await guide.isVisible().catch(() => false)); i++) {
    await guide.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2000);
}

async function shoot(name) {
  await page.screenshot({ path: `${outDir}/${prefix}-${name}.png` });
  await page.screenshot({ path: `${outDir}/${prefix}-${name}-header.png`, clip: HEADER });
}

async function tab(id) {
  const el = page.getByTestId(`buyer-home-tabs-${id}`);
  if (!(await el.count())) return false;
  await el.click();
  await page.waitForTimeout(1200);
  return true;
}

await open();
await shoot('threads');
if (await tab('following')) await shoot('following');
if (await tab('live')) await shoot('live');
// Bright video post (Orison, the 4th seeded post) for the header fade.
await tab('for-you');
for (let i = 0; i < 3; i++) {
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 844);
  await page.waitForTimeout(1800);
}
await shoot('bright-video');
await browser.close();
