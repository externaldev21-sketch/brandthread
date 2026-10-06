/**
 * Display preferences verification: Settings → Language ("Translation
 * language", "Auto-translate captions") and Accessibility ("Text size",
 * "High contrast icons"). Drives the web preview build with a signed-in demo
 * buyer and a fake API (asserting GET/PATCH /api/display-preferences and
 * POST /api/translate are really called), then the signed-out preview
 * (?bt_preview=buyer, which must never call those protected APIs), and
 * captures 390x844 screenshots.
 *
 * Run:  node scripts/store-screenshots/display-prefs-verify.mjs [--skip-build] [--only=a,b]
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { clerkStubScript } from './clerk-stub.mjs';
import { BUYER_USER, DEMO_NOW, DEMO_TIME_ZONE, localStorageSeed, respond } from './demo-data.mjs';
import { MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, serveBuild } from './harness.mjs';

const BUILD_DIR = path.join(WORK_DIR, 'display-prefs-build');
const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/qa-fake-features');
mkdirSync(OUT, { recursive: true });

const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2 };
const DEMO_API = 'https://api.brandthread.test';
const SPANISH = 'Hola amigos, el nuevo drop ya está aquí. Sudaderas para todos, hoy';
const ENGLISH = 'Hello friends, the new drop is here. Hoodies for everyone, today';

const failures = [];
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

/** Fake account state + the API overrides that serve it. */
function fakeAccount({ translateStatus = 200, initialPrefs = {} } = {}) {
  const state = {
    prefs: { translationLanguage: 'en', autoTranslateCaptions: false, textSize: 'default', highContrastIcons: false, ...initialPrefs },
    translateStatus,
  };
  const overrides = ({ method, path: p, query, body }) => {
    if (p === '/display-preferences' && method === 'GET') return { body: { preferences: state.prefs } };
    if (p === '/display-preferences' && method === 'PATCH') {
      state.prefs = { ...state.prefs, ...body };
      return { body: { preferences: state.prefs } };
    }
    if (p === '/translate' && method === 'POST') {
      if (state.translateStatus === 503) {
        return { status: 503, body: { error: "Translation isn't available right now.", code: 'TRANSLATION_NOT_CONFIGURED' } };
      }
      return { body: { targetLanguage: body.targetLanguage, translations: body.texts.map((text) => (
        text === SPANISH
          ? { text, translatedText: ENGLISH, detectedLanguage: 'es', sameLanguage: false }
          : { text, translatedText: text, detectedLanguage: 'en', sameLanguage: true }
      )) } };
    }
    if (p === '/public/trending') {
      const base = respond({ method: 'GET', path: '/api/public/trending', query, role: 'buyer', options: {} });
      return { body: { trending: base.trending.map((r, i) => (i === 0 ? { ...r, caption: SPANISH } : r)) } };
    }
    return undefined;
  };
  return { state, overrides };
}

async function openPage(browser, origin, { overrides = () => undefined, calls = [], preview = false } = {}) {
  const context = await browser.newContext({
    viewport: DEVICE.viewport, deviceScaleFactor: DEVICE.scale, isMobile: true, hasTouch: true,
    locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce',
  });
  await context.clock.install({ time: DEMO_NOW });
  await context.addInitScript(clerkStubScript(BUYER_USER));
  const seed = localStorageSeed('buyer');
  // A persisted user_role is what keeps the signed-out ?bt_preview=buyer mode
  // on (lib/devPreview.ts); the signed-in runs must not carry it.
  if (preview) seed.user_role = 'buyer'; else delete seed.user_role;
  if (!preview) {
    // The app mirrors the signed-in role into localStorage.user_role, which
    // this preview-enabled export reads as "signed-out preview" on the next
    // render. Keep the signed-in runs a real signed-in session.
    await context.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key !== 'user_role') set.call(this, key, value); };
    });
  }
  await context.addInitScript((s) => {
    if (sessionStorage.getItem('bt:seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    sessionStorage.setItem('bt:seeded', '1');
  }, seed);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== DEMO_API) return route.abort();
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = url.pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
    let body = null;
    try { body = request.postDataJSON(); } catch {}
    calls.push({ method: request.method(), path: p, body });
    const custom = overrides({ method: request.method(), path: p, query: url.searchParams, body });
    if (custom) {
      return route.fulfill({ status: custom.status ?? 200, headers: cors, contentType: 'application/json', body: JSON.stringify(custom.body ?? {}) });
    }
    const fallback = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
    if (fallback === undefined) {
      return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fallback) });
  });
  const page = await context.newPage();
  globalThis.__lastPage = page;
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  return { context, page };
}

/** Loads the app signed in (at Discover), then moves to `route` client-side. */
async function start(page, origin, route) {
  await page.goto(`${origin}/discover`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await navigate(page, route);
}

/** Client-side navigation (keeps the loaded app and its in-memory state). */
async function navigate(page, url) {
  await page.evaluate((u) => {
    history.pushState(history.state, '', u);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, url);
  await page.waitForTimeout(1500);
}

async function fontSizeOf(page, text) {
  return page.getByText(text, { exact: true }).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

/** Horizontal page overflow (layout breaking past the 390pt screen). */
async function pageOverflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}

/** Feather glyphs currently painted in the silver muted tint (#C0C0C0 / #B0B0B0). */
async function mutedIconCount(page) {
  return page.evaluate(() => [...document.querySelectorAll('div, span')].filter((el) => {
    const cs = getComputedStyle(el);
    return /feather/i.test(cs.fontFamily) && el.childElementCount === 0
      && (cs.color === 'rgb(192, 192, 192)' || cs.color === 'rgb(176, 176, 176)');
  }).length);
}

async function textSize(browser, origin) {
  const calls = [];
  const { state, overrides } = fakeAccount();
  const { context, page } = await openPage(browser, origin, { overrides, calls });
  await page.goto(`${origin}/discover`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  check(calls.some((c) => c.method === 'GET' && c.path === '/display-preferences'), 'signed-in app loads GET /api/display-preferences');
  await shot(page, 'settings-text-size-discover-default.png');
  const baseOverflow = await pageOverflow(page);

  await navigate(page, '/buyer-settings-detail?section=accessibility');
  await page.getByText('Text size', { exact: true }).first().waitFor({ timeout: 15_000 });
  check(await page.getByText('Default', { exact: true }).count() > 0, 'Text size row shows the real current value (Default)');
  const before = await fontSizeOf(page, 'Reduce motion');
  await shot(page, 'settings-text-size-default.png');

  await page.getByText('Text size', { exact: true }).first().click();
  await page.getByText('Larger', { exact: true }).first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await shot(page, 'settings-text-size-sheet.png');
  await page.getByText('Larger', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  if (process.env.DEBUG_DP) console.log(JSON.stringify(calls.filter((c) => /display/.test(c.path))));
  check(calls.some((c) => c.method === 'PATCH' && c.path === '/display-preferences' && c.body?.textSize === 'larger'), 'choosing Larger calls PATCH /api/display-preferences { textSize: larger }');
  check(state.prefs.textSize === 'larger', 'account stores textSize = larger');
  const after = await fontSizeOf(page, 'Reduce motion');
  check(after > before * 1.2, `settings text grows app-wide (${before}px → ${after}px)`);
  check(await page.getByText('Larger', { exact: true }).count() > 0, 'Text size row shows Larger');
  await shot(page, 'settings-text-size-larger.png');

  for (const [route, name] of [['/discover', 'discover'], ['/buyer-settings-detail?section=language', 'language'], ['/activity', 'activity'], ['/profile', 'profile']]) {
    await navigate(page, route);
    await page.waitForTimeout(1200);
    const overflow = await pageOverflow(page);
    check(overflow <= Math.max(0, baseOverflow), `${route} has no horizontal overflow at Larger (${overflow}px)`);
    await shot(page, `settings-text-size-larger-${name}.png`);
  }

  // Persisted locally: a reload opens at the saved size before/without the API.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await navigate(page, '/buyer-settings-detail?section=accessibility');
  await page.getByText('Reduce motion', { exact: true }).first().waitFor({ timeout: 15_000 });
  check(await fontSizeOf(page, 'Reduce motion') === after, 'text size survives a reload');

  // Back to Default restores the original size.
  await page.getByText('Text size', { exact: true }).first().click();
  await page.getByText('Default', { exact: true }).last().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.getByText('Default', { exact: true }).last().click();
  await page.waitForTimeout(1000);
  check(await fontSizeOf(page, 'Reduce motion') === before, 'Default restores the original size');
  await context.close();
}

async function highContrast(browser, origin) {
  const calls = [];
  const { state, overrides } = fakeAccount();
  const { context, page } = await openPage(browser, origin, { overrides, calls });
  await start(page, origin, '/buyer-settings-detail?section=activity');
  await page.getByText('Search history', { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const mutedOff = await mutedIconCount(page);
  await shot(page, 'settings-high-contrast-off-icons.png');

  await navigate(page, '/buyer-settings-detail?section=accessibility');
  await page.getByText('High contrast icons', { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, 'settings-high-contrast-off.png');
  await page.getByRole('switch').last().click();
  await page.waitForTimeout(1000);
  check(calls.some((c) => c.method === 'PATCH' && c.path === '/display-preferences' && c.body?.highContrastIcons === true), 'toggling calls PATCH /api/display-preferences { highContrastIcons: true }');
  check(state.prefs.highContrastIcons === true, 'account stores highContrastIcons = true');
  await shot(page, 'settings-high-contrast-on.png');

  await navigate(page, '/buyer-settings-detail?section=activity');
  await page.getByText('Search history', { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const mutedOn = await mutedIconCount(page);
  await shot(page, 'settings-high-contrast-on-icons.png');
  check(mutedOff > 0 && mutedOn === 0, `silver icon glyphs become full-contrast (${mutedOff} muted off → ${mutedOn} on)`);

  for (const [route, name] of [['/discover', 'discover'], ['/profile', 'profile']]) {
    await navigate(page, route);
    await page.waitForTimeout(1500);
    check(await mutedIconCount(page) === 0, `${route}: no silver icon glyphs left with high contrast on`);
    await shot(page, `settings-high-contrast-on-${name}.png`);
  }
  await context.close();
}

async function translation(browser, origin) {
  // 1) Settings rows + manual "See translation".
  {
    const calls = [];
    const { state, overrides } = fakeAccount();
    const { context, page } = await openPage(browser, origin, { overrides, calls });
    await start(page, origin, '/buyer-settings-detail?section=language');
    await page.getByText('Translation language', { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    check(await page.getByText('English', { exact: true }).count() > 0, 'Translation language row shows the real value (English)');
    await shot(page, 'settings-translation-language-rows.png');
    await page.getByText('Translation language', { exact: true }).first().click();
    await page.getByText('Español', { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, 'settings-translation-language-sheet.png');
    await page.getByText('French', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    check(calls.some((c) => c.method === 'PATCH' && c.path === '/display-preferences' && c.body?.translationLanguage === 'fr'), 'picking French calls PATCH { translationLanguage: fr }');
    check(await page.getByText('French', { exact: true }).count() > 0, 'row shows French');
    // Back to English for the caption checks.
    await page.getByText('Translation language', { exact: true }).first().click();
    await page.getByText('Español', { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.getByText('English', { exact: true }).last().click();
    await page.waitForTimeout(800);
    check(state.prefs.translationLanguage === 'en', 'account stores translationLanguage = en');

    await navigate(page, '/discover');
    await page.waitForTimeout(1500);
    await page.getByText(SPANISH.slice(0, 20), { exact: false }).first().click();
    await page.getByText('See translation', { exact: true }).first().waitFor({ timeout: 10_000 });
    check(!calls.some((c) => c.path === '/translate'), 'nothing is translated until asked (auto-translate off)');
    await shot(page, 'settings-translation-see-translation.png');
    await page.getByText('See translation', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    if (process.env.DEBUG_DP) console.log(JSON.stringify(calls.filter((c) => /display|translate/.test(c.path))), await page.locator('text=/translat|original/i').allTextContents());
    await page.getByText('See original', { exact: true }).first().waitFor({ timeout: 10_000 });
    const req = calls.find((c) => c.method === 'POST' && c.path === '/translate');
    check(!!req && req.body?.texts?.[0] === SPANISH && req.body?.targetLanguage === 'en', 'See translation calls POST /api/translate { texts, targetLanguage: en }');
    check(await page.getByText(ENGLISH, { exact: false }).count() > 0, 'translated caption is shown');
    await shot(page, 'settings-translation-translated.png');
    await page.getByText('See original', { exact: true }).first().click();
    await page.waitForTimeout(500);
    check(await page.getByText(SPANISH, { exact: false }).count() > 0, 'See original restores the caption');
    await context.close();
  }

  // 2) Auto-translate on: shown translated without a tap.
  {
    const calls = [];
    const { overrides } = fakeAccount({ initialPrefs: { autoTranslateCaptions: true } });
    const { context, page } = await openPage(browser, origin, { overrides, calls });
    await start(page, origin, '/buyer-settings-detail?section=language');
    await page.getByText('Auto-translate captions', { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await shot(page, 'settings-translation-auto-on.png');
    await navigate(page, '/discover');
    await page.waitForTimeout(1500);
    await page.getByText('Drop 04', { exact: false }).count();
    const tile = page.getByText(SPANISH.slice(0, 20), { exact: false }).first();
    await tile.click();
    await page.getByText('See original', { exact: true }).first().waitFor({ timeout: 10_000 });
    check(calls.some((c) => c.path === '/translate'), 'auto-translate fetches the translation automatically');
    check(await page.getByText(ENGLISH, { exact: false }).count() > 0, 'auto-translated caption is shown with See original');
    await shot(page, 'settings-translation-auto-translated.png');
    await context.close();
  }

  // 3) Server without the AI integration: says so, never fakes.
  {
    const calls = [];
    const { overrides } = fakeAccount({ translateStatus: 503 });
    const { context, page } = await openPage(browser, origin, { overrides, calls });
    await start(page, origin, '/discover');
    await page.getByText(SPANISH.slice(0, 20), { exact: false }).first().click();
    await page.getByText('See translation', { exact: true }).first().click();
    await page.getByText('Translation unavailable', { exact: true }).first().waitFor({ timeout: 10_000 });
    check(await page.getByText(ENGLISH, { exact: false }).count() === 0, '503 TRANSLATION_NOT_CONFIGURED shows no fake translation');
    await shot(page, 'settings-translation-unavailable.png');
    await context.close();
  }
}

async function signedOutPreview(browser, origin) {
  const calls = [];
  const { overrides } = fakeAccount();
  const { context, page } = await openPage(browser, origin, { overrides, calls, preview: true });
  await page.goto(`${origin}/?bt_preview=buyer`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await navigate(page, '/buyer-settings-detail?section=accessibility&bt_preview=buyer');
  await page.getByText('Text size', { exact: true }).first().waitFor({ timeout: 15_000 });
  const before = await fontSizeOf(page, 'Reduce motion');
  await page.getByText('Text size', { exact: true }).first().click();
  await page.getByText('Large', { exact: true }).first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.getByText('Large', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  const after = await fontSizeOf(page, 'Reduce motion');
  check(after > before, `preview: text size applies locally (${before}px → ${after}px)`);
  await shot(page, 'settings-text-size-preview-large.png');
  // The preview's own feed/Discover/comment data is English-only, so the
  // preview "See translation" → sign-in path is covered by
  // components/translation/__tests__/CaptionTranslation.test.tsx.
  await navigate(page, '/buyer-settings-detail?section=language&bt_preview=buyer');
  await page.getByText('Auto-translate captions', { exact: true }).first().waitFor({ timeout: 15_000 });
  await page.getByRole('switch').last().click();
  await page.waitForTimeout(800);
  await shot(page, 'settings-translation-preview-local.png');
  const protectedCalls = calls.filter((c) => c.path === '/display-preferences' || c.path === '/translate');
  check(protectedCalls.length === 0, `preview never calls /api/display-preferences or /api/translate (${protectedCalls.length} calls)`);
  await context.close();
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const runs = { textSize, highContrast, translation, signedOutPreview };
  try {
    for (const [name, fn] of Object.entries(runs)) {
      if (only && !only.split(',').includes(name)) continue;
      console.log(`\n── ${name}`);
      try { await fn(browser, origin); } catch (e) { await globalThis.__lastPage?.screenshot({ path: path.join(OUT, `debug-display-${name}.png`) }).catch(() => {}); check(false, `${name} crashed: ${e.message.split('\n')[0]}`); }
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
