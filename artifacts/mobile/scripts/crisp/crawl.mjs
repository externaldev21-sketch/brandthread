#!/usr/bin/env node
/**
 * Crisp crawl: screenshots EVERY route in app/ at 390×844 with
 * deviceScaleFactor 3 (an iPhone's real pixel density), as buyer and seller,
 * fresh (no data: the preview build with every API call offline) and with
 * the app's own demo data (&demo=1), and checks each settled screen for
 * anything that would paint soft (see checks.mjs): blur/backdrop-filter
 * outside the allow-list, text with opacity < 1 or a faded colour, text in a
 * scale or sub-pixel transform, will-change left behind, images painted
 * larger than their source, sub-pixel borders and smeared shadows.
 *
 *   node scripts/crisp/crawl.mjs                 build, crawl everything
 *   node scripts/crisp/crawl.mjs --skip-build    reuse the last preview build
 *   node scripts/crisp/crawl.mjs --only /buyer-settings,/(tabs)/orders
 *   node scripts/crisp/crawl.mjs --roles seller --modes demo
 *   node scripts/crisp/crawl.mjs --strict        exit 1 on any blocking finding
 *   node scripts/crisp/crawl.mjs --build-dir DIR use (or build into) another export
 *
 * Output (scratch, not committed): .crisp-crawl/
 *   shots/<role>-<mode>/<route>.jpg   every screen at 1170×2532
 *   sheets/<role>-<mode>.jpg          contact sheet of every screen
 *   report.json / report.md           every finding, grouped by screen
 *
 * Blocking rules (fail --strict): blur, text-opacity, text-scale,
 * image-upscaled, will-change. The others (text-faded, text-subpixel,
 * font-fraction, border-subpixel, smear-shadow) are reported per screen.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, serveBuild } from '../store-screenshots/harness.mjs';
import { crispChecks } from './checks.mjs';
import { listRoutes, slugForRoute } from './routes.mjs';

export const VIEWPORT = { width: 390, height: 844 };
export const DPR = 3;
export const BLOCKING = ['blur', 'text-opacity', 'text-scale', 'image-upscaled', 'will-change'];
/** Elements the crawl never flags: the tab bars (out of scope for this
 *  pass — the seller tab bar's glass + glow is Dev's reference and stays) and
 *  anything a component marks with data-crisp-allow (floating controls over
 *  photos/video; see scripts/lint/crisp-allowlist.json). */
export const ALLOW_SELECTORS = ['[data-crisp-allow]', '[data-testid="seller-global-tab-bar"]', '[data-testid="buyer-bottom-tab-bar"]'];

function parse(argv) {
  const o = { skipBuild: false, only: null, roles: ['buyer', 'seller'], modes: ['fresh', 'demo'], strict: false, out: path.join(MOBILE_ROOT, '.crisp-crawl'), workers: 3, settle: 1800, buildDir: DEFAULT_BUILD_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--skip-build') o.skipBuild = true;
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--roles') o.roles = argv[++i].split(',');
    else if (a === '--modes') o.modes = argv[++i].split(',');
    else if (a === '--strict') o.strict = true;
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--workers') o.workers = Number(argv[++i]);
    else if (a === '--settle') o.settle = Number(argv[++i]);
    else if (a === '--build-dir') o.buildDir = path.resolve(argv[++i]);
  }
  return o;
}

// The preview runs offline, so Clerk's script never loads; that is expected.
const IGNORABLE_ERRORS = [/Failed to load resource/i, /net::ERR/i, /favicon/i, /Failed to load Clerk JS/i];

async function openPage(browser, origin, role, mode) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    locale: 'en-US',
  });
  // Fresh = nothing but the app itself: every API, CDN and third-party call
  // is cut, so screens show their real empty states. Demo = the app's own
  // &demo=1 data, which is bundled; same network rule.
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
  const query = `bt_preview=${role}${mode === 'demo' ? '&demo=1' : ''}`;
  await page.goto(`${origin}/?${query}`);
  await page.waitForTimeout(2500);
  // Answer the web cookie banner once (it is stored), so it does not cover
  // the bottom of every screenshot.
  await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 1500 }).catch(() => {});
  return { context, page, errors, query };
}

async function visit(session, route, opts) {
  const { page, query } = session;
  session.errors.length = 0;
  await page.evaluate((url) => {
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, `${route}${route.includes('?') ? '&' : '?'}${query}`);
  await page.waitForTimeout(opts.settle);
  // Wait for images that are already loading, so "upscaled" is measured on
  // the real source and not on a half-decoded one.
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), undefined, { timeout: 4000 }).catch(() => {});
  const result = await page.evaluate(crispChecks, { dpr: DPR, allowSelectors: ALLOW_SELECTORS });
  const landed = await page.evaluate(() => location.pathname);
  return { ...result, landed, errors: session.errors.filter((e) => !IGNORABLE_ERRORS.some((r) => r.test(e))) };
}

async function contactSheet(browser, title, items, file) {
  const cols = 10;
  const thumbW = 117;
  const thumbH = Math.round((thumbW * VIEWPORT.height) / VIEWPORT.width);
  const cells = items.map(({ shot, route, count }) => {
    const data = readFileSync(shot).toString('base64');
    const badge = count ? `<b>${count}</b>` : '';
    return `<figure><img src="data:image/jpeg;base64,${data}"><figcaption>${badge}${route.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</figcaption></figure>`;
  });
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#000;color:#C0C0C0;font:12px -apple-system,system-ui,sans-serif;padding:16px}
    h1{font-size:17px;color:#fff;margin:0 0 12px}
    main{display:grid;grid-template-columns:repeat(${cols},${thumbW}px);gap:12px 8px}
    figure{margin:0;width:${thumbW}px} img{width:${thumbW}px;height:${thumbH}px;display:block;border:1px solid #333}
    figcaption{margin-top:4px;font-size:10px;line-height:12px;word-break:break-all;color:#C0C0C0}
    b{background:#FF3B30;color:#fff;border-radius:3px;padding:0 3px;margin-right:4px}
  </style><h1>${title}</h1><main>${cells.join('')}</main>`;
  const context = await browser.newContext({ viewport: { width: cols * (thumbW + 8) + 32, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 82 });
  await context.close();
}

function markdown(report) {
  const lines = ['# Crisp crawl', '', `${report.screens} screens × ${report.combos.length} states (${report.combos.join(', ')}) at ${VIEWPORT.width}×${VIEWPORT.height} @${DPR}x.`, ''];
  lines.push('| rule | blocking | findings | screens |', '|---|---|---|---|');
  for (const [rule, { findings, screens }] of Object.entries(report.totals)) lines.push(`| ${rule} | ${BLOCKING.includes(rule) ? 'yes' : 'no'} | ${findings} | ${screens} |`);
  lines.push('', '## Allowed (by design)', '');
  for (const [key, n] of Object.entries(report.allowedTotals)) lines.push(`- ${key}: ${n}`);
  lines.push('', '## Findings by screen', '');
  for (const r of report.results) {
    if (!r.findings.length && !r.errors.length) continue;
    lines.push(`### ${r.route} (${r.role}, ${r.mode})${r.landed !== r.route ? ` → ${r.landed}` : ''}`);
    for (const f of r.findings) lines.push(`- **${f.rule}** ${f.detail} — ${f.el.replace(/\|/g, '/')}`);
    for (const e of r.errors) lines.push(`- error: ${e}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const opts = parse(process.argv.slice(2));
  if (!opts.skipBuild) buildPreviewWeb(opts.buildDir);
  rmSync(path.join(opts.out, 'shots'), { recursive: true, force: true });
  mkdirSync(path.join(opts.out, 'sheets'), { recursive: true });
  const routes = listRoutes(path.join(MOBILE_ROOT, 'app')).filter((r) => !opts.only || opts.only.includes(r.route));
  const server = await serveBuild(opts.buildDir);
  const browser = await launchBrowser();

  const combos = opts.roles.flatMap((role) => opts.modes.map((mode) => ({ role, mode })));
  const jobs = [];
  const CHUNK = 20;
  for (const combo of combos) {
    for (let i = 0; i < routes.length; i += CHUNK) jobs.push({ ...combo, routes: routes.slice(i, i + CHUNK) });
  }
  const results = [];
  let done = 0;
  const total = combos.length * routes.length;

  async function worker() {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      const dir = path.join(opts.out, 'shots', `${job.role}-${job.mode}`);
      mkdirSync(dir, { recursive: true });
      let session = await openPage(browser, server.origin, job.role, job.mode);
      for (const { route, file } of job.routes) {
        const shot = path.join(dir, `${slugForRoute(route)}.jpg`);
        let result;
        try {
          result = await visit(session, route, opts);
          await session.page.screenshot({ path: shot, type: 'jpeg', quality: 85 });
        } catch (error) {
          result = { findings: [], allowed: [], landed: '?', errors: [`crawl: ${String(error.message).split('\n')[0]}`] };
          await session.context.close().catch(() => {});
          session = await openPage(browser, server.origin, job.role, job.mode);
        }
        results.push({ route, file, role: job.role, mode: job.mode, shot, ...result });
        done += 1;
        if (done % 25 === 0 || done === total) process.stdout.write(`  ${done}/${total}\n`);
        // A screen can leave a modal or a stuck overlay behind; start the
        // next one from a clean page.
        if (result.errors.length) {
          await session.context.close().catch(() => {});
          session = await openPage(browser, server.origin, job.role, job.mode);
        }
      }
      await session.context.close().catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: opts.workers }, worker));
  results.sort((a, b) => a.route.localeCompare(b.route) || a.role.localeCompare(b.role) || a.mode.localeCompare(b.mode));

  const totals = {};
  const allowedTotals = {};
  for (const r of results) {
    const rules = new Set();
    for (const f of r.findings) {
      totals[f.rule] ??= { findings: 0, screens: 0 };
      totals[f.rule].findings += 1;
      rules.add(f.rule);
    }
    for (const rule of rules) totals[rule].screens += 1;
    for (const a of r.allowed) allowedTotals[`${a.rule} (${a.allow})`] = (allowedTotals[`${a.rule} (${a.allow})`] ?? 0) + 1;
  }
  const report = { screens: routes.length, combos: combos.map((c) => `${c.role}-${c.mode}`), totals, allowedTotals, results };
  writeFileSync(path.join(opts.out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(path.join(opts.out, 'report.md'), markdown(report));

  for (const combo of combos) {
    const items = results
      .filter((r) => r.role === combo.role && r.mode === combo.mode && !r.errors.some((e) => e.startsWith('crawl:')))
      .map((r) => ({ shot: r.shot, route: r.route, count: r.findings.filter((f) => BLOCKING.includes(f.rule)).length }));
    if (items.length) await contactSheet(browser, `${combo.role} · ${combo.mode} · ${items.length} screens · 390×844 @3x`, items, path.join(opts.out, 'sheets', `${combo.role}-${combo.mode}.jpg`));
  }
  await browser.close();
  server.close();

  const blocking = results.flatMap((r) => r.findings.filter((f) => BLOCKING.includes(f.rule)).map((f) => ({ ...f, route: r.route, role: r.role, mode: r.mode })));
  console.log(`\nCrisp crawl: ${results.length} screens checked. ${Object.entries(totals).map(([k, v]) => `${k} ${v.findings}`).join(', ') || 'no findings'}.`);
  console.log(`Report: ${path.relative(process.cwd(), path.join(opts.out, 'report.md'))}`);
  if (opts.strict && blocking.length) {
    for (const b of blocking.slice(0, 40)) console.error(`  ${b.route} (${b.role}, ${b.mode}) ${b.rule}: ${b.detail} — ${b.el}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
