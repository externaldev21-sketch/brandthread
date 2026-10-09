import { describe, expect, it } from "vitest";
import { isBotRequest } from "../botFilter";
import { clickDedupeKey, countryFromHeaders, referrerHost } from "../clickPrivacy";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("bot filter", () => {
  it("lets real browsers through", () => {
    expect(isBotRequest({ method: "GET", userAgent: CHROME })).toBe(false);
    expect(isBotRequest({ method: "GET", userAgent: SAFARI_IOS })).toBe(false);
  });
  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0 A",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "HeadlessChrome/126.0.0.0 Mozilla/5.0",
    "Go-http-client/1.1",
  ])("flags %s", (ua) => expect(isBotRequest({ method: "GET", userAgent: ua })).toBe(true));
  it("flags missing UA, HEAD and prefetch", () => {
    expect(isBotRequest({ method: "GET", userAgent: "" })).toBe(true);
    expect(isBotRequest({ method: "GET", userAgent: undefined })).toBe(true);
    expect(isBotRequest({ method: "HEAD", userAgent: CHROME })).toBe(true);
    expect(isBotRequest({ method: "GET", userAgent: CHROME, headers: { purpose: "prefetch" } })).toBe(true);
    expect(isBotRequest({ method: "GET", userAgent: CHROME, headers: { "sec-purpose": "prefetch;prerender" } })).toBe(true);
  });
});

describe("click privacy", () => {
  it("reads only a valid coarse country", () => {
    expect(countryFromHeaders({ "cf-ipcountry": "de" })).toBe("DE");
    expect(countryFromHeaders({ "x-vercel-ip-country": "US" })).toBe("US");
    expect(countryFromHeaders({ "cf-ipcountry": "XX" })).toBeNull();
    expect(countryFromHeaders({ "cf-ipcountry": "<script>" })).toBeNull();
    expect(countryFromHeaders({})).toBeNull();
  });
  it("keeps only the referrer host", () => {
    expect(referrerHost("https://www.instagram.com/p/abc?token=secret#x")).toBe("instagram.com");
    expect(referrerHost("https://brandthread.app/x", ["brandthread.app"])).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
    expect(referrerHost(undefined)).toBeNull();
  });
  it("dedupe key is salted, stable per day and never contains the IP", () => {
    const day = new Date("2026-01-01T10:00:00Z");
    const a = clickDedupeKey("s1", "203.0.113.9", "UA", "l:abc", day);
    expect(a).toBe(clickDedupeKey("s1", "203.0.113.9", "UA", "l:abc", day));
    expect(a).not.toContain("203.0.113.9");
    expect(a).not.toBe(clickDedupeKey("s2", "203.0.113.9", "UA", "l:abc", day));
    expect(a).not.toBe(clickDedupeKey("s1", "203.0.113.10", "UA", "l:abc", day));
    expect(a).not.toBe(clickDedupeKey("s1", "203.0.113.9", "UA", "l:abc", new Date("2026-01-02T10:00:00Z")));
  });
});
