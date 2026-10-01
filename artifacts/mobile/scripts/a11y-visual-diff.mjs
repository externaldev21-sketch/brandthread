#!/usr/bin/env node
/**
 * Default-scale visual regression check for the accessibility PR: the
 * accessibility props and font-scale caps must not change how anything
 * renders at the default text size.
 *
 *   node scripts/a11y-visual-diff.mjs build <dir>            export the preview web build
 *   node scripts/a11y-visual-diff.mjs capture <buildDir> <outDir>   (run several times into different outDirs)
 *   node scripts/a11y-visual-diff.mjs compare <dirsA> <dirsB>  comma-separated run dirs; closest diff per screen, exit 1 if any differ
 *
 * Captures 393x852 screenshots of the key screens through the same demo
 * harness the store screenshots use (fixed clock, reduced motion, fake API).
 * Run `capture` on origin/dev and on the branch, then `compare`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const SCREENS = [
  ['buyer', 'buyer-feed', '/feed'],
  ['buyer', 'buyer-discover', '/discover'],
  ['buyer', 'buyer-cart', '/cart'],
  ['buyer', 'buyer-inbox', '/inbox'],
  ['buyer', 'buyer-profile', '/profile'],
  ['buyer', 'buyer-orders', '/orders'],
  ['buyer', 'buyer-product', '/buyer-product-detail?productId=prod_nl_jacket_rust'],
  ['buyer', 'buyer-checkout', '/buyer-checkout'],
  ['buyer', 'buyer-settings', '/buyer-settings'],
  ['buyer', 'buyer-search', '/buyer-search'],
  ['buyer', 'edit-profile', '/edit-profile'],
  ['buyer', 'forgot-password', '/forgot-password'],
  ['buyer', 'sign-in', '/sign-in'],
  ['buyer', 'onboarding', '/onboarding'],
  ['seller', 'seller-studio', '/studio'],
  ['seller', 'seller-products', '/products'],
];

async function capture(buildDir, outDir) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(path.resolve(buildDir));
  const device = { viewport: { width: 393, height: 852 }, scale: 1, isMobile: true, userAgent: undefined };
  try {
    for (const [role, name, route] of SCREENS) {
      const { context, page, activity } = await openContext(browser, { device, role, origin, images });
      const wantPath = route.split('?')[0];
      let shot = null;
      // The demo app occasionally lands on the home feed instead of the
      // target route, or is still animating. Retry until the URL matches and
      // two consecutive frames are byte-identical, so a diff between builds
      // reflects the code and not load timing.
      for (let attempt = 0; attempt < 6 && !shot; attempt += 1) {
        await openScreen(page, activity, origin, role, route);
        await waitForQuietNetwork(activity, 600, 8000);
        await page.waitForTimeout(1800);
        if (new URL(page.url()).pathname !== wantPath) continue;
        let previous = await page.screenshot();
        for (let i = 0; i < 6; i += 1) {
          await page.waitForTimeout(700);
          const next = await page.screenshot();
          if (next.equals(previous)) { shot = next; break; }
          previous = next;
        }
      }
      if (!shot) { console.log('UNSTABLE', name); await context.close(); continue; }
      writeFileSync(path.join(outDir, `${name}.png`), shot);
      console.log('captured', name);
      await context.close();
    }
  } finally {
    await close();
    await browser.close();
  }
}

function diffCount(a, b) {
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) diff += 1;
  }
  return diff;
}

/**
 * dirsA / dirsB are comma-separated capture directories (one per run). A
 * screen passes when some run of A is pixel-identical to some run of B: the
 * demo app has a few continuously animating bits (the brand logo, video
 * posters), so a single pair of frames can differ for reasons unrelated to
 * the code. Reports the closest pair's differing-pixel ratio.
 */
function compare(dirsA, dirsB) {
  const listA = dirsA.split(',');
  const listB = dirsB.split(',');
  let failed = 0;
  const names = readdirSync(listA[0]).filter((f) => f.endsWith('.png')).sort();
  console.log('screen'.padEnd(20), 'pixels'.padStart(9), 'closest diff'.padStart(13), 'ratio');
  for (const file of names) {
    let best = null;
    let total = 0;
    for (const dirA of listA) {
      for (const dirB of listB) {
        let a; let b;
        try { a = PNG.sync.read(readFileSync(path.join(dirA, file))); b = PNG.sync.read(readFileSync(path.join(dirB, file))); } catch { continue; }
        if (a.width !== b.width || a.height !== b.height) continue;
        total = a.width * a.height;
        const d = diffCount(a, b);
        if (best === null || d < best) best = d;
      }
    }
    if (best === null) { console.log(file.padEnd(20), 'NO COMPARABLE PAIR'); failed += 1; continue; }
    if (best > 0) failed += 1;
    console.log(file.replace('.png', '').padEnd(20), String(total).padStart(9), String(best).padStart(13), `${((best / total) * 100).toFixed(4)}%`);
  }
  console.log(failed === 0 ? `IDENTICAL: ${names.length} screens, 0 differing pixels` : `${failed} screen(s) differ`);
  process.exit(failed === 0 ? 0 : 1);
}


const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'build') buildPreviewWeb(path.resolve(a));
else if (cmd === 'capture') await capture(a, b);
else if (cmd === 'compare') compare(a, b);
else { console.error('usage: build <dir> | capture <buildDir> <outDir> | compare <dirsA> <dirsB>'); process.exit(2); }
