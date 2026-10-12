import { describe, expect, it } from "vitest";
import {
  BLOCK_KINDS, PREORDER_OPEN_STOCK, blockButtonText, effectiveCompareAt, normalizeBlockImage, parseBlockPatch, preorderSold,
  preorderStock, priceLabel, publishProblem, shipByLabel,
} from "../storeBlocks";

const NOW = new Date("2026-10-12T15:00:00Z");

describe("store block kinds", () => {
  it("has exactly two: pre-made and pre-order", () => {
    expect([...BLOCK_KINDS]).toEqual(["premade", "preorder"]);
  });
  it("defaults the card button to Buy now / Pre-order", () => {
    expect(blockButtonText("premade", "")).toBe("Buy now");
    expect(blockButtonText("preorder", "  ")).toBe("Pre-order");
    expect(blockButtonText("preorder", "Reserve yours")).toBe("Reserve yours");
  });
});

describe("labels", () => {
  it("ship-by reads like 'Ships by Nov 20', with the year only when it isn't this year", () => {
    expect(shipByLabel(new Date("2026-11-20T00:00:00Z"), NOW)).toBe("Ships by Nov 20");
    expect(shipByLabel(new Date("2027-01-05T00:00:00Z"), NOW)).toBe("Ships by Jan 5, 2027");
    expect(shipByLabel(null, NOW)).toBe("");
  });
  it("prices drop .00", () => {
    expect(priceLabel(4800)).toBe("$48");
    expect(priceLabel(4850)).toBe("$48.50");
    expect(priceLabel(null)).toBe("");
  });
  it("only shows an original price above the price", () => {
    expect(effectiveCompareAt(4800, 6000)).toBe(6000);
    expect(effectiveCompareAt(4800, 4800)).toBeNull();
    expect(effectiveCompareAt(null, 6000)).toBeNull();
  });
});

describe("pre-order cap", () => {
  it("first open: stock is the cap, or open-ended without one", () => {
    expect(preorderStock({ cap: 50, prevCap: 50, prevStock: 50 })).toBe(50);
    expect(preorderStock({ cap: null, prevCap: null, prevStock: PREORDER_OPEN_STOCK })).toBe(PREORDER_OPEN_STOCK);
  });
  it("changing the cap keeps sold units counted", () => {
    // Cap 50, 12 sold (38 left) → cap 40 leaves 28.
    expect(preorderStock({ cap: 40, prevCap: 50, prevStock: 38 })).toBe(28);
    // Uncapped with 7 sold → cap 10 leaves 3.
    expect(preorderStock({ cap: 10, prevCap: null, prevStock: PREORDER_OPEN_STOCK - 7 })).toBe(3);
    // Lowering below what's sold closes it rather than going negative.
    expect(preorderStock({ cap: 5, prevCap: 50, prevStock: 38 })).toBe(0);
    // Removing the cap reopens it.
    expect(preorderStock({ cap: null, prevCap: 50, prevStock: 38 })).toBe(PREORDER_OPEN_STOCK - 12);
  });
  it("counts sold units", () => {
    expect(preorderSold(50, 38)).toBe(12);
    expect(preorderSold(null, PREORDER_OPEN_STOCK - 3)).toBe(3);
  });
});

describe("parseBlockPatch", () => {
  it("accepts the thumbnail and checkout page fields", () => {
    const r = parseBlockPatch({
      style: "button", title: "  Wool   crew ", subtitle: "Merino", buttonText: "Get it", description: "Line one\r\n\r\n\r\nLine two",
      thumbImage: "/objects/uploads/abc.jpg", checkoutImage: "https://cdn.test/x.jpg", priceCents: 4800, compareAtPriceCents: 6000, visible: false,
    }, "premade");
    expect(r).toEqual({ ok: true, patch: {
      style: "button", title: "Wool crew", subtitle: "Merino", buttonText: "Get it", description: "Line one\n\nLine two",
      thumbImage: "/objects/uploads/abc.jpg", checkoutImage: "https://cdn.test/x.jpg", priceCents: 4800, compareAtPriceCents: 6000, visible: false,
    } });
  });
  it("only returns what was sent", () => {
    expect(parseBlockPatch({ title: "A" }, "premade")).toEqual({ ok: true, patch: { title: "A" } });
  });
  it("rejects bad values with the field to point at", () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ style: "grid" }, "style"],
      [{ title: "x".repeat(81) }, "title"],
      [{ buttonText: "x".repeat(25) }, "buttonText"],
      [{ thumbImage: "http://cdn.test/x.jpg" }, "thumbImage"],
      [{ thumbImage: "/objects/../secret" }, "thumbImage"],
      [{ checkoutImage: "javascript:alert(1)" }, "checkoutImage"],
      [{ priceCents: 50 }, "priceCents"],
      [{ priceCents: 12.5 }, "priceCents"],
      [{ visible: "yes" }, "visible"],
    ];
    for (const [body, field] of bad) {
      const r = parseBlockPatch(body, "premade");
      expect(r.ok, JSON.stringify(body)).toBe(false);
      if (!r.ok) expect(r.field).toBe(field);
    }
  });
  it("ship date and cap are pre-order only", () => {
    expect(parseBlockPatch({ shipBy: "2026-11-20" }, "premade").ok).toBe(false);
    expect(parseBlockPatch({ preorderCap: 10 }, "premade").ok).toBe(false);
    const r = parseBlockPatch({ shipBy: "2026-11-20", preorderCap: null }, "preorder");
    expect(r.ok && r.patch.shipBy?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(r.ok && r.patch.preorderCap).toBeNull();
    expect(parseBlockPatch({ preorderCap: 0 }, "preorder").ok).toBe(false);
    expect(parseBlockPatch({ shipBy: "soon" }, "preorder").ok).toBe(false);
  });
  it("clears images with null or empty", () => {
    expect(parseBlockPatch({ thumbImage: "" }, "premade")).toEqual({ ok: true, patch: { thumbImage: null } });
    expect(normalizeBlockImage(null)).toBeNull();
  });
});

describe("publishProblem", () => {
  const ok = { kind: "premade" as const, title: "Wool crew", priceCents: 4800, shipBy: null, now: NOW };
  it("needs a title and a price", () => {
    expect(publishProblem(ok)).toBeNull();
    expect(publishProblem({ ...ok, title: " " })?.field).toBe("title");
    expect(publishProblem({ ...ok, priceCents: null })?.field).toBe("priceCents");
  });
  it("a pre-order needs a ship date inside the refund window", () => {
    const pre = { ...ok, kind: "preorder" as const };
    expect(publishProblem({ ...pre, shipBy: null })?.field).toBe("shipBy");
    expect(publishProblem({ ...pre, shipBy: new Date("2026-11-20T00:00:00Z") })).toBeNull();
    expect(publishProblem({ ...pre, shipBy: new Date("2026-10-01T00:00:00Z") })?.error).toMatch(/future/);
    expect(publishProblem({ ...pre, shipBy: new Date("2027-03-01T00:00:00Z") })?.error).toMatch(/within 60 days/);
  });
});
