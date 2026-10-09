#!/usr/bin/env node
/**
 * Screen consolidation: screenshots at 390x844 plus where each old route lands.
 *
 *   node scripts/consolidation/capture.mjs <build-dir> <out-dir> <shots.json>
 *
 * shots.json: [{ "name", "role": "seller"|"buyer", "target": "/path?x=1",
 *               "demo": true (&demo=1) | false (fresh account), "expect": "/landing/path" (optional),
 *               "tap": "testID to press after load" (optional),
 *               "expectNotFound": true (optional) }]
 * Writes <name>.png per shot and results.json ({ name, target, landed, ok }).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from '../store-screenshots/harness.mjs';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';

const [buildDir, outDir, shotsFile] = process.argv.slice(2);
const shots = JSON.parse(readFileSync(shotsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
const server = await serveBuild(path.resolve(buildDir));
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.resolve(buildDir, '..', 'demo-images'));
const results = [];
try {
  for (const shot of shots) {
    const { context, page, activity } = await openContext(browser, {
      device, role: shot.role, origin: server.origin, images,
      seedOptions: shot.demo ? {} : { fresh: true },
    });
    try {
      // The app's own start-up redirect can win over the first push (same
      // reason the other capture scripts retry): try up to three times.
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await openScreen(page, activity, server.origin, shot.role, shot.target, { extraQuery: shot.demo ? '&demo=1' : '' });
        await waitForQuietNetwork(activity, 800, 15_000);
        await page.waitForTimeout(1500);
        if (new URL(page.url()).pathname !== '/') break;
      }
      if (shot.tap) {
        await page.getByTestId(shot.tap).first().click();
        await waitForQuietNetwork(activity, 800, 15_000);
        await page.waitForTimeout(900);
      }
      const landed = new URL(page.url());
      const landedPath = decodeURIComponent(landed.pathname);
      const notFound = (await page.getByText("This screen doesn't exist").count()) > 0;
      const ok = (shot.expect ? landedPath === shot.expect : true) && notFound === !!shot.expectNotFound;
      results.push({ name: shot.name, target: shot.target, landed: `${landedPath}${landed.search}`, ok, notFound });
      await page.screenshot({ path: path.join(outDir, `${shot.name}.png`) });
    } catch (error) {
      results.push({ name: shot.name, target: shot.target, error: String(error?.message ?? error), ok: false });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}: ${r.target} → ${r.landed ?? r.error}`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
