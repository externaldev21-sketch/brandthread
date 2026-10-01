import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const {
  PENDING_FLOW_KEY,
  ROUTES,
  renderLandingHtml,
  resolveStoreUrl,
  writeLandingPage,
} = require('./landing-page.js') as {
  PENDING_FLOW_KEY: string;
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
      expect(fs.existsSync(path.join(dir, 'landing-fonts', 'Inter_400Regular.ttf'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('landing page content', () => {
  const html = renderLandingHtml({ appStoreUrl: APP_STORE, playStoreUrl: PLAY_STORE });

  it('is static: no API calls, no external scripts or requests', () => {
    expect(html).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\/api\//);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    const externalResources = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
      .map((m) => new URL(m[1]).hostname)
      .filter((host) => !['brandthread.app', 'apps.apple.com', 'play.google.com'].includes(host));
    expect(externalResources).toEqual([]);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });

  it('links to real app routes', () => {
    const appDir = path.join(projectRoot, 'app');
    for (const route of [ROUTES.signUp, ROUTES.signIn, ROUTES.privacy, ROUTES.terms, ROUTES.guidelines]) {
      expect(html).toContain(`href="${route}"`);
      expect(fs.existsSync(path.join(appDir, `${route.slice(1)}.tsx`)), route).toBe(true);
    }
    expect(html).toContain('href="mailto:support@brandthread.app"');
    expect(html).toContain('Start selling');
  });

  it('uses the same pending-flow key the onboarding screen reads', () => {
    const onboarding = fs.readFileSync(path.join(projectRoot, 'app', 'onboarding.tsx'), 'utf8');
    expect(onboarding).toContain(`const PENDING_FLOW_KEY = '${PENDING_FLOW_KEY}'`);
    expect(html).toContain(`localStorage.setItem("${PENDING_FLOW_KEY}"`);
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
    expect((await get('/landing-fonts/Inter_400Regular.ttf')).status).toBe(200);
  });
});
