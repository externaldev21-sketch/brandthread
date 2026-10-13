/**
 * Seller milestone card in the dashboard's top slot, plus the 1080x1920
 * story image it shares (393x852, dark).
 *
 *   node scripts/store-screenshots/milestones-verify.mjs --before   # dashboard before this change (morning brief branch build)
 *   node scripts/store-screenshots/milestones-verify.mjs            # after: demo=1 card, story image, after share, fresh
 *
 * On web, "Share to Stories" downloads the rendered story PNG; the script
 * saves that download, so the story image here is the real capture, not a
 * page screenshot. Reuses BT_WEB_BUILD when set. Runs the text-fit check.
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, 'docs/pr-review/milestones');
mkdirSync(OUT, { recursive: true });
const BEFORE = process.argv.includes('--before');

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function textFit(page) {
  return page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // The offscreen story card is laid out at left:-10000 on purpose.
      if (el.closest('[data-testid="milestone-story-card"]')) continue;
      const text = el.textContent.trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') bad.push(`overflow: ${text}`);
      if (r.right > innerWidth + 1 || r.left < -1) bad.push(`offscreen: ${text}`);
      if (/…|\.\.\./.test(el.textContent) && el.children.length === 0) bad.push(`ellipsis: ${text}`);
    }
    return bad;
  });
}

async function main() {
  let buildDir = process.env.BT_WEB_BUILD;
  if (!buildDir || !existsSync(path.join(buildDir, 'index.html'))) {
    buildDir = DEFAULT_BUILD_DIR;
    buildPreviewWeb(buildDir);
  }
  const { origin, close } = await serveBuild(buildDir);
  const browser = await launchBrowser();
  let problems = 0;
  const shoot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const bad = await textFit(page);
    const cards = await page.getByTestId('milestone-card').count();
    const briefs = await page.getByTestId('morning-brief-card').count();
    console.log(`${name}: milestone cards=${cards}, morning-brief cards=${briefs}; text-fit ${bad.length ? 'PROBLEMS ' + JSON.stringify(bad) : 'OK'}`);
    problems += bad.length;
    return { cards, briefs };
  };
  try {
    for (const mode of BEFORE ? ['demo'] : ['demo', 'fresh']) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {}, contextOptions: { acceptDownloads: true } });
      await openScreen(page, activity, origin, 'seller', '/(tabs)', { extraQuery: mode === 'demo' ? '&demo=1' : '' });
      await waitForQuietNetwork(activity, 600, 10_000);
      await page.waitForTimeout(1500);
      if (BEFORE) {
        await shoot(page, 'before-dashboard-demo');
      } else if (mode === 'demo') {
        const first = await shoot(page, 'after-demo');
        if (first.cards !== 1 || first.briefs !== 0) { console.log('PROBLEM: expected the milestone card alone in the slot'); problems += 1; }
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20_000 }),
          page.getByTestId('milestone-share').click(),
        ]);
        await download.saveAs(path.join(OUT, 'story-card-1080x1920.png'));
        await page.waitForTimeout(800);
        const after = await shoot(page, 'after-shared');
        if (after.cards !== 0) { console.log('PROBLEM: card still showing after share'); problems += 1; }
        await page.reload();
        await waitForQuietNetwork(activity, 600, 10_000);
        await page.waitForTimeout(1500);
        const again = await page.getByTestId('milestone-card').count();
        console.log(`after reload: milestone cards=${again} (expected 0)`);
        if (again) problems += 1;
      } else {
        const fresh = await shoot(page, 'after-fresh');
        if (fresh.cards) problems += 1;
      }
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  if (problems) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
