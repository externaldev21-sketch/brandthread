import { afterEach, describe, expect, it, vi } from "vitest";

const { renderSharePreview } = require("./sharePreview.js") as {
  renderSharePreview: (p: string, shell: string) => Promise<{ html: string; status: number } | null>;
};

const SHELL_HTML = `<!doctype html><html><head><title>Brandthread</title><meta name="description" content="generic" /></head><body></body></html>`;
const SHELL_WITH_OG = `<!doctype html><html><head><title>Brandthread</title><meta property="og:title" content="generic" /><meta name="twitter:card" content="summary" /></head><body></body></html>`;

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("renderSharePreview — posts, stores, hashtags, places", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects og/twitter tags for a public post and replaces the shell's generic ones", async () => {
    const fetchMock = mockFetch({ authorName: "Nova Studio", authorHandle: "nova", caption: 'Fit "check" <3', imageUrl: "https://cdn.test/t.jpg" });
    const result = await renderSharePreview("/p/abc123def", SHELL_WITH_OG);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/public/posts/abc123def/share-preview");
    expect(result?.status).toBe(200);
    const html = result!.html;
    expect(html).toContain('<meta property="og:title" content="Nova Studio on Brandthread" />');
    expect(html).toContain('og:description" content="Fit &quot;check&quot; &lt;3"');
    expect(html).toContain('og:image" content="https://cdn.test/t.jpg"');
    expect(html).toContain('og:url" content="https://brandthread.app/p/abc123def"');
    expect(html).toContain('twitter:card" content="summary_large_image"');
    expect(html).toContain('twitter:image" content="https://cdn.test/t.jpg"');
    expect(html).not.toContain('content="generic"');
    expect(html.match(/og:title/g)).toHaveLength(1);
  });

  it("uses the logo fallback image and a default description when the post has none", async () => {
    mockFetch({ authorName: "Nova", caption: null, imageUrl: null });
    const result = await renderSharePreview("/p/abc123def", SHELL_HTML);
    expect(result!.html).toContain("Watch Nova's post on Brandthread.");
    expect(result!.html).toContain("brandthread-logo.png");
  });

  it("answers 404 + noindex when the post is not public (API 404)", async () => {
    mockFetch({}, 404);
    const result = await renderSharePreview("/p/abc123def", SHELL_HTML);
    expect(result?.status).toBe(404);
    expect(result?.html).toContain('name="robots" content="noindex"');
    expect(result?.html).not.toContain("og:title");
  });

  it("falls back to the generic shell (null) when the API is unreachable or errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await renderSharePreview("/p/abc123def", SHELL_HTML)).toBeNull();
    mockFetch({}, 500);
    expect(await renderSharePreview("/p/abc123def", SHELL_HTML)).toBeNull();
  });

  it("does not match malformed post ids", async () => {
    expect(await renderSharePreview("/p/x", SHELL_HTML)).toBeNull();
    expect(await renderSharePreview("/p/abc123/extra", SHELL_HTML)).toBeNull();
  });

  it("renders a store card from /store/:handle and keeps /store/product/:id on the product matcher", async () => {
    const storeFetch = mockFetch({ name: "Nova Goods", description: "Handmade.", imageUrl: "https://cdn.test/logo.png" });
    const store = await renderSharePreview("/store/novagoods", SHELL_HTML);
    expect(store!.html).toContain("Nova Goods on Brandthread");
    expect(store!.html).toContain("https://brandthread.app/store/novagoods");
    expect(String(storeFetch.mock.calls[0][0])).toContain("/public/stores/novagoods/share-preview");

    const productFetch = mockFetch({ name: "Hoodie", variants: [{ priceCents: 100 }] });
    await renderSharePreview("/store/product/p1", SHELL_HTML);
    expect(String(productFetch.mock.calls[0][0])).toContain("/public/products/p1");
  });

  it("404s an unknown/draft store", async () => {
    mockFetch({}, 404);
    expect((await renderSharePreview("/store/nope", SHELL_HTML))?.status).toBe(404);
  });

  it("renders a hashtag card without any API call", async () => {
    const fetchMock = mockFetch({});
    const result = await renderSharePreview("/tag/Streetwear", SHELL_HTML);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result!.html).toContain("#streetwear on Brandthread");
    expect(result!.html).toContain("https://brandthread.app/tag/Streetwear");
    expect(await renderSharePreview("/tag/bad%20tag", SHELL_HTML)).toBeNull();
  });

  it("renders a place card and degrades to the generic shell when the places endpoint 404s", async () => {
    mockFetch({ name: "Soho, New York", imageUrl: "https://cdn.test/p.jpg" });
    const place = await renderSharePreview("/place/pl_12345", SHELL_HTML);
    expect(place!.html).toContain("Soho, New York on Brandthread");
    expect(place!.status).toBe(200);

    mockFetch({}, 404);
    expect(await renderSharePreview("/place/pl_12345", SHELL_HTML)).toBeNull();
  });

  it("gives the short and long share links the same Open Graph card", async () => {
    const postFetch = mockFetch({ authorName: "Nova", caption: "new drop", imageUrl: "https://cdn.test/n.jpg" });
    const post = await renderSharePreview("/post/abc123def", SHELL_HTML);
    expect(String(postFetch.mock.calls[0][0])).toContain("/public/posts/abc123def/share-preview");
    expect(post!.html).toContain('og:title" content="Nova on Brandthread"');
    expect(post!.html).toContain('og:image" content="https://cdn.test/n.jpg"');
    expect(post!.html).toContain('og:url" content="https://brandthread.app/post/abc123def"');

    const storeFetch = mockFetch({ name: "Atelier", description: "Knitwear", imageUrl: "https://cdn.test/a.jpg" });
    const store = await renderSharePreview("/s/atelier", SHELL_HTML);
    expect(String(storeFetch.mock.calls[0][0])).toContain("/public/stores/atelier/share-preview");
    expect(store!.html).toContain('og:title" content="Atelier on Brandthread"');
    expect(store!.html).toContain('og:image" content="https://cdn.test/a.jpg"');
    expect(await renderSharePreview("/s/a/b", SHELL_HTML)).toBeNull();
  });
});
