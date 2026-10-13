import { describe, expect, it } from "vitest";
import { generateOrderNumber, randomOrderNumber } from "./orderNumber";

function sequence(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("order numbers", () => {
  it("draws four digits with no leading zero", () => {
    expect(randomOrderNumber(4, () => 0)).toBe("BT-1000");
    expect(randomOrderNumber(4, () => 0.999999)).toBe("BT-9999");
    for (let i = 0; i < 500; i += 1) expect(randomOrderNumber(4)).toMatch(/^BT-[1-9]\d{3}$/);
  });

  it("returns the first free number", async () => {
    const taken = new Set(["BT-1000"]);
    const n = await generateOrderNumber(async (c) => taken.has(c), sequence([0, 0.5]));
    expect(n).toBe("BT-5500");
  });

  it("grows a digit when four-digit draws keep colliding", async () => {
    const n = await generateOrderNumber(async (c) => c.length === "BT-0000".length, () => 0.25);
    expect(n).toBe("BT-32500");
  });

  it("never reuses a number another seller already has", async () => {
    const taken = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const n = await generateOrderNumber(async (c) => taken.has(c));
      expect(taken.has(n)).toBe(false);
      taken.add(n);
    }
  });
});
