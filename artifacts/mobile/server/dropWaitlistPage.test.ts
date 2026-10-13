import { afterEach, describe, expect, it, vi } from "vitest";

const page = require("./dropWaitlistPage.js") as {
  renderDropWaitlistPage: (data: unknown, opts: { nonce: string; origin?: string; now?: number }) => string;
  renderNotFoundPage: () => string;
  matchDropWaitlistPath: (p: string) => string | null;
  handleDropWaitlistRequest: (h: string, o: { apiBase: string; origin: string }) => Promise<{ status: number; html: string; headers: Record<string, string> }>;
  formatLaunch: (iso: string, tz: string) => string | null;
};
const { server } = require("./serve.js") as {
  server: { emit: (event: string, request: unknown, response: unknown) => void };
};

const NOW = Date.parse("2026-10-13T12:00:00Z");
const UPCOMING = {
  brand: { name: "Nova <Studio>", handle: "nova", avatarUrl: "https://cdn.test/a.jpg" },
  drop: {
    id: "11111111-1111-4111-8111-111111111111",
    name: 'Summer "Capsule" </script><script>alert(1)</script>',
    releaseAt: "2026-10-15T16:04:05Z",
    heroImageUrl: "https://cdn.test/hero.jpg",
    launchTimezone: "America/New_York",
  },
  state: "upcoming",
  waitlistOpen: true,
  consentText: "By joining you agree to get texts from Nova <Studio> via Brandthread about this drop. Msg & data rates may apply. Reply STOP to opt out.",
};

describe("drop waitlist page renderer", () => {
  it("renders an upcoming drop with countdown, form, consent and meta", () => {
    const html = page.renderDropWaitlistPage(UPCOMING, { nonce: "abc123", now: NOW });
    expect(html).toContain('<script nonce="abc123">');
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/@nova/drop">');
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/hero.jpg">');
    expect(html).toContain('twitter:card" content="summary_large_image"');
    expect(html).toContain("Drops Thu, Oct 15, 12:04 PM EDT");
    // 2d 4h 4m 5s from NOW
    expect(html).toMatch(/data-u="d">02<.*data-u="h">04<.*data-u="m">04<.*data-u="s">05</s);
    expect(html).toContain('id="phone"');
    expect(html).toContain('value="+1"');
    expect(html).toContain("texts from Nova &lt;Studio&gt; via Brandthread about this drop. Msg &amp; data rates may apply. Reply STOP to opt out.");
    expect(html).toContain(">Notify me</button>");
    expect(html).toContain("/api/v1/public/drop-waitlist/nova");
    expect(html).not.toContain("noindex");
  });

  it("escapes brand and drop names everywhere, including the inline script config", () => {
    const html = page.renderDropWaitlistPage(UPCOMING, { nonce: "n", now: NOW });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("Nova <Studio>");
    expect(html).toContain("Summer &quot;Capsule&quot; &lt;/script&gt;");
    // Only the one nonce'd script tag is ever opened.
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("drops non-https image URLs", () => {
    const html = page.renderDropWaitlistPage({
      ...UPCOMING,
      brand: { ...UPCOMING.brand, avatarUrl: "javascript:alert(1)" },
      drop: { ...UPCOMING.drop, heroImageUrl: "http://insecure.test/x.jpg" },
    }, { nonce: "n", now: NOW });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("insecure.test");
    expect(html).toContain("brandthread-logo.png");
  });

  it("shows the Shop button instead of the form when the drop is live", () => {
    const html = page.renderDropWaitlistPage({ ...UPCOMING, state: "live", waitlistOpen: false }, { nonce: "n", now: NOW });
    expect(html).toContain('href="/drops/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain("Shop the drop");
    expect(html).toContain(">LIVE<");
    expect(html).not.toContain('id="join"');
    expect(html).not.toContain("<script");
  });

  it("offers the waitlist for the brand's next drop when none is scheduled", () => {
    const html = page.renderDropWaitlistPage({
      brand: { name: "Empty Co", handle: "emptyco", avatarUrl: null },
      drop: null,
      state: "none",
      waitlistOpen: true,
      consentText: "By joining you agree to get texts from Empty Co via Brandthread about their next drop. Msg & data rates may apply. Reply STOP to opt out.",
    }, { nonce: "n", now: NOW });
    expect(html).toContain("Empty Co's next drop</h1>");
    expect(html).not.toContain('id="countdown"');
    expect(html).toContain('id="join"');
    expect(html).toContain("about their next drop");
  });

  it("renders a noindex 404 page", () => {
    const html = page.renderNotFoundPage();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("isn&#39;t available");
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(page.formatLaunch("2026-10-15T16:04:05Z", "Not/AZone")).toContain("UTC");
  });
});

describe("drop waitlist path matching", () => {
  it("matches /@handle/drop only", () => {
    expect(page.matchDropWaitlistPath("/@Nova_Studio/drop")).toBe("Nova_Studio");
    expect(page.matchDropWaitlistPath("/@nova/drop/")).toBe("nova");
    expect(page.matchDropWaitlistPath("/@no/drop")).toBeNull();
    expect(page.matchDropWaitlistPath("/@nova-studio/drop")).toBeNull();
    expect(page.matchDropWaitlistPath("/@nova/drops")).toBeNull();
    expect(page.matchDropWaitlistPath("/nova/drop")).toBeNull();
  });
});

describe("drop waitlist request handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the API and serves the page with a nonce CSP", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => UPCOMING });
    vi.stubGlobal("fetch", fetchMock);
    const res = await page.handleDropWaitlistRequest("Nova", { apiBase: "https://api.test/api/v1", origin: "https://brandthread.app" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.test/api/v1/public/drop-waitlist/Nova");
    expect(res.status).toBe(200);
    const nonce = /script-src 'nonce-([^']+)'/.exec(res.headers["content-security-policy"])![1];
    expect(res.html).toContain(`<script nonce="${nonce}">`);
    expect(res.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("answers 404 noindex for unknown, deleted or suspended handles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    const res = await page.handleDropWaitlistRequest("ghost", { apiBase: "https://api.test/api/v1", origin: "https://brandthread.app" });
    expect(res.status).toBe(404);
    expect(res.html).toContain("noindex");
  });

  it("answers 503 noindex when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const res = await page.handleDropWaitlistRequest("nova", { apiBase: "https://api.test/api/v1", origin: "https://brandthread.app" });
    expect(res.status).toBe(503);
    expect(res.html).toContain("noindex");
  });

  it("serve.js routes /@handle/drop to the page instead of the SPA", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => UPCOMING }));
    const result = await new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve) => {
      let status = 0;
      let headers: Record<string, string> = {};
      server.emit("request", { url: "/@nova/drop", method: "GET", headers: { host: "brandthread.app", accept: "text/html" } }, {
        writeHead(s: number, h: Record<string, string>) { status = s; headers = h; },
        end(chunk?: string | Buffer) { resolve({ status, headers, body: String(chunk ?? "") }); },
      });
    });
    expect(result.status).toBe(200);
    expect(result.headers["content-security-policy"]).toContain("script-src 'nonce-");
    expect(result.body).toContain("Notify me");
  });
});
