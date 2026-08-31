import { describe, expect, it } from "vitest";
import { buildOrderStatusUpdate, orderStatusTransitionConflict } from "./orderStatusPolicy";

describe("order status transitions", () => {
  it("always includes the requested ordinary fulfillment status", () => {
    expect(buildOrderStatusUpdate("shipped")).toMatchObject({ status: "shipped" });
    expect(buildOrderStatusUpdate("delivered")).toMatchObject({ status: "delivered" });
  });

  it("blocks fulfillment while a label purchase owns the order", () => {
    expect(orderStatusTransitionConflict("label_purchasing")).toBe("A shipping label purchase is in progress");
    expect(orderStatusTransitionConflict("processing")).toBeNull();
  });
});