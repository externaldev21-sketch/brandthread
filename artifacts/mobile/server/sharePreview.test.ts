import { afterEach, describe, expect, it, vi } from "vitest";

const { renderSharePreviewHtml } = require("./sharePreview.js") as {
  renderSharePreviewHtml: (pathname: string, shellHtml: string) => Promise<string | null>;
};

const SHELL_HTML = `<!doctype html><html><head><title>Brandthread</title><meta name="description" content="generic" /></head><body></body></html>`;

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
    }),
  );
}

describe("renderSharePreviewHtml", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for a route with no known preview", async () => {
    const result = await renderSharePreviewHtml("/privacy", SHELL_HTML);
    expect(result).toBeNull();
  });

  it("returns null when the resource fetch fails", async () => {
    mockFetchOnce({}, false);
    const result = await renderSharePreviewHtml("/store/product/abc123", SHELL_HTML);
    expect(result).toBeNull();
  });

  it("injects product name, price and image into the shell for a product link", async () => {
    mockFetchOnce({
      name: "Aurora Hoodie",
      description: "A soft hoodie.",
      images: ["https://cdn.brandthread.app/aurora.jpg"],
      variants: [{ priceCents: 4500 }, { priceCents: 5200 }],
    });

    const result = await renderSharePreviewHtml("/store/product/abc123", SHELL_HTML);

    expect(result).not.toBeNull();
    expect(result).toContain("Aurora Hoodie — $45.00");
    expect(result).toContain('og:image" content="https://cdn.brandthread.app/aurora.jpg"');
    expect(result).toContain("https://brandthread.app/store/product/abc123");
    expect(result).not.toContain("<title>Brandthread</title>");
  });

  it("injects profile display name into the shell for a profile link", async () => {
    mockFetchOnce({ displayName: "Nova Studio", username: "novastudio", bio: "Handmade goods." });

    const result = await renderSharePreviewHtml("/u/novastudio", SHELL_HTML);

    expect(result).toContain("Nova Studio on Brandthread");
    expect(result).toContain("Handmade goods.");
  });
});
