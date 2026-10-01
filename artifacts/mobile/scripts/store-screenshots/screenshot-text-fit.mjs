/**
 * Usage: node scripts/store-screenshots/screenshot-text-fit.mjs <webBuildDir> <outDir> '<jobs json>'
 * jobs: [{role,target,name,clip?,flags?,click?}]. Screenshots each screen at 393x852 and prints the text-fit check result.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const W = './';
const { launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } = await import('./harness.mjs');
const { ensureDemoImages } = await import('./demo-images.mjs');
const { findTextFitIssues } = await import('./text-fit.mjs');

const BUILD = process.argv[2];
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });
const jobs = JSON.parse(process.argv[4]); // [{role,target,name,clip?,flags?,click?}]
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, '.store-screenshots/images');
const { origin, close } = await serveBuild(BUILD);
try {
  for (const j of jobs) {
    const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
    const { context, page, activity } = await openContext(browser, { device, role: j.role, origin, images });
    if (j.flags) {
      await page.route('**/api/config/features', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ flags: j.flags, updatedAt: null }),
      }));
    }
    await openScreen(page, activity, origin, j.role, j.target);
    await waitForQuietNetwork(activity, 700, 8000);
    await page.waitForTimeout(1500);
    if (j.click) { await page.getByText(j.click, { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(800); }
    await page.screenshot({ path: path.join(OUT, `${j.name}.png`) });
    if (j.clip) await page.screenshot({ path: path.join(OUT, `${j.name}-zoom.png`), clip: j.clip });
    const issues = await findTextFitIssues(page);
    console.log(`TEXTFIT ${j.name} (${j.target}): ${issues.length} issue(s)`, issues.length ? JSON.stringify(issues) : '');
    await context.close();
  }
} finally { close(); await browser.close(); }
