import { describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS module deployed to Cloudflare as-is
import { handle, subdomainSlug, upstreamPath } from "../../../cloudflare/store-hosts-worker.js";

describe("store host routing worker (BT-307)", () => {
  it("maps store subdomains, never the platform's own hosts", () => {
    expect(subdomainSlug("Northline.brandthread.app")).toBe("northline");
    expect(subdomainSlug("store-ab12cd34.brandthread.app:443")).toBe("store-ab12cd34");
    for (const h of ["brandthread.app", "www.brandthread.app", "api.brandthread.app", "a.b.brandthread.app", "evil.com", "", "-x.brandthread.app"]) {
      expect(subdomainSlug(h)).toBeNull();
    }
  });

  it("serves the store home from the public storefront page and passes everything else through", () => {
    expect(upstreamPath("northline", new URL("https://northline.brandthread.app/?utm_source=ig"))).toBe("/api/store/site/northline?utm_source=ig");
    expect(upstreamPath("northline", new URL("https://northline.brandthread.app/api/public/stores/northline/subscribe"))).toBe("/api/public/stores/northline/subscribe");
  });

  it("fetches a subdomain from the main site", async () => {
    const fetchImpl = vi.fn(async (req: Request) => new Response(req.url));
    const res = await handle(new Request("https://northline.brandthread.app/"), {}, fetchImpl);
    expect(await res.text()).toBe("https://brandthread.app/api/store/site/northline");
    expect((fetchImpl.mock.calls[0][0] as Request).headers.get("x-brandthread-store-host")).toBe("northline.brandthread.app");
  });

  it("looks up a custom domain, and sends unknown hosts to brandthread.app", async () => {
    const fetchImpl = vi.fn(async (input: any) => {
      const u = typeof input === "string" ? input : input.url;
      if (u.includes("/api/store/host-lookup?host=shop.northline.com")) return Response.json({ slug: "northline" });
      if (u.includes("/api/store/host-lookup")) return new Response("", { status: 404 });
      return new Response(u);
    });
    const ok = await handle(new Request("https://shop.northline.com/"), { ORIGIN: "https://brandthread.app" }, fetchImpl);
    expect(await ok.text()).toBe("https://brandthread.app/api/store/site/northline");
    const unknown = await handle(new Request("https://parked.example.com/"), {}, fetchImpl);
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get("location")).toBe("https://brandthread.app/");
  });
});
