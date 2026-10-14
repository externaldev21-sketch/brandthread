import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const {
  ASSET_DIR,
  LANDING_ASSETS,
  PENDING_FLOW_KEY,
  PREFILL_EMAIL_KEY,
  QR_FALLBACK_URL,
  ROUTES,
  STATS_ENDPOINT,
  qrSvg,
  renderLandingHtml,
  resolveStoreUrl,
  writeLandingPage,
} = require('./landing-page.js') as {
  ASSET_DIR: string;
  LANDING_ASSETS: Record<string, string>;
  PENDING_FLOW_KEY: string;
  PREFILL_EMAIL_KEY: string;
  QR_FALLBACK_URL: string;
  STATS_ENDPOINT: string;
  qrSvg: (text: string) => string;
  ROUTES: Record<string, string>;
  renderLandingHtml: (options?: { appStoreUrl?: string | null; playStoreUrl?: string | null }) => string;
  resolveStoreUrl: (value: unknown, kind: 'appStore' | 'playStore') => string | null;
  writeLandingPage: (outDir: string, root: string, env?: Record<string, string | undefined>) => string;
};
const { hasClerkSession, shouldServeLanding } = require('../server/landing.js') as {
  hasClerkSession: (cookie?: string) => boolean;
  shouldServeLanding: (args: Record<string, unknown>) => boolean;
};

const APP_STORE = 'https://apps.apple.com/us/app/brandthread/id1234567890';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.brandthread.mobile';

describe('store badge URLs come from env and are validated', () => {
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

  it('hides both badges when the env vars are missing and never throws', () => {
    const html = renderLandingHtml();
    expect(html).not.toContain('App Store');
    expect(html).not.toContain('Google Play');
    expect(html).not.toContain('class="badges"');
    expect(html).not.toContain('installUrl');
  });

  it('shows only the badge whose URL is set', () => {
    const appOnly = renderLandingHtml({ appStoreUrl: APP_STORE });
    expect(appOnly).toContain(`href="${APP_STORE}"`);
    expect(appOnly).not.toContain('Google Play');
    const playOnly = renderLandingHtml({ playStoreUrl: PLAY_STORE });
    expect(playOnly).toContain('Google Play');
    expect(playOnly).not.toContain('>App Store<');
    const both = renderLandingHtml({ appStoreUrl: APP_STORE, playStoreUrl: PLAY_STORE });
    expect(both).toContain('installUrl');
  });

  it('reads EXPO_PUBLIC_APP_STORE_URL and EXPO_PUBLIC_PLAY_STORE_URL at build time', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-landing-'));
    try {
      const html = writeLandingPage(dir, projectRoot, {
        EXPO_PUBLIC_APP_STORE_URL: APP_STORE,
        EXPO_PUBLIC_PLAY_STORE_URL: 'https://example.com/nope',
      });
      expect(html).toContain(APP_STORE);
      expect(html).not.toContain('Google Play');
      expect(fs.existsSync(path.join(dir, 'landing.html'))).toBe(true);
      // Media is published under content-hashed names (static files are immutable).
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

describe('landing page content', () => {
  const html = renderLandingHtml({ appStoreUrl: APP_STORE, playStoreUrl: PLAY_STORE });

  it('makes one same-origin stats request and no other calls, external scripts or requests', () => {
    const fetches = [...html.matchAll(/\bfetch\s*\(([^,)]+)/g)].map((m) => m[1]);
    expect(fetches).toEqual([JSON.stringify(STATS_ENDPOINT)]);
    expect(STATS_ENDPOINT).toBe('/api/v1/public/stats');
    expect(html.match(/\/api\//g)).toHaveLength(1);
    expect(html).not.toMatch(/XMLHttpRequest|WebSocket|sendBeacon/);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    const externalResources = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
      .map((m) => new URL(m[1]).hostname)
      .filter((host) => !['brandthread.app', 'apps.apple.com', 'play.google.com'].includes(host));
    expect(externalResources).toEqual([]);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });

  it('links to real app routes', () => {
    const appDir = path.join(projectRoot, 'app');
    for (const route of [ROUTES.signUp, ROUTES.signIn, ROUTES.pricing, ROUTES.privacy, ROUTES.terms, ROUTES.guidelines]) {
      expect(html).toContain(`href="${route}"`);
      expect(route === '/pricing' || fs.existsSync(path.join(appDir, `${route.slice(1)}.tsx`)), route).toBe(true);
    }
    expect(html).toContain(`href="${ROUTES.shop}"`);
    expect(fs.existsSync(path.join(appDir, '(buyer)', 'discover.tsx'))).toBe(true);
    expect(html).toMatch(new RegExp(`<form class="search" role="search" action="${ROUTES.search}" method="get">`));
    expect(fs.existsSync(path.join(appDir, `${ROUTES.search.slice(1)}.tsx`))).toBe(true);
    // Shop and the search pill must work signed out.
    const guest = fs.readFileSync(path.join(projectRoot, 'lib', 'guestRoutes.ts'), 'utf8');
    expect(guest).toContain("'discover'");
    expect(guest).toContain("'buyer-search'");
    for (const label of ['Shop', 'Sell', 'Pricing', 'Log in', 'Sign up', 'Get started']) expect(html).toContain(`>${label}<`);
    expect(html).toContain('href="mailto:support@brandthread.app"');
    expect(html).toContain('Start selling');
  });

  it('uses the same pending-flow key the onboarding screen reads', () => {
    const onboarding = fs.readFileSync(path.join(projectRoot, 'app', 'onboarding.tsx'), 'utf8');
    expect(onboarding).toContain(`const PENDING_FLOW_KEY = '${PENDING_FLOW_KEY}'`);
    expect(html).toContain(`remember(${JSON.stringify(PENDING_FLOW_KEY)}`);
    // Every "Start selling"/"Sell" link writes the seller flow; Get started the buyer one.
    for (const a of [...html.matchAll(/<a [^>]*>(?:Sell|Start selling)\b/g)].map((m) => m[0])) expect(a).toContain('data-flow="seller"');
    expect(html).toMatch(/<form class="signup"[^>]*data-flow="buyer"/);
  });

  it('hands the typed email to onboarding in storage, never in the URL', () => {
    const onboarding = fs.readFileSync(path.join(projectRoot, 'app', 'onboarding.tsx'), 'utf8');
    expect(onboarding).toContain(`const PREFILL_EMAIL_KEY = '${PREFILL_EMAIL_KEY}'`);
    expect(onboarding).toContain('AsyncStorage.getItem(PREFILL_EMAIL_KEY)');
    expect(onboarding).toContain('setEmail((current) => current || trimmed)');
    expect(html).toContain(`remember(${JSON.stringify(PREFILL_EMAIL_KEY)},email)`);
    const input = html.match(/<input id="signup-email"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('type="email"');
    expect(input).not.toMatch(/\bname=/);
    expect(html).toMatch(/<form class="signup" action="\/onboarding" method="get"/);
  });

  it('points the QR code at the App Store when configured, else at /welcome', () => {
    expect(html).toContain(qrSvg(APP_STORE));
    const fallback = renderLandingHtml();
    expect(QR_FALLBACK_URL).toBe('https://brandthread.app/welcome');
    expect(fallback).toContain(qrSvg(QR_FALLBACK_URL));
    expect(fallback).toContain('Download the Brandthread app');
    expect(qrSvg(APP_STORE)).not.toBe(qrSvg(QR_FALLBACK_URL));
  });

  it('shows the real app capture: muted, looping, inline, poster first, never on reduced motion', () => {
    const video = html.match(/<video[^>]*>/)?.[0] ?? '';
    for (const attr of ['muted', 'loop', 'playsinline', 'preload="none"', 'poster="/landing-assets/app-capture-poster.jpg"', 'width="540"', 'height="1168"']) {
      expect(video, attr).toContain(attr);
    }
    // Started from script so reduced-motion visitors (and no-JS) keep the still.
    expect(video).not.toMatch(/\bautoplay\b/);
    expect(html).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(html).toContain('<source src="/landing-assets/app-capture.mp4" type="video/mp4" />');
    expect(html).toContain('<source src="/landing-assets/app-capture.webm" type="video/webm" />');
    for (const [name, source] of Object.entries(LANDING_ASSETS)) {
      const size = fs.statSync(path.join(projectRoot, source)).size;
      expect(size, name).toBeLessThan(1.5 * 1024 * 1024);
    }
  });

  it('shows only real marketplace numbers, hidden until the stats endpoint answers', () => {
    expect(html).toMatch(/<div class="numbers" data-stats hidden>/);
    for (const key of ['brands', 'piecesListed', 'ordersShipped']) expect(html).toContain(`<dd data-stat="${key}"></dd>`);
    // No digits are baked into the numbers row.
    const row = html.match(/<div class="numbers"[\s\S]*?<\/dl>/)?.[0] ?? '';
    expect(row).not.toMatch(/\d/);
    const discovery = fs.readFileSync(path.join(projectRoot, '..', 'api-server', 'src', 'routes', 'discovery.ts'), 'utf8');
    expect(discovery).toContain('router.get("/stats"');
    for (const key of ['brands', 'piecesListed', 'ordersShipped']) expect(discovery).toContain(`${key}:`);
    for (const label of ['Apple Pay', 'Klarna &amp; Afterpay where offered', 'Free returns where offered', 'Ships from the brand']) expect(html).toContain(label);
  });

  it('carries SEO, social and structured data consistent with the existing web export', () => {
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/" />');
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card']) expect(html).toContain(tag);
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const graph = JSON.parse(ld)['@graph'].map((node: { '@type': string }) => node['@type']);
    expect(graph).toEqual(['Organization', 'WebSite', 'MobileApplication']);
  });

  it('stays black, white and silver with no translucent overlays or filler copy', () => {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    for (const [, hex] of css.matchAll(/#([0-9a-f]{3,6})\b/gi)) {
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      expect(full.slice(0, 2) === full.slice(2, 4) && full.slice(2, 4) === full.slice(4, 6), `#${hex} is not grey`).toBe(true);
    }
    expect(css).not.toMatch(/rgba\(|backdrop-filter|opacity\s*:\s*0?\.\d/);
    expect(html.toLowerCase()).not.toMatch(/coming soon|lorem|testimonial|\d+\s?(k|m)?\+?\s*(downloads|users)|stars?\b/);
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

  it('leaves the app alone for sessions, previews, deep links and non-HTML requests', () => {
    expect(decide('/', '', { cookie: '__session=eyJhbGciOi; __client_uat=1730000000' })).toBe(false);
    expect(decide('/', '', { cookie: '__client_uat_xyz=1730000000' })).toBe(false);
    expect(decide('/', 'bt_preview=seller')).toBe(false);
    expect(decide('/', 'code=INVITE')).toBe(false);
    expect(decide('/', 'app=1')).toBe(false);
    expect(decide('/', '', { accept: 'application/json' })).toBe(false);
    expect(decide('/', '', {}, 'POST')).toBe(false);
    expect(decide('/sign-in')).toBe(false);
    expect(decide('/privacy')).toBe(false);
    expect(decide('/orders/1')).toBe(false);
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
    writeLandingPage(root, projectRoot, {});
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

  it('shows the landing page signed out and the unchanged app shell otherwise', async () => {
    expect((await get('/')).body).toContain('Shop, sell and design streetwear.');
    expect((await get('/welcome')).body).toContain('Start selling');
    expect((await get('/', { cookie: '__session=abc' })).body).toContain('APP SHELL');
    expect((await get('/?bt_preview=buyer')).body).toContain('APP SHELL');
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
});
