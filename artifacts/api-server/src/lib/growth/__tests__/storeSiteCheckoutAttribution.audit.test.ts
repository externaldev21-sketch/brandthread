/**
 * The store-site checkout script must carry the tracked-link code to the
 * guest checkout. Tracked links (/l/:code) land on /@handle with the code in
 * `bt_lc` (utm.ts LINK_CODE_PARAM); the script used to read only `l`, so the
 * code never reached recordCheckoutAttribution.
 */
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { renderStoreCheckout } from "../storeSitePage";
import { storeSiteTheme } from "../storeSiteDesign";
import { LINK_CODE_PARAM } from "../utm";

function checkoutScript(): string {
  const html = renderStoreCheckout({
    site: { handle: "maison", displayName: "Maison", logoUrl: null, theme: storeSiteTheme("black"), canonicalUrl: "https://brandthread.app/@maison" },
    storePath: "/@maison",
    productId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    kind: "premade",
    title: "Wool crew",
    image: null,
    description: "",
    priceLabel: "$120",
    compareAtLabel: "",
    shipByLabel: "",
    variants: [{ id: "v1", label: "", priceLabel: "$120", soldOut: false }],
    unavailableLabel: null,
    stripePublishableKey: null,
    donePath: "/@maison/c/0f8fad5b-d9cb-469f-a165-70867728950e/done",
    canonicalUrl: "https://brandthread.app/@maison/c/0f8fad5b-d9cb-469f-a165-70867728950e",
  });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return scripts[scripts.length - 1];
}

/** Runs the checkout script, submits the form and returns the POSTed body's attribution. */
function submittedAttribution(search: string): Record<string, unknown> {
  const h: { submit?: (e: { preventDefault(): void }) => void } = {};
  const posted: string[] = [];
  const attrs: Record<string, string> = {
    "data-pk": "", "data-done": "/@maison/c/x/done", "data-product": "0f8fad5b-d9cb-469f-a165-70867728950e",
  };
  const form = {
    getAttribute: (k: string) => attrs[k] ?? null,
    elements: new Proxy({}, { get: (_t, name) => ({ value: name === "variant" ? "v1" : `x-${String(name)}` }) }),
    addEventListener: (ev: string, fn: (e: { preventDefault(): void }) => void) => { if (ev === "submit") h.submit = fn; },
  };
  const el = { textContent: "", hidden: true, disabled: false };
  const ctx: Record<string, unknown> = {
    document: { getElementById: (id: string) => (id === "co" ? form : el) },
    location: { search, origin: "https://brandthread.app", href: `https://brandthread.app/@maison/c/x${search}` },
    URLSearchParams,
    JSON,
    fetch: (_url: string, init: { body: string }) => { posted.push(init.body); return new Promise(() => undefined); },
  };
  ctx.window = ctx;
  vm.runInContext(checkoutScript(), vm.createContext(ctx));
  expect(h.submit).toBeDefined();
  h.submit!({ preventDefault: () => undefined });
  expect(posted).toHaveLength(1);
  return JSON.parse(posted[0]).attribution;
}

describe("store-site checkout attribution", () => {
  it("sends the tracked-link code from bt_lc (the param tracked links append)", () => {
    expect(LINK_CODE_PARAM).toBe("bt_lc");
    const a = submittedAttribution("?utm_source=instagram&utm_medium=social&bt_lc=abcd2345");
    expect(a).toMatchObject({ source: "instagram", medium: "social", code: "abcd2345" });
  });

  it("still accepts the legacy l param", () => {
    expect(submittedAttribution("?l=abcd2345").code).toBe("abcd2345");
  });

  it("sends no code when there is none", () => {
    expect(submittedAttribution("").code).toBeUndefined();
  });
});
