import { afterEach, describe, expect, it, vi } from 'vitest';

const { dynamicSitemap, resetSitemapCacheForTests } = require('./sitemap.js');
const { server } = require('./serve.js');

const XML = '<?xml version="1.0"?><urlset><url><loc>https://brandthread.app/store/product/p1</loc></url></urlset>';

function get(url: string) {
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve) => {
    let status = 0;
    let headers: Record<string, string> = {};
    server.emit('request', { url, headers: { host: 'brandthread.app' }, method: 'GET' }, {
      writeHead(s: number, h: Record<string, string> = {}) { status = s; headers = h; },
      end(chunk?: string) { resolve({ status, headers, body: String(chunk ?? '') }); },
    });
  });
}

describe('dynamic sitemap at /sitemap.xml (BT-315)', () => {
  afterEach(() => { vi.unstubAllGlobals(); resetSitemapCacheForTests(); });

  it('serves the API sitemap with products, stores and profiles', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, text: async () => XML }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.body).toContain('/store/product/p1');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/public\/sitemap\.xml$/);
  });

  it('caches for an hour and keeps the last good copy when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => XML })));
    expect(await dynamicSitemap(1000)).toBe(XML);
    const failing = vi.fn(async () => { throw new Error('down'); });
    vi.stubGlobal('fetch', failing);
    expect(await dynamicSitemap(2000)).toBe(XML);
    expect(failing).not.toHaveBeenCalled();
    expect(await dynamicSitemap(1000 + 2 * 60 * 60 * 1000)).toBe(XML);
  });

  it('returns null (static fallback) when the API never answered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));
    expect(await dynamicSitemap()).toBeNull();
  });
});
