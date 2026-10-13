import { describe, expect, it } from "vitest";
import { classifySalesFlags, type SalesFlagInput } from "./productSalesFlags";

const now = new Date("2026-10-13T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

function row(id: string, units: number, extra: Partial<SalesFlagInput> = {}): SalesFlagInput {
  return { productId: id, status: "active", createdAt: daysAgo(60), totalStock: 10, unitsSold30d: units, ...extra };
}

describe("classifySalesFlags", () => {
  it("flags the top 10% (rounded up) with at least 3 units as best sellers", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`p${String(i).padStart(2, "0")}`, i + 1));
    const flags = classifySalesFlags(rows, now);
    const best = Object.entries(flags).filter(([, f]) => f === "best_seller").map(([id]) => id).sort();
    expect(best).toEqual(["p18", "p19"]);
  });

  it("gives a small catalog one best seller slot", () => {
    expect(classifySalesFlags([row("a", 5), row("b", 1), row("c", 2)], now)).toEqual({ a: "best_seller" });
  });

  it("requires at least 3 units sold", () => {
    expect(classifySalesFlags([row("a", 2), row("b", 1)], now)).toEqual({});
  });

  it("caps best sellers at 5 products", () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(`p${String(i).padStart(3, "0")}`, 50));
    const flags = classifySalesFlags(rows, now);
    expect(Object.values(flags).filter((f) => f === "best_seller")).toHaveLength(5);
  });

  it("ignores drafts and archived products for both flags", () => {
    expect(classifySalesFlags([
      row("d", 30, { status: "draft" }),
      row("x", 0, { status: "archived" }),
    ], now)).toEqual({});
  });

  it("flags active, in-stock products listed 30+ days with no sales as slow movers", () => {
    expect(classifySalesFlags([
      row("old", 0, { createdAt: daysAgo(30) }),
      row("new", 0, { createdAt: daysAgo(29) }),
      row("soldout", 0, { totalStock: 0 }),
      row("selling", 1),
    ], now)).toEqual({ old: "slow_mover" });
  });

  it("never gives one product both flags", () => {
    const flags = classifySalesFlags([row("a", 4), row("b", 0)], now);
    expect(flags).toEqual({ a: "best_seller", b: "slow_mover" });
  });
});
