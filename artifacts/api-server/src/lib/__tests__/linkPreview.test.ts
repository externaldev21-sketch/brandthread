import { beforeEach, describe, expect, it } from "vitest";
import { clearLinkPreviewCache, getLinkPreview, parsePreview, safePreviewUrl } from "../linkPreview";

const page = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`;

describe("safePreviewUrl", () => {
  it("accepts public http(s) on default ports", () => {
    expect(safePreviewUrl("https://brandthread.app/p/1#frag")?.href).toBe("https://brandthread.app/p/1");
    expect(safePreviewUrl("http://example.com")).not.toBeNull();
  });
  it("refuses internal, odd-port, credentialed and non-web URLs", () => {
    for (const bad of [
      "http://127.0.0.1/", "http://10.0.0.2/", "http://169.254.169.254/latest/meta-data", "http://[::1]/",
      "http://localhost:3000/", "http://foo.localhost/", "http://db.internal/", "https://example.com:8443/",
      "https://user:pw@example.com/", "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/", "not a url", 42,
    ]) expect(safePreviewUrl(bad), String(bad)).toBeNull();
  });
});

describe("parsePreview", () => {
  const url = new URL("https://shop.example.com/item/9");
  it("prefers Open Graph and resolves a relative image", () => {
    const p = parsePreview(page(`
      <title>Fallback</title>
      <meta property="og:title" content="Wool Coat &amp; Belt">
      <meta name="description" content="Plain description">
      <meta property="og:description" content="Soft, warm">
      <meta property="og:image" content="/img/coat.jpg">
      <meta property="og:site_name" content="Shop">`), url);
    expect(p).toEqual({
      url: url.href, title: "Wool Coat & Belt", description: "Soft, warm",
      imageUrl: "https://shop.example.com/img/coat.jpg", siteName: "Shop",
    });
  });
  it("falls back to <title> and the hostname, drops non-https or internal images", () => {
    const p = parsePreview(page(`<title>Just a title</title><meta property="og:image" content="http://10.0.0.1/x.png">`), new URL("https://www.example.org/"));
    expect(p).toMatchObject({ title: "Just a title", siteName: "example.org", imageUrl: null, description: null });
  });
  it("no title, no card", () => {
    expect(parsePreview(page(`<meta name="description" content="x">`), url)).toBeNull();
  });
});

describe("getLinkPreview", () => {
  beforeEach(() => clearLinkPreviewCache());
  it("follows a safe redirect and caches", async () => {
    let calls = 0;
    const fetcher = async (u: URL) => {
      calls += 1;
      if (u.pathname === "/short") return { status: 301, location: "https://example.com/long", contentType: "", body: "" };
      return { status: 200, contentType: "text/html", body: page(`<meta property="og:title" content="Long page">`) };
    };
    const a = await getLinkPreview("https://example.com/short", fetcher);
    expect(a?.title).toBe("Long page");
    expect(a?.url).toBe("https://example.com/long");
    await getLinkPreview("https://example.com/short", fetcher);
    expect(calls).toBe(2);
  });
  it("never follows a redirect into the private network", async () => {
    const hits: string[] = [];
    const fetcher = async (u: URL) => {
      hits.push(u.href);
      return { status: 302, location: "http://169.254.169.254/latest/meta-data", contentType: "", body: "" };
    };
    expect(await getLinkPreview("https://evil.example/", fetcher)).toBeNull();
    expect(hits).toEqual(["https://evil.example/"]);
  });
  it("a fetch error is a null preview", async () => {
    expect(await getLinkPreview("https://down.example/", async () => { throw new Error("boom"); })).toBeNull();
  });
});
