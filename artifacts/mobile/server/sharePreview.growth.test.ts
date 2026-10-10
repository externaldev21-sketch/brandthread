import { afterEach, describe, expect, it, vi } from 'vitest';

const { renderSharePreview } = require('./sharePreview.js');

const SHELL = '<!doctype html><html><head><title>Brandthread</title></head><body></body></html>';

function routeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const hit = Object.entries(routes).find(([suffix]) => String(url).endsWith(suffix));
    const { status, body } = hit ? hit[1] : { status: 404, body: null };
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }));
  return calls;
}

describe('share previews for growth links (BT-314/320)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the API share-preview photo for products, never a private /objects/ path', async () => {
    routeFetch({
      '/public/products/p1/share-preview': {
        status: 200,
        body: { name: 'Aurora Hoodie', priceCents: 4500, sellerName: 'Northline', imageUrl: 'https://brandthread.app/api/v1/public/media/products/p1/0' },
      },
    });
    const r = await renderSharePreview('/store/product/p1', SHELL);
    expect(r.status).toBe(200);
    expect(r.html).toContain('Aurora Hoodie — $45.00');
    expect(r.html).toContain('og:image" content="https://brandthread.app/api/v1/public/media/products/p1/0"');
    expect(r.html).toContain('Shop Aurora Hoodie from Northline on Brandthread.');
  });

  it('falls back to the public product (older API), and drops a non-https photo', async () => {
    const calls = routeFetch({
      '/public/products/p2': { status: 200, body: { name: 'Tee', images: ['/objects/uploads/x'], variants: [{ priceCents: 2000 }] } },
    });
    const r = await renderSharePreview('/store/product/p2', SHELL);
    expect(calls.some((u) => u.endsWith('/public/products/p2/share-preview'))).toBe(true);
    expect(r.html).toContain('Tee — $20.00');
    expect(r.html).toContain('og:image" content="https://brandthread.app/brandthread-logo.png"');
    expect(r.html).not.toContain('/objects/');
  });

  it('404s + noindex only when the product is really gone', async () => {
    routeFetch({});
    const r = await renderSharePreview('/store/product/p3', SHELL);
    expect(r.status).toBe(404);
    expect(r.html).toContain('noindex');
  });

  it('unfurls a live link with the host and LIVE now', async () => {
    const id = '3f1a2b4c-1111-4222-8333-944455556666';
    routeFetch({ [`/public/live/${id}/share-preview`]: { status: 200, body: { hostName: 'Northline', title: 'Fall drop', live: true, imageUrl: null } } });
    const r = await renderSharePreview(`/live/${id}`, SHELL);
    expect(r.html).toContain('Northline is LIVE now');
    expect(r.html).toContain('Fall drop');
    expect(r.html).toContain(`https://brandthread.app/live/${id}`);
  });

  it('says a live has ended instead of LIVE now', async () => {
    const id = '3f1a2b4c-1111-4222-8333-944455556667';
    routeFetch({ [`/public/live/${id}/share-preview`]: { status: 200, body: { hostName: 'Northline', title: null, live: false, imageUrl: null } } });
    const r = await renderSharePreview(`/live/${id}`, SHELL);
    expect(r.html).toContain('Northline on Brandthread');
    expect(r.html).not.toContain('LIVE now');
  });
});
