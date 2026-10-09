#!/usr/bin/env node
/**
 * Live verification for quote reposts (quote-post screen, embedded quoted-post
 * card, share-sheet entry) at 393x852 in the web preview, with an automated
 * text-fit check (text elements whose scrollWidth > clientWidth, or whose box
 * overflows its parent / the viewport).
 *
 * Usage:  node scripts/store-screenshots/quote-post-verify.mjs [outDir] [--skip-build]
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { IMAGE_HOST } from './demo-data.mjs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/quote'));
mkdirSync(OUT, { recursive: true });
if (!args.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' }));
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });

const QUOTED = {
  id: 'preview-quoted-01', userId: 'u-nova', author: { displayName: 'Nova Studio', brandName: null, username: 'nova' },
  caption: 'Drop 04 is live. Heavyweight fleece in bone, made in small batches.', thumbnailUrl: `${IMAGE_HOST}/hoodie-bone.jpg`, mediaType: 'photo',
};

/** Flags text boxes that clip (scrollWidth > clientWidth) or overflow their parent / the viewport. */
async function textFit(label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('div, span, p, input, textarea')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
      }
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = (el.textContent || el.value || el.placeholder || '').trim().slice(0, 40);
      const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if (!clamped && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') out.push({ kind: 'scrollWidth>clientWidth', text });
      if (r.right > vw + 1 || r.left < -1) out.push({ kind: 'outside-viewport', text });
      const p = el.parentElement;
      if (p) {
        const pr = p.getBoundingClientRect();
        if (pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1) && getComputedStyle(p).overflowX === 'visible' && p !== document.body) {
          out.push({ kind: 'overflows-parent', text });
        }
      }
    }
    return out;
  });
  const line = `${label}: ${issues.length === 0 ? 'OK (0 issues)' : JSON.stringify(issues)}`;
  console.log(line);
  return line;
}

const report = [];
try {
  await openScreen(page, activity, origin, 'buyer', `/quote-post?demo=1&postId=preview-post-01&author=${encodeURIComponent('Nova Studio')}&caption=${encodeURIComponent(QUOTED.caption)}&thumb=${encodeURIComponent(QUOTED.thumbnailUrl)}`);
  await waitForQuietNetwork(activity, 600, 8000);
  await page.waitForTimeout(1500);
  console.log('url', page.url(), '|', (await page.evaluate(() => document.body.innerText)).slice(0, 200).replace(/\n/g, ' / '));
  await page.waitForSelector('[data-testid="quote-caption-input"]', { timeout: 15000 }).catch(async () => { await page.screenshot({ path: path.join(OUT, 'debug.png') }); throw new Error('quote input not found'); });
  await page.screenshot({ path: path.join(OUT, '01-quote-post-empty.png') });
  report.push(await textFit('quote-post (empty)'));
  await page.fill('[data-testid="quote-caption-input"]', 'Obsessed with this fit. Sizing runs true, go one up for layering.');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '02-quote-post-filled.png') });
  report.push(await textFit('quote-post (filled)'));
  await page.screenshot({ path: path.join(OUT, '03-quoted-card-zoom.png'), clip: { x: 0, y: 296, width: 393, height: 112 } });

  // Note: the viewer in demo preview serves a seeded local post (services/socialService preview store), so
  // the embedded card there is covered by structural tests, not by a screenshot.
} finally {
  writeFileSync(path.join(OUT, 'text-fit-output.txt'), report.join('\n') + '\n');
  await context.close();
  await browser.close();
  close();
}
