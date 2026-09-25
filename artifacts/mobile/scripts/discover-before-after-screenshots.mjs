#!/usr/bin/env node
/**
 * BEFORE/AFTER screenshots for the buyer Discover redesign, at 390x844
 * (phone) and 1440x900 (desktop web shell). Reuses the same build/serve/
 * demo-data harness as scripts/store-screenshots.
 *
 * Captures the AFTER build first (the working tree as it stands), then
 * temporarily checks out the three files this redesign touched back to
 * BASE_REF (the commit right before this redesign), rebuilds, and captures
 * BEFORE — restoring the working tree to HEAD afterward either way.
 *
 * Uses `git checkout <ref> -- <paths>` + `git checkout HEAD -- <paths>`
 * rather than `git stash`, so it works whether or not those files currently
 * differ from HEAD (a plain stash is a no-op — and silently captures two
 * identical "before"/"after" screenshots — once the redesign is committed).
 *
 *   node scripts/discover-before-after-screenshots.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
  MOBILE_ROOT,
  WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'polish', 'screenshots', 'discover-redesign');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..', '..');

const VIEWPORTS = [
  { id: '390x844', width: 390, height: 844, isMobile: true },
  { id: '1440x900', width: 1440, height: 900, isMobile: false },
];

// Files this redesign changed in the mobile app — reverted to BASE_REF for the BEFORE capture.
const REVERT_PATHS = [
  'artifacts/mobile/app/(buyer)/discover.tsx',
  'artifacts/mobile/components/discover/DiscoverPager.tsx',
  'artifacts/mobile/components/ui/index.ts',
];

// The commit immediately before this redesign — i.e. "dev" as it stood when
// this branch started (many other PRs had just merged into it).
const BASE_REF = 'a4786e6';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
}

async function captureVariant(label) {
  console.log(`Building ${label} preview web export...`);
  buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const viewport of VIEWPORTS) {
      const device = {
        viewport: { width: viewport.width, height: viewport.height },
        scale: 2,
        userAgent: viewport.isMobile
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        isMobile: viewport.isMobile,
      };
      const { context, page, activity } = await openContext(browser, {
        device, role: 'buyer', origin, images,
      });
      try {
        await openScreen(page, activity, origin, 'buyer', '/discover');
        await page.getByText('Heavyweight Hoodie', { exact: false }).first().waitFor({ timeout: 30_000 }).catch(() => {});
        await waitForImages(page);
        await waitForQuietNetwork(activity);
        await page.waitForTimeout(500);
        const file = path.join(OUTPUT_DIR, `${viewport.id}-${label}.png`);
        await page.screenshot({ path: file });
        console.log(`  wrote ${file}`);
      } catch (error) {
        console.warn(`  skipped ${viewport.id}-${label}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    close();
  }
}

async function main() {
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  await captureVariant('after');

  console.log(`Checking out redesigned files to ${BASE_REF} for the BEFORE capture...`);
  git(['checkout', BASE_REF, '--', ...REVERT_PATHS]);
  try {
    await captureVariant('before');
  } finally {
    console.log('Restoring the working tree to HEAD...');
    git(['checkout', 'HEAD', '--', ...REVERT_PATHS]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
