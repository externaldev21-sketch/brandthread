// Captures the buyer Threads Home header with the LIVE edge tab collapsed,
// expanded (cart pushed out), and collapsed again (cart back), at 390x844.
// Run against `expo start --web --port 8081` (see e2e/brandthread-agent.spec.ts):
//   node e2e/live-edge-tab.capture.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'docs/screenshots/live-edge-tab';
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://localhost:8081';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
if (process.env.CLERK_STUB) await page.addInitScript({ path: process.env.CLERK_STUB });

async function shoot(name, tab) {
  await page.goto(`${BASE}/?bt_preview=buyer`, { waitUntil: 'networkidle' }).catch(() => {});
  const live = page.getByTestId('buyer-home-live');
  await live.waitFor({ timeout: 120_000 });
  await page.getByText('Necessary only', { exact: true }).click({ timeout: 3000 }).catch(() => {});
  // First-run "Watching Threads" coach covers the feed — dismiss it.
  const guide = page.getByTestId('feed-gesture-guide');
  for (let i = 0; i < 5 && (await guide.isVisible().catch(() => false)); i++) {
    await guide.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  if (tab === 'following') await page.getByText('Following', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${name}-1-collapsed.png` });
  if (process.env.CAPTURE_MID) {
    // Mid-animation, deterministically: drag the tab about halfway out and
    // shoot while the finger is still down (the pan drives progress directly).
    const box = await live.boundingBox();
    const x = Math.max(2, box.x + box.width - 4), y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + (Number(process.env.CAPTURE_MID) * i) / 10, y);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${outDir}/${name}-1b-mid-animation.png` });
    // Back to the edge before the tap below.
    for (let i = 9; i >= 0; i--) await page.mouse.move(x + (Number(process.env.CAPTURE_MID) * i) / 10, y);
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  await live.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}-2-expanded-cart-hidden.png` });
  // Tap elsewhere: the catcher closes LIVE without passing the tap through.
  await page.mouse.click(250, 450);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}-3-collapsed-cart-back.png` });
}

await shoot('threads', 'threads');
await shoot('following', 'following');
await browser.close();
