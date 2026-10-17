import { describe, expect, it } from "vitest";
import { maskExportRows, normalizeCustomerPrivacy } from "./customerPrivacySettings";

describe("customer privacy settings", () => {
  it("defaults to not masking and ignores non-boolean values", () => {
    expect(normalizeCustomerPrivacy(null)).toEqual({ maskContactInExports: false });
    expect(normalizeCustomerPrivacy({ maskContactInExports: "yes" })).toEqual({ maskContactInExports: false });
    expect(normalizeCustomerPrivacy({ maskContactInExports: true })).toEqual({ maskContactInExports: true });
  });

  it("strips buyer contact fields from exported customers and orders only", () => {
    const [c] = maskExportRows("customers", [{ id: "1", name: "Ada", email: "a@x.test", phone: "1", address: { city: "X" } }]);
    expect(c).toEqual({ id: "1", name: "Ada" });
    const [o] = maskExportRows("orders", [{ id: "o", totalCents: 1, shippingAddress: { city: "X" }, guestEmail: "g@x.test" }]);
    expect(o).toEqual({ id: "o", totalCents: 1 });
  });
});
