import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_SCRIPT, buildPixelInjection, requestOptsOutOfTracking, validateMetaPixelId, validateTikTokPixelId,
} from "../pixels";

const META = "1234567890123456";
const TT = "C4ABCD1234567890ABCD";
const CART = "bt_cart_0b9f5a7e-0f3c-4f0e-9f7e-2f6d3d1a7a11";

const HOSTILE = [
  `123456789012345"><script>alert(1)</script>`,
  `1234567890");alert(1);//`,
  `1234567890</script><script>alert(1)`,
  `12345 67890`,
  `1234567890\n`.repeat(2),
  `'; DROP TABLE x;--`,
  `javascript:alert(1)`,
  `{{constructor.constructor("alert(1)")()}}`,
  `${"9".repeat(40)}`,
  `12345`,
  `abc`,
  ``,
  "12345\u20286789012",
  "12345\u2029 6789012",
];

describe("pixel ID validation", () => {
  it("accepts well-formed IDs", () => {
    expect(validateMetaPixelId(META)).toBe(META);
    expect(validateMetaPixelId(` ${META} `)).toBe(META);
    expect(validateTikTokPixelId(TT)).toBe(TT);
    expect(validateTikTokPixelId(TT.toLowerCase())).toBe(TT);
  });
  it.each(HOSTILE)("rejects hostile or malformed input %#", (raw) => {
    expect(validateMetaPixelId(raw)).toBeNull();
    expect(validateTikTokPixelId(raw)).toBeNull();
  });
  it("rejects non-strings", () => {
    expect(validateMetaPixelId(1234567890123456)).toBeNull();
    expect(validateTikTokPixelId({ toString: () => TT })).toBeNull();
    expect(validateMetaPixelId(null)).toBeNull();
  });
});

describe("buildPixelInjection: no injection is possible", () => {
  it.each(HOSTILE)("emits nothing for hostile ID %#", (raw) => {
    expect(buildPixelInjection({ metaPixelId: raw, tiktokPixelId: raw, cartKey: CART })).toEqual({ head: "", body: "" });
  });

  it("never lets a hostile cart key into the output", () => {
    const out = buildPixelInjection({ metaPixelId: META, cartKey: `x"});alert(1);//` }).head;
    expect(out).not.toContain("alert(1)");
    expect(out).toContain('"bt_cart_unknown"');
  });

  it("places a valid ID only in a JSON string literal (and a digits-only noscript URL)", () => {
    const { head } = buildPixelInjection({ metaPixelId: META, tiktokPixelId: TT, cartKey: CART });
    expect(head).toContain(`fbq("init","${META}")`);
    expect(head).toContain(`ttq.load("${TT}")`);
    expect(head).toContain(`https://www.facebook.com/tr?id=${META}&amp;ev=PageView&amp;noscript=1`);
    // Every occurrence of the IDs is one of the three allowed spots.
    expect(head.split(META).length - 1).toBe(2);
    expect(head.split(TT).length - 1).toBe(1);
  });

  it("only references the two vendor script hosts", () => {
    const { head } = buildPixelInjection({ metaPixelId: META, tiktokPixelId: TT, cartKey: CART });
    const urls = head.match(/https?:\/\/[^"'\s)]+/g) ?? [];
    const hosts = new Set(urls.map((u) => new URL(u).hostname));
    expect([...hosts].sort()).toEqual(["analytics.tiktok.com", "connect.facebook.net", "www.facebook.com"]);
  });

  it("is a no-op when the visitor opted out", () => {
    expect(buildPixelInjection({ metaPixelId: META, tiktokPixelId: TT, cartKey: CART, optOut: true })).toEqual({ head: "", body: "" });
  });

  it("emits nothing when no IDs are configured, and only the configured vendor otherwise", () => {
    expect(buildPixelInjection({ cartKey: CART }).head).toBe("");
    const onlyMeta = buildPixelInjection({ metaPixelId: META, cartKey: CART }).head;
    expect(onlyMeta).toContain("fbevents.js");
    expect(onlyMeta).not.toContain("analytics.tiktok.com");
    const onlyTt = buildPixelInjection({ tiktokPixelId: TT, cartKey: CART }).head;
    expect(onlyTt).toContain("analytics.tiktok.com");
    expect(onlyTt).not.toContain("fbevents.js");
    expect(onlyTt).not.toContain("<noscript>");
  });

  function scriptsOf(html: string): string[] {
    return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  }

  it("generates syntactically valid scripts with no stray closing tags", () => {
    const { head } = buildPixelInjection({ metaPixelId: META, tiktokPixelId: TT, cartKey: CART });
    const scripts = scriptsOf(head);
    expect(scripts).toHaveLength(2);
    for (const s of scripts) {
      expect(s).not.toMatch(/<\/script/i);
      expect(() => new vm.Script(s)).not.toThrow();
    }
    expect(head.match(/<script/g)).toHaveLength(2);
  });

  function run(head: string, nav: Record<string, unknown>, search = "") {
    const calls: { fn: string; args: unknown[] }[] = [];
    const store: Record<string, string> = {};
    const session: Record<string, string> = {};
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const win: Record<string, unknown> = {};
    const doc = {
      readyState: "complete",
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore: () => undefined } }],
      querySelectorAll: () => [{ getAttribute: () => "prod-1" }],
      addEventListener: (ev: string, fn: (e: unknown) => void) => { (listeners[ev] ??= []).push(fn); },
    };
    Object.assign(win, {
      document: doc, navigator: nav,
      location: { search },
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
      sessionStorage: { getItem: (k: string) => session[k] ?? null, setItem: (k: string, v: string) => { session[k] = v; }, removeItem: (k: string) => { delete session[k]; } },
    });
    const ctx: Record<string, unknown> = { ...win, window: win };
    ctx.window = ctx;
    const sandbox = vm.createContext(ctx);
    // Wrap fbq/ttq after base code runs by stubbing script insertion: base code defines fbq queue itself.
    for (const s of scriptsOf(head)) vm.runInContext(s, sandbox);
    return { sandbox, calls, listeners, store, session, doc };
  }

  it("base code initialises fbq and ttq with the validated IDs and fires PageView", () => {
    const { head } = buildPixelInjection({ metaPixelId: META, tiktokPixelId: TT, cartKey: CART });
    const r = run(head, { doNotTrack: null });
    const fbq = r.sandbox.fbq as { queue: unknown[][] };
    expect(Array.from(fbq.queue[0] as unknown[])).toEqual(["init", META]);
    expect(Array.from(fbq.queue[1] as unknown[])).toEqual(["track", "PageView"]);
    const ttq = r.sandbox.ttq as { _i: Record<string, unknown>; push: unknown };
    expect(Object.keys(ttq._i)).toEqual([TT]);
    expect(typeof (r.sandbox.btPixel as { track: unknown }).track).toBe("function");
  });

  it("does nothing at runtime when DNT / GPC is set (cached HTML case)", () => {
    const { head } = buildPixelInjection({ metaPixelId: META, tiktokPixelId: TT, cartKey: CART });
    for (const nav of [{ doNotTrack: "1" }, { globalPrivacyControl: true }]) {
      const r = run(head, nav);
      expect(r.sandbox.fbq).toBeUndefined();
      expect(r.sandbox.ttq).toBeUndefined();
      expect(r.sandbox.btPixel).toBeUndefined();
    }
  });

  it("maps events: AddToCart click, InitiateCheckout, Purchase (CompletePayment on TikTok)", () => {
    const { head } = buildPixelInjection({ metaPixelId: META, tiktokPixelId: TT, cartKey: CART });
    const r = run(head, {}, "?checkout=success");
    const track = (r.sandbox.btPixel as { track: (n: string, d: unknown) => void }).track;
    track("Purchase", { value: 10 });
    const fbq = r.sandbox.fbq as { queue: unknown[][] };
    const ttq = r.sandbox.ttq as unknown as unknown[][];
    const names = fbq.queue.map((a) => Array.from(a).slice(0, 2).join(":"));
    expect(names).toContain("track:ViewContent");
    expect(names).toContain("track:Purchase");
    const ttNames = ttq.map((a) => String((a as unknown[])[0]) + ":" + String((a as unknown[])[1]));
    expect(ttNames.some((n) => n.startsWith("track:CompletePayment"))).toBe(true);
  });
});

describe("opt-out headers", () => {
  it("detects Sec-GPC and DNT", () => {
    expect(requestOptsOutOfTracking({ "sec-gpc": "1" })).toBe(true);
    expect(requestOptsOutOfTracking({ dnt: "1" })).toBe(true);
    expect(requestOptsOutOfTracking({ dnt: "0" })).toBe(false);
    expect(requestOptsOutOfTracking({})).toBe(false);
  });
});

describe("attribution script", () => {
  it("is constant, parseable and has no interpolation hooks", () => {
    const body = ATTRIBUTION_SCRIPT.replace(/^<script>|<\/script>$/g, "");
    expect(() => new vm.Script(body)).not.toThrow();
    expect(ATTRIBUTION_SCRIPT).not.toContain("${");
  });
});
