import { describe, expect, it } from "vitest";
import { renderBioPage, type BioPageModel } from "../bioPage";
import {
  normalizeAccent, normalizeBioLinkUrl, normalizeHttpUrl, normalizeSocial, normalizeSocials, slugifyBio,
} from "../bioValidation";

describe("URL validation", () => {
  it("accepts http(s), mailto and tel; rejects script-ish schemes", () => {
    expect(normalizeHttpUrl("example.com/a")).toBe("https://example.com/a");
    expect(normalizeHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeHttpUrl("data:text/html,x")).toBeNull();
    expect(normalizeHttpUrl("https://user:pw@example.com")).toBeNull();
    expect(normalizeHttpUrl('https://example.com/"onmouseover=')).toBeNull();
    expect(normalizeHttpUrl("localhost")).toBeNull();
    expect(normalizeBioLinkUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(normalizeBioLinkUrl("tel:+1 (555) 123-4567")).toBe("tel:+15551234567");
    expect(normalizeBioLinkUrl("mailto:<x>@y.z")).toBeNull();
    expect(normalizeBioLinkUrl("vbscript:x")).toBeNull();
  });
  it("normalises socials", () => {
    expect(normalizeSocial("instagram", "@acme.studio")).toBe("https://www.instagram.com/acme.studio");
    expect(normalizeSocial("tiktok", "acme")).toBe("https://www.tiktok.com/@acme");
    expect(normalizeSocial("youtube", "https://youtube.com/@acme")).toBe("https://youtube.com/@acme");
    expect(normalizeSocial("instagram", "https://evil.com/acme")).toBeNull();
    expect(normalizeSocial("email", "hi@acme.co")).toBe("mailto:hi@acme.co");
    expect(normalizeSocial("nope", "x")).toBeNull();
    expect(normalizeSocials({ instagram: "acme", bogus: "x", website: "javascript:1" })).toEqual({ instagram: "https://www.instagram.com/acme" });
  });
  it("slugs and accents", () => {
    expect(slugifyBio("Acme Studio!")).toBe("acme-studio");
    expect(slugifyBio("a")).toBe("");
    expect(normalizeAccent("#AABBCC")).toBe("#aabbcc");
    expect(normalizeAccent("red")).toBeNull();
    expect(normalizeAccent("#fff; background:url(x)")).toBeNull();
  });
});

const model = (over: Partial<BioPageModel> = {}): BioPageModel => ({
  slug: "acme", displayName: "Acme", bio: "Hello", avatarUrl: "https://cdn.test/a.jpg", theme: "mono", accentColor: null,
  shop: { href: "/bio/acme/shop", label: "Shop my store" }, products: [], links: [{ href: "/bio/acme/go/1", title: "Lookbook" }],
  socials: [{ key: "instagram", href: "https://www.instagram.com/acme" }], canonicalUrl: "https://brandthread.app/bio/acme", ...over,
});

describe("renderBioPage", () => {
  it("renders OG tags, semantic links and no script", () => {
    const html = renderBioPage(model());
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('property="og:title" content="Acme"');
    expect(html).toContain('property="og:image" content="https://cdn.test/a.jpg"');
    expect(html).toContain('rel="canonical" href="https://brandthread.app/bio/acme"');
    expect(html).toContain('aria-label="Instagram"');
    expect(html).toContain('href="/bio/acme/go/1"');
    expect(html).not.toMatch(/<script/i);
  });
  it("escapes every seller-controlled string", () => {
    const evil = `"><img src=x onerror=alert(1)>`;
    const html = renderBioPage(model({
      displayName: evil, bio: evil, links: [{ href: "/x", title: evil }],
      products: [{ href: "/p", name: evil, image: "https://cdn.test/i.jpg", priceLabel: "$1.00" }],
      shop: { href: "/s", label: evil },
    }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("drops non-https images and is monochrome by default", () => {
    const html = renderBioPage(model({ avatarUrl: "http://insecure/a.jpg" }));
    expect(html).not.toContain("http://insecure");
    expect(html).not.toContain("og:image");
    expect(html).toContain("#ffffff");
    expect(renderBioPage(model({ theme: "dark" }))).toContain("#0a0a0b");
  });
  it("uses an accent only when provided, with readable text", () => {
    const html = renderBioPage(model({ accentColor: "#ffff00" }));
    expect(html).toContain(".btn.primary{background:#ffff00;border-color:#ffff00;color:#0a0a0b");
  });
});
