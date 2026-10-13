/**
 * serve.js wiring for the SEO surfaces: robots.txt / sitemaps / .well-known
 * win over the build's static files, /new is server-rendered, product pages
 * get the full SEO treatment with a fallback to the share card, and the App
 * Clip banner is only added when configured.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const SHELL = `<!doctype html><html><head><title>Brandthread</title><meta property="og:image" content="https://brandthread.app/brandthread-logo.png" /></head><body><div id="root"></div></body></html>`;
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
let dir = "";
let server: { emit: (event: string, req: unknown, res: unknown) => void };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-serve-seo-"));
  fs.writeFileSync(path.join(dir, "index.html"), SHELL);
  fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /static-only\n");
  fs.writeFileSync(path.join(dir, "sitemap.xml"), '<urlset><url><loc>https://brandthread.app/privacy</loc></url></urlset>');
  vi.stubEnv("EXPO_WEB_BUILD_DIR", dir);
  vi.resetModules();
  server = require("./serve.js").server;
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APPLE_APP_STORE_ID;
  delete process.env.APP_CLIP_BUNDLE_ID;
});

function request(url: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve) => {
    let status = 0;
    let responseHeaders: Record<string, string> = {};
    server.emit("request", { url, method, headers: { host: "brandthread.app", ...headers } }, {
      writeHead(nextStatus: number, nextHeaders: Record<string, string> = {}) {
        status = nextStatus;
        responseHeaders = nextHeaders;
      },
      end(chunk?: string | Buffer) {
        resolve({ status, headers: responseHeaders, body: chunk ? String(chunk) : "" });
      },
    });
  });
}

function mockApi(routes: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[key] };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("serve.js SEO routes", () => {
  it("serves the dynamic robots.txt instead of the static one", async () => {
    const r = await request("/robots.txt");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.body).toContain("Sitemap: https://brandthread.app/sitemap.xml");
    expect(r.body).not.toContain("/static-only");
  });

  it("serves a sitemap index and a pages sitemap built from the static one plus /new", async () => {
    const index = await request("/sitemap.xml");
    expect(index.body).toContain("<sitemapindex");
    const pages = await request("/sitemap-pages.xml");
    expect(pages.body).toContain("<loc>https://brandthread.app/privacy</loc>");
    expect(pages.body).toContain("<loc>https://brandthread.app/new</loc>");
  });

  it("proxies the apple-app-site-association file on the site root", async () => {
    mockApi({ "/public/well-known/apple-app-site-association": { applinks: { apps: [], details: [] } } });
    const r = await request("/.well-known/apple-app-site-association");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(r.body)).toEqual({ applinks: { apps: [], details: [] } });
  });

  it("server-renders /new for every visitor (no SPA shell)", async () => {
    mockApi({ "/public/new-this-week": { windowStart: "2026-10-06T00:00:00Z", windowEnd: "2026-10-13T00:00:00Z", total: 0, items: [] } });
    const r = await request("/new", { accept: "text/html", cookie: "__session=abc" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.body).toContain("No new pieces this week.");
    expect(r.body).not.toContain('<div id="root">');
  });

  it("renders product pages with Product JSON-LD", async () => {
    mockApi({ [`/public/seo/products/${ID}`]: { id: ID, name: "Hoodie", title: "Hoodie – Nova", images: [], brand: "Nova", sku: ID, noIndex: false, currency: "USD", price: { lowCents: 4500, highCents: 4500, offerCount: 1 }, availability: "InStock" } });
    const r = await request(`/store/product/${ID}`, { accept: "text/html" });
    expect(r.status).toBe(200);
    expect(r.body).toContain('"@type":"Product"');
    expect(r.body).toContain('<div id="root"></div>');
    expect(r.body).not.toContain("apple-itunes-app");
  });

  it("falls back to the existing product share card when the SEO endpoint is unavailable", async () => {
    mockApi({ [`/public/products/${ID}`]: { name: "Hoodie", variants: [{ priceCents: 4500 }] } });
    const r = await request(`/store/product/${ID}`, { accept: "text/html" });
    expect(r.status).toBe(200);
    expect(r.body).toContain("Hoodie — $45.00");
    expect(r.body).not.toContain("application/ld+json");
  });

  it("adds the App Clip card meta on product pages only when configured", async () => {
    process.env.APPLE_APP_STORE_ID = "1234567890";
    process.env.APP_CLIP_BUNDLE_ID = "com.brandthread.mobile.Clip";
    mockApi({ [`/public/seo/products/${ID}`]: { id: ID, name: "Hoodie", images: [], price: null, availability: "InStock" } });
    const r = await request(`/store/product/${ID}`, { accept: "text/html" });
    expect(r.body).toContain('<meta name="apple-itunes-app" content="app-id=1234567890, app-clip-bundle-id=com.brandthread.mobile.Clip, app-clip-display=card');
    const settings = await request("/settings", { accept: "text/html" });
    expect(settings.body).not.toContain("apple-itunes-app");
  });
});
