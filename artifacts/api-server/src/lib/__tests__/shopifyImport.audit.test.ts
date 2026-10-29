import { describe, expect, it } from "vitest";
import { toBrandthreadProduct } from "../shopifyImport";

describe("toBrandthreadProduct option mapping (audit)", () => {
  it("does not turn a lone Color option into the size as well", () => {
    const product = toBrandthreadProduct({
      id: 1, title: "Cap", options: [{ name: "Color" }],
      variants: [{ id: 11, price: "20.00", option1: "Red" }],
    });
    expect(product.variants[0]).toMatchObject({ size: undefined, color: "Red" });
    expect(product.tags).toEqual(["option:Red"]);
  });

  it("does not turn a lone Size option into the color as well, when Size is second", () => {
    const product = toBrandthreadProduct({
      id: 2, title: "Tee", options: [{ name: "Material" }, { name: "Size" }],
      variants: [{ id: 21, price: "20.00", option1: "Cotton", option2: "M" }],
    });
    expect(product.variants[0]).toMatchObject({ size: "M / material: Cotton", color: undefined });
  });

  it("keeps the positional fallback for unnamed options", () => {
    const product = toBrandthreadProduct({
      id: 3, title: "Tee", options: [{ name: "A" }, { name: "B" }],
      variants: [{ id: 31, price: "20.00", option1: "L", option2: "Blue" }],
    });
    expect(product.variants[0]).toMatchObject({ size: "L", color: "Blue" });
  });
});
