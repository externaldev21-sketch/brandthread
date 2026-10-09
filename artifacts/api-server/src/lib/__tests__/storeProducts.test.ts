import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { storeProducts } from "../storeProducts";
import { allPromoProductIds } from "../iapPromotions";
import { RC_CREDIT_PRODUCTS } from "../aiCredits/purchases";

const doc = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../docs/app-store/iap-products.md"),
  "utf8",
);

describe("store products", () => {
  it("lists every product the server grants, exactly once", () => {
    const ids = storeProducts().map((p) => p.productId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...allPromoProductIds(), ...Object.keys(RC_CREDIT_PRODUCTS)]) expect(ids).toContain(id);
    expect(ids).toEqual(expect.arrayContaining(["brandthread_starter_monthly", "brandthread_growth_monthly", "brandthread_pro_monthly"]));
  });

  it("is documented for Dev in docs/app-store/iap-products.md", () => {
    for (const p of storeProducts()) expect(doc).toContain(`\`${p.productId}\``);
  });
});
