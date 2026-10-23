import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { prelaunchAction, isPublicAppSealed } = require('../server/prelaunchGate.cjs');
const { writeLandingPage } = require('./landing-page');
const { writePrelaunchLegalPages } = require('./prelaunch-legal');
const root = path.resolve(__dirname, '..');
const production = { NODE_ENV: 'production', PUBLIC_APP_ENABLED: 'false' } as const;

describe('production-only public app seal', () => {
  it.each(['/login', '/signup', '/sign-in', '/onboarding', '/feed', '/inbox',
    '/profile', '/pricing', '/welcome', '/fast-preview', '/fast-preview/inbox',
    '/app-shell.html', '/index.html', '/_expo/static/js/web/app.js',
    '/store/brandthread', '/manufacturers/', '/app-tour/', '/healthz',
    '/.well-known/anything-else'])('redirects %s before serving an app surface', route => {
    expect(prelaunchAction(route, production, { cookie: '__session=anything' })).toBe('redirect');
  });
  it('serves only the cover and standalone legal documents', () => {
    expect(prelaunchAction('/', production)).toBe('cover');
    expect(prelaunchAction('/privacy', production)).toBe('legal');
    expect(prelaunchAction('/terms/', production)).toBe('legal');
  });
  it.each(['/api/launch-waitlist', '/api/webhooks/stripe', '/api/healthz',
    '/ws/live', '/status', '/.well-known/apple-app-site-association',
    '/landing-assets/inter-400.hash.ttf', '/landing-assets/app-capture.hash.mp4',
    '/brandthread-logo.png'])('keeps infrastructure and cover assets reachable: %s', route => {
    expect(prelaunchAction(route, production)).toBeNull();
  });
  it('opens all services with one flag, including authenticated app routes', () => {
    expect(isPublicAppSealed({ ...production, PUBLIC_APP_ENABLED: 'true' })).toBe(false);
    expect(prelaunchAction('/feed', { ...production, PUBLIC_APP_ENABLED: 'true' })).toBeNull();
  });
  it('never gates workspace dev or fast preview, even with the shared flag off', () => {
    for (const route of ['/feed', '/fast-preview/inbox', '/manufacturers/']) {
      expect(prelaunchAction(route, { NODE_ENV: 'development', REPLIT_ENVIRONMENT: 'production', PUBLIC_APP_ENABLED: 'false' },
        { host: 'workspace.riker.replit.dev' })).toBeNull();
    }
  });
  it('recognizes the published domain even if NODE_ENV was omitted', () => {
    expect(prelaunchAction('/feed', {}, { host: 'brandthread.app' })).toBe('redirect');
    expect(prelaunchAction('/feed', {}, { host: 'brandthread.replit.app' })).toBe('redirect');
  });
});

describe('sealed production HTTP serving', () => {
  let child: ReturnType<typeof spawn>;
  let output: string;
  const port = 40500 + Math.floor(Math.random() * 400);
  beforeAll(async () => {
    output = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-sealed-'));
    fs.writeFileSync(path.join(output, 'index.html'), 'APP SHELL');
    fs.writeFileSync(path.join(output, 'app-shell.html'), 'APP SHELL');
    writeLandingPage(output, root, {});
    writePrelaunchLegalPages(output, root);
    child = spawn(process.execPath, [path.join(root, 'server/serve.js')], {
      env: { ...process.env, ...production, PORT: String(port), BASE_PATH: '/', EXPO_WEB_BUILD_DIR: output },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try { await fetch(`http://127.0.0.1:${port}/status`); return; } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw new Error('Production test server did not start');
  });
  afterAll(() => {
    child?.kill();
    fs.rmSync(output, { recursive: true, force: true });
  });
  const get = (route: string) => fetch(`http://127.0.0.1:${port}${route}`, {
    redirect: 'manual', headers: { cookie: '__session=fixture', accept: 'text/html' },
  });
  it('ignores cookies and preview query overrides at the public root', async () => {
    const res = await get('/?bt_preview=buyer&app=1');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Notify me at launch');
    expect(html).not.toContain('APP SHELL');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(links.filter(href => href.startsWith('/') && !href.startsWith('/landing-assets/')))
      .toEqual(expect.arrayContaining(['/privacy', '/terms']));
    expect(links).not.toContain('/community-guidelines');
    expect(links).not.toContain('mailto:support@brandthread.app');
  });
  it.each(['/login', '/signup', '/feed?bt_preview=seller', '/welcome', '/index.html',
    '/app-shell.html', '/fast-preview/inbox', '/manufacturers/', '/app-tour/'])('redirects %s without cacheable bypasses', async route => {
    const res = await get(route);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['/privacy', '/terms'])('serves %s without any SPA scripts or app-entry links', async route => {
    const res = await get(route);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toMatch(/<script|APP SHELL|\/_expo\//);
    expect(html).not.toContain('[LAWYER REVIEW]');
    expect(html).toContain(route === '/privacy' ? 'Privacy Policy' : 'Terms of Service');
    expect(html.length).toBeGreaterThan(5_000);
  });
  it('does not redirect API requests into an HTML cover', async () => {
    const res = await get('/api/a-missing-endpoint');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
  it('does not leak the SPA for a missing allowed asset', async () => {
    const res = await get('/landing-assets/missing.jpg');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('APP SHELL');
  });
  it('opens the production app shell when the single launch flag is flipped', async () => {
    const openPort = port + 1;
    const opened = spawn(process.execPath, [path.join(root, 'server/serve.js')], {
      env: { ...process.env, ...production, PUBLIC_APP_ENABLED: 'true',
        PORT: String(openPort), BASE_PATH: '/', EXPO_WEB_BUILD_DIR: output },
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 60; i++) {
        try { await fetch(`http://127.0.0.1:${openPort}/status`); break; } catch {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      for (const route of ['/', '/feed']) {
        const res = await fetch(`http://127.0.0.1:${openPort}${route}`, {
          redirect: 'manual', headers: { accept: 'text/html' },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('APP SHELL');
      }
    } finally { opened.kill(); }
  });
});
