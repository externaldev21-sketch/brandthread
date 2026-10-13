/**
 * Morning brief card at the top of the seller dashboard (393x852, dark).
 *
 *   node scripts/store-screenshots/morning-brief-verify.mjs --before   # dashboard on dev (build from the base commit)
 *   node scripts/store-screenshots/morning-brief-verify.mjs            # after: demo=1, dismissed, fresh
 *
 * Reuses an existing build when BT_WEB_BUILD points at one; otherwise builds.
 * Runs the harness text-fit check on every capture.
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, 'docs/pr-review/morning-brief');
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
    const cards = await page.getByTestId('morning-brief-card').count();
    console.log(`${name}: morning-brief cards=${cards}; text-fit ${bad.length ? 'PROBLEMS ' + JSON.stringify(bad) : 'OK'}`);
    problems += bad.length;
    return cards;
  };
  try {
    const modes = BEFORE ? ['demo'] : ['demo', 'fresh'];
    for (const mode of modes) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
      await openScreen(page, activity, origin, 'seller', '/(tabs)', { extraQuery: mode === 'demo' ? '&demo=1' : '' });
      await waitForQuietNetwork(activity, 600, 10_000);
      await page.waitForTimeout(1500);
      if (BEFORE) {
        await shoot(page, 'before-dashboard-demo');
      } else if (mode === 'demo') {
        await shoot(page, 'after-demo');
        const close = page.getByTestId('morning-brief-dismiss');
        if (await close.count()) {
          await close.click();
          await page.waitForTimeout(600);
          await shoot(page, 'after-dismissed');
          // Dismissed for today survives a reload.
          await page.reload();
          await waitForQuietNetwork(activity, 600, 10_000);
          await page.waitForTimeout(1500);
          const back = await page.getByTestId('morning-brief-card').count();
          console.log(`after reload: morning-brief cards=${back} (expected 0)`);
          if (back) problems += 1;
        } else {
          console.log('PROBLEM: no dismiss button in demo mode');
          problems += 1;
        }
      } else {
        const cards = await shoot(page, 'after-fresh');
        if (cards) problems += 1;
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
