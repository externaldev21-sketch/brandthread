import { describe, expect, it } from "vitest";
import { attachPreOrderProgress } from "./dropPreOrderProgress";

const pre = { id: "d1", type: "pre-order", name: "Linen run" };
const made = { id: "d2", type: "pre-made", name: "Tees" };

describe("attachPreOrderProgress", () => {
  it("adds paid units and the whole run for pre-order drops", () => {
    const [row] = attachPreOrderProgress([pre], [{ dropId: "d1", units: "12" }], [{ dropId: "d1", units: 38 }]);
    expect(row).toMatchObject({ name: "Linen run", preOrderedUnits: 12, totalUnits: 50 });
  });

  it("sums rows per drop and ignores rows with no drop", () => {
    const [row] = attachPreOrderProgress(
      [pre],
      [{ dropId: "d1", units: 2 }, { dropId: "d1", units: 3 }, { dropId: null, units: 9 }],
      [{ dropId: "d1", units: 5 }],
    );
    expect(row).toMatchObject({ preOrderedUnits: 5, totalUnits: 10 });
  });

  it("shows 0 of Y before the first pre-order", () => {
    const [row] = attachPreOrderProgress([pre], [], [{ dropId: "d1", units: 40 }]);
    expect(row).toMatchObject({ preOrderedUnits: 0, totalUnits: 40 });
  });

  it("leaves pre-made drops and empty runs alone", () => {
    const rows = attachPreOrderProgress([made, pre], [{ dropId: "d2", units: 4 }], [{ dropId: "d2", units: 6 }]);
    expect(rows[0]).toMatchObject({ preOrderedUnits: null, totalUnits: null });
    expect(rows[1]).toMatchObject({ preOrderedUnits: null, totalUnits: null });
  });

  it("never goes negative on bad numbers", () => {
    const [row] = attachPreOrderProgress([pre], [{ dropId: "d1", units: -3 }], [{ dropId: "d1", units: "x" }]);
    expect(row).toMatchObject({ preOrderedUnits: null, totalUnits: null });
  });
});
