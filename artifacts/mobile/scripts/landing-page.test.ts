import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const {
  ASSET_DIR,
  LANDING_ASSETS,
  QR_FALLBACK_URL,
  ROUTES,
  WAITLIST_ENDPOINT,
  WAITLIST_SUCCESS,
  qrSvg,
  renderLandingHtml,
  resolveStoreUrl,
  writeLandingPage,
} = require('./landing-page.js') as {
  ASSET_DIR: string;
  LANDING_ASSETS: Record<string, string>;
  QR_FALLBACK_URL: string;
  ROUTES: Record<string, string>;
  WAITLIST_ENDPOINT: string;
  WAITLIST_SUCCESS: string;
  qrSvg: (text: string) => string;
  renderLandingHtml: (options?: Record<string, unknown>) => string;
  resolveStoreUrl: (value: unknown, kind: 'appStore' | 'playStore') => string | null;
  writeLandingPage: (outDir: string, root: string, env?: Record<string, string | undefined>) => string;
};
const { hasClerkSession, shouldServeLanding } = require('../server/landing.js') as {
  hasClerkSession: (cookie?: string) => boolean;
  shouldServeLanding: (args: Record<string, unknown>) => boolean;
};

const APP_STORE = 'https://apps.apple.com/us/app/brandthread/id1234567890';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.brandthread.mobile';

describe('store URL validation (kept for future launch badges)', () => {
  it('accepts only https URLs on the right store host', () => {
    expect(resolveStoreUrl(APP_STORE, 'appStore')).toBe(APP_STORE);
    expect(resolveStoreUrl(PLAY_STORE, 'playStore')).toBe(PLAY_STORE);
    expect(resolveStoreUrl(undefined, 'appStore')).toBeNull();
    expect(resolveStoreUrl('', 'playStore')).toBeNull();
    expect(resolveStoreUrl('not a url', 'appStore')).toBeNull();
    expect(resolveStoreUrl('http://apps.apple.com/app/id1', 'appStore')).toBeNull();
    expect(resolveStoreUrl('javascript:alert(1)', 'appStore')).toBeNull();
    expect(resolveStoreUrl(PLAY_STORE, 'appStore')).toBeNull();
    expect(resolveStoreUrl('https://evil.example/apps.apple.com', 'appStore')).toBeNull();
  });

  it('pre-launch: never renders store badges, even when store env vars are set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-landing-'));
    try {
      const html = writeLandingPage(dir, projectRoot, { EXPO_PUBLIC_APP_STORE_URL: APP_STORE, EXPO_PUBLIC_PLAY_STORE_URL: PLAY_STORE });
      expect(html).not.toContain(APP_STORE);
      expect(html).not.toContain(PLAY_STORE);
      expect(html).not.toMatch(/App Store|Google Play|class="badges"|installUrl/);
      expect(fs.existsSync(path.join(dir, 'landing.html'))).toBe(true);
      const published = fs.readdirSync(path.join(dir, ASSET_DIR));
      for (const name of Object.keys(LANDING_ASSETS)) {
        const ext = path.extname(name);
        const hashed = published.find((file) => new RegExp(`^${name.slice(0, -ext.length)}\\.[0-9a-f]{10}\\${ext}$`).test(file));
        expect(hashed, name).toBeDefined();
        expect(html).toContain(`/${ASSET_DIR}/${hashed}`);
      }
      expect(html).not.toContain(`/${ASSET_DIR}/app-capture.mp4"`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pre-launch landing page content', () => {
  const html = renderLandingHtml();
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1] ?? '';

  it('keeps the original headline and covers the four capabilities', () => {
    expect(html).toContain('<h1>Shop, sell and design streetwear.</h1>');
    for (const t of ['Threads', 'Independent drops', 'Seller tools and live selling', 'Thread Cash']) expect(html).toContain(`<h3>${t}</h3>`);
    expect(html).toContain('/brandthread-logo.png');
    expect(html).toMatch(/font-family:Inter/);
    for (const w of [400, 600, 700]) {
      expect(html).toContain(`@font-face{font-family:Inter;font-style:normal;font-weight:${w};font-display:swap;src:url(/landing-assets/inter-${w}.ttf) format("truetype")}`);
    }
    const fontPreloads = html.match(/<link rel="preload"[^>]*as="font"[^>]*>/g) ?? [];
    expect(fontPreloads).toEqual(['<link rel="preload" href="/landing-assets/inter-400.ttf" as="font" type="font/ttf" crossorigin />']);
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it('only calls the same-origin waitlist endpoint, no external scripts or requests', () => {
    expect(WAITLIST_ENDPOINT).toBe('/api/launch-waitlist');
    const fetches = [...html.matchAll(/\bfetch\s*\(([^,)]+)/g)].map((m) => m[1]);
    expect(fetches).toEqual(['ENDPOINT']);
    expect(script).toContain(`var ENDPOINT=${JSON.stringify(WAITLIST_ENDPOINT)}`);
    expect(html.match(/\/api\//g)).toHaveLength(1);
    expect(html).not.toMatch(/XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    const externalResources = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
      .map((m) => new URL(m[1]).hostname)
      .filter((host) => host !== 'brandthread.app');
    expect(externalResources).toEqual([]);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });

  it('has no sign-up, sign-in, search, pricing or app-entry links; only anchors, legal and support', () => {
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const allowed = new Set([ROUTES.privacy, ROUTES.terms, ROUTES.guidelines, ROUTES.support]);
    for (const href of hrefs) expect(href.startsWith('#') || allowed.has(href), href).toBe(true);
    for (const route of [ROUTES.privacy, ROUTES.terms, ROUTES.guidelines]) {
      expect(html).toContain(`href="${route}"`);
      expect(fs.existsSync(path.join(projectRoot, 'app', `${route.slice(1)}.tsx`)), route).toBe(true);
    }
    expect(html).toContain('href="mailto:support@brandthread.app"');
    expect(html).not.toMatch(/\/onboarding|\/sign-in|\/sign-up|\/discover|\/buyer-search|\/pricing|data-flow|role="search"/);
    expect(html).not.toMatch(/>(Sign up|Log in|Get started|Start selling|Shop)</);
    expect(html).not.toMatch(/<form[^>]+action=/);
  });

  it('reveals inline email forms from two Notify me at launch buttons with consent and no extra fields', () => {
    const reveals = html.match(/<button[^>]*data-reveal[^>]*>Notify me at launch<\/button>/g) ?? [];
    expect(reveals).toHaveLength(2);
    const forms = html.match(/<form id="[^"]+-form" hidden novalidate>[\s\S]*?<\/form>/g) ?? [];
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.match(/<input/g)).toHaveLength(1);
      expect(form).toMatch(/<input[^>]*type="email"[^>]*autocomplete="email"[^>]*required/);
      expect(form).toMatch(/<label class="vh" for="[^"]+-email">Email address<\/label>/);
    }
    expect(html.match(/email you once about our launch/g)).toHaveLength(2);
    expect(html.match(/role="status" aria-live="polite"/g)).toHaveLength(2);
  });

  it('posts {email, source} and shows the exact success copy; errors are announced with retry', () => {
    expect(WAITLIST_SUCCESS).toBe("You're on the list.");
    expect(script).toContain(`var SUCCESS=${JSON.stringify(WAITLIST_SUCCESS)}`);
    expect(script).toContain("method:'POST'");
    expect(script).toContain('JSON.stringify({email:email,source:SOURCE})');
    expect(script).toMatch(/'instagram':'landing'/);
    expect(script).toContain('submit.disabled=true');
    expect(script).toContain("submit.textContent='Try again'");
    expect(script).toMatch(/400:/);
    expect(script).toMatch(/429:/);
    expect(script).toContain("setAttribute('aria-invalid','true')");
  });

  it('drives the waitlist flow end to end against a fake DOM', async () => {
    type El = Record<string, any>;
    const mk = (extra: El = {}): El => {
      const attrs: Record<string, string> = {};
      const listeners: Record<string, Function> = {};
      return {
        hidden: false, disabled: false, readOnly: false, value: '', textContent: '', className: '',
        setAttribute: (k: string, v: string) => { attrs[k] = v; },
        removeAttribute: (k: string) => { delete attrs[k]; },
        getAttribute: (k: string) => attrs[k],
        addEventListener: (t: string, f: Function) => { listeners[t] = f; },
        fire: (t: string) => listeners[t]?.({ preventDefault() {} }),
        focus() {}, attrs, ...extra,
      };
    };
    const input = mk(); const submit = mk(); const reveal = mk(); const consent = mk({ hidden: true }); const status = mk();
    const form = mk({ hidden: true, querySelector: (s: string) => (s === 'input' ? input : submit) });
    const block = mk({ querySelector: (s: string) => ({ '[data-reveal]': reveal, form, '.consent': consent, '.status': status } as El)[s] });
    const calls: any[] = [];
    let respond = { ok: false, status: 503 };
    const ctx = {
      navigator: { userAgent: 'Mozilla Instagram 300' }, location: { search: '' },
      document: { referrer: '', readyState: 'loading', querySelectorAll: (s: string) => (s === '[data-waitlist]' ? [block] : []), querySelector: () => null },
      window: { addEventListener() {} },
      fetch: (url: string, init: any) => { calls.push({ url, init }); return Promise.resolve(respond); },
      setTimeout,
    };
    const vm = await import('node:vm');
    vm.runInNewContext(script, ctx);
    reveal.fire('click');
    expect(form.hidden).toBe(false);
    expect(consent.hidden).toBe(false);
    input.value = 'nope';
    form.fire('submit');
    expect(calls).toHaveLength(0);
    expect(input.attrs['aria-invalid']).toBe('true');
    input.value = ' a@b.co ';
    form.fire('submit');
    expect(submit.disabled).toBe(true);
    form.fire('submit');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/launch-waitlist');
    expect(JSON.parse(calls[0].init.body)).toEqual({ email: 'a@b.co', source: 'instagram' });
    await new Promise((r) => setTimeout(r, 0));
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Try again');
    expect(status.className).toContain('err');
    respond = { ok: true, status: 200 };
    form.fire('submit');
    await new Promise((r) => setTimeout(r, 0));
    expect(status.textContent).toBe("You're on the list.");
    expect(form.hidden).toBe(true);
  });

  it('points the QR code at /welcome', () => {
    expect(QR_FALLBACK_URL).toBe('https://brandthread.app/welcome');
    expect(html).toContain(qrSvg(QR_FALLBACK_URL));
  });

  it('shows the real app capture poster first, video only after load and never on reduced motion', () => {
    const video = html.match(/<video[^>]*>/)?.[0] ?? '';
    for (const attr of ['muted', 'loop', 'playsinline', 'preload="none"', 'poster="/landing-assets/app-capture-poster.jpg"', 'width="540"', 'height="1168"']) {
      expect(video, attr).toContain(attr);
    }
    expect(video).not.toMatch(/\bautoplay\b/);
    expect(html).toContain('<link rel="preload" href="/landing-assets/app-capture-poster.jpg" as="image"');
    expect(html).not.toMatch(/rel="preload"[^>]*\.(mp4|webm)/);
    expect(script).toContain("window.addEventListener('load',onLoad)");
    expect(script).toContain('if(!video||!loaded)return;');
    expect(html).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(html).toContain('<source src="/landing-assets/app-capture.mp4" type="video/mp4" />');
    expect(html).toContain('<source src="/landing-assets/app-capture.webm" type="video/webm" />');
    for (const [name, source] of Object.entries(LANDING_ASSETS)) {
      expect(fs.statSync(path.join(projectRoot, source)).size, name).toBeLessThan(1.5 * 1024 * 1024);
    }
  });

  it('scroll reveals are opt-in via JS and disabled for reduced motion', () => {
    expect(html).toContain('.js .reveal.pre{opacity:0');
    expect(html).toMatch(/prefers-reduced-motion:reduce\)\{[^@]*\.js \.reveal\.pre\{opacity:1;transform:none\}/);
    expect(script).toContain("'IntersectionObserver' in window&&!(motion&&motion.matches)");
  });

  it('fits a 390px screen: single column, full-width form controls', () => {
    const small = html.match(/@media \(max-width:480px\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(small).toContain('.waitlist form{flex-direction:column}');
    expect(small).toContain('.waitlist .btn{width:100%}');
    expect(small).toContain('.pillars{grid-template-columns:1fr}');
    expect(html).toContain('overflow-x:hidden');
  });

  it('carries SEO and social tags', () => {
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/" />');
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card']) expect(html).toContain(tag);
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(JSON.parse(ld)['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['Organization', 'WebSite']);
  });

  it('stays black, white and silver with no emojis, translucent overlays or filler copy', () => {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    for (const [, hex] of css.matchAll(/#([0-9a-f]{3,6})\b/gi)) {
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      expect(full.slice(0, 2) === full.slice(2, 4) && full.slice(2, 4) === full.slice(4, 6), `#${hex} is not grey`).toBe(true);
    }
    expect(css).not.toMatch(/rgba\(|backdrop-filter/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html.toLowerCase()).not.toMatch(/lorem|testimonial|\d+\s?(k|m)?\+?\s*(downloads|users)|stars?\b/);
  });
});

describe('when the landing page replaces the app shell', () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-landing-root-'));
    fs.writeFileSync(path.join(root, 'landing.html'), '<html>landing</html>');
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const decide = (pathname: string, query = '', headers: Record<string, string> = {}, method = 'GET') =>
    shouldServeLanding({
      method,
      pathname,
      searchParams: new URLSearchParams(query),
      headers: { accept: 'text/html', ...headers },
      staticRoot: root,
    });

  it('serves "/" to a plain signed-out browser visit, including campaign tags', () => {
    expect(decide('/')).toBe(true);
    expect(decide('/', 'utm_source=tiktok&fbclid=abc')).toBe(true);
    expect(decide('/', '', { cookie: '__client_uat=0; theme=dark' })).toBe(true);
  });

  it('leaves the app alone for sessions and non-HTML requests', () => {
    expect(decide('/', '', { cookie: '__session=eyJhbGciOi; __client_uat=1730000000' })).toBe(false);
    expect(decide('/', '', { cookie: '__client_uat_xyz=1730000000' })).toBe(false);
    expect(decide('/', '', { accept: 'application/json' })).toBe(false);
    expect(decide('/', '', {}, 'POST')).toBe(false);
    expect(decide('/sign-in')).toBe(false);
    expect(decide('/privacy')).toBe(false);
    expect(decide('/orders/1')).toBe(false);
  });

  it('pre-launch: unknown root queries cannot bypass the landing page', () => {
    expect(decide('/', 'app=1')).toBe(true);
    expect(decide('/', 'code=INVITE')).toBe(true);
    expect(decide('/', 'bt_preview=admin', { host: 'localhost' })).toBe(true);
  });

  it('only explicit bt_preview buyer/seller/guest on development hosts bypass it', () => {
    for (const side of ['buyer', 'seller', 'guest']) {
      expect(decide('/', `bt_preview=${side}`, { host: 'localhost' }), side).toBe(false);
      expect(decide('/', `bt_preview=${side}`, { host: 'brandthread.app' }), side).toBe(true);
    }
  });

  it('always serves /welcome, and falls back to the app when landing.html is missing', () => {
    expect(decide('/welcome', '', { cookie: '__session=abc' })).toBe(true);
    expect(shouldServeLanding({ method: 'GET', pathname: '/', searchParams: new URLSearchParams(), headers: { accept: 'text/html' }, staticRoot: path.join(root, 'missing') })).toBe(false);
  });

  it('detects Clerk session cookies', () => {
    expect(hasClerkSession('')).toBe(false);
    expect(hasClerkSession('__client_uat=0')).toBe(false);
    expect(hasClerkSession('__clerk_db_jwt=abc')).toBe(false);
    expect(hasClerkSession('__session=abc')).toBe(true);
    expect(hasClerkSession('a=b; __client_uat=12345')).toBe(true);
  });
});

describe('server integration', () => {
  let child: ReturnType<typeof spawn>;
  let root: string;
  const port = 39000 + Math.floor(Math.random() * 500);

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-landing-srv-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head><body>APP SHELL</body></html>');
    const landing = writeLandingPage(root, projectRoot, {});
    // Match the production export: public default document plus a separate
    // Expo shell for authenticated entry and non-root app routes.
    fs.copyFileSync(path.join(root, 'index.html'), path.join(root, 'app-shell.html'));
    fs.writeFileSync(path.join(root, 'index.html'), landing);
    child = spawn(process.execPath, [path.join(projectRoot, 'server', 'serve.js')], {
      env: { ...process.env, PORT: String(port), EXPO_WEB_BUILD_DIR: root },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/status`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
  afterAll(() => {
    child?.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { headers: { accept: 'text/html', ...headers } });
    return { status: res.status, body: await res.text() };
  };

  it('ships the pre-launch page as the production default document without app-entry links', async () => {
    const body = (await get('/index.html')).body;
    expect(body).toContain('Notify me at launch');
    expect(body).toContain('/api/launch-waitlist');
    expect(body).not.toMatch(/href=["']\/(?:onboarding|sign-in|pricing)(?:["'?#/])/);
    expect((await get('/inbox')).body).toContain('APP SHELL');
    const build = fs.readFileSync(path.join(projectRoot, 'scripts/build-web.js'), 'utf8');
    expect(build).toContain('if (!workspacePreview)');
    expect(build).toContain("fs.writeFileSync(path.join(outputDir, 'index.html'), landingHtml)");
  });

  it('shows the landing page signed out and the unchanged app shell otherwise', async () => {
    expect((await get('/')).body).toContain('Shop, sell and design streetwear.');
    expect((await get('/welcome')).body).toContain('Notify me at launch');
    expect((await get('/', { cookie: '__session=abc' })).body).toContain('APP SHELL');
    expect((await get('/?bt_preview=buyer', { host: `localhost:${port}` })).body).toContain('APP SHELL');
    expect((await get('/?app=1')).body).toContain('Shop, sell and design streetwear.');
    expect((await get('/sign-in')).body).toContain('APP SHELL');
    const mp4 = fs.readdirSync(path.join(root, ASSET_DIR)).find((f) => f.endsWith('.mp4'))!;
    const full = await fetch(`http://127.0.0.1:${port}/${ASSET_DIR}/${mp4}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    // Safari probes video with a byte range and needs a 206.
    const probe = await fetch(`http://127.0.0.1:${port}/${ASSET_DIR}/${mp4}`, { headers: { range: 'bytes=0-1' } });
    expect(probe.status).toBe(206);
    expect(probe.headers.get('content-range')).toMatch(/^bytes 0-1\/\d+$/);
    expect((await probe.arrayBuffer()).byteLength).toBe(2);
    const bad = await fetch(`http://127.0.0.1:${port}/${ASSET_DIR}/${mp4}`, { headers: { range: 'bytes=999999999-' } });
    expect(bad.status).toBe(416);
  });

  it('keeps fast-preview app access and serves every local Inter face inside its mount', async () => {
    const previewPort = port + 1;
    const preview = spawn(process.execPath, [path.join(projectRoot, 'server', 'serve.js')], {
      env: { ...process.env, PORT: String(previewPort), BASE_PATH: '/fast-preview', EXPO_WEB_BUILD_DIR: root },
      stdio: 'ignore',
    });
    const origin = `http://127.0.0.1:${previewPort}`;
    try {
      for (let i = 0; i < 50; i++) {
        try { await fetch(`${origin}/status`); break; }
        catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      expect(await (await fetch(`${origin}/fast-preview/`, { headers: { accept: 'text/html' } })).text()).toContain('APP SHELL');
      const html = await (await fetch(`${origin}/fast-preview/welcome`)).text();
      expect(html).not.toMatch(/url\(\/landing-assets\//);
      const fontUrls = [...html.matchAll(/url\((\/fast-preview\/landing-assets\/inter-\d+\.[a-f0-9]+\.ttf)\)/g)];
      expect(fontUrls).toHaveLength(3);
      for (const [, url] of fontUrls) {
        const response = await fetch(`${origin}${url}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('font/ttf');
        expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 4)]).toEqual([0, 1, 0, 0]);
      }
    } finally { preview.kill(); }
  });
});
