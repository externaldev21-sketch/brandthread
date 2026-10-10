import { describe, expect, it } from "vitest";
import { chooseShipFrom, isCompleteAddress, isSameAddress } from "../shipFrom";

const buyer = { name: "Jordan", line1: "1 Main St", city: "Los Angeles", state: "CA", zip: "90001", country: "US" };
const studio = { name: "Studio", street: "500 Market St", city: "San Francisco", state: "CA", zip: "94105", country: "US" };

describe("ship-from address", () => {
  it("needs street, city and ZIP", () => {
    expect(isCompleteAddress(studio)).toBe(true);
    expect(isCompleteAddress({ ...studio, zip: "" })).toBe(false);
    expect(isCompleteAddress(undefined)).toBe(false);
  });

  it("treats the same street + ZIP as the same place, ignoring case and spacing", () => {
    expect(isSameAddress({ street: " 1  MAIN st ", zip: "90001-1234" }, buyer)).toBe(true);
    expect(isSameAddress(studio, buyer)).toBe(false);
  });

  it("never uses the buyer's address as the sender", () => {
    const result = chooseShipFrom(buyer, null, buyer);
    expect(result).toMatchObject({ ok: false, code: "SHIP_FROM_REQUIRED" });
  });

  it("falls back from a buyer-shaped request to the saved location", () => {
    expect(chooseShipFrom(buyer, studio, buyer)).toEqual({ ok: true, address: studio, source: "location" });
  });

  it("uses a complete, different request address as sent", () => {
    expect(chooseShipFrom(studio, null, buyer)).toEqual({ ok: true, address: studio, source: "request" });
  });

  it("refuses a saved location that is the buyer's own address", () => {
    expect(chooseShipFrom(null, { ...buyer, street: buyer.line1 }, buyer)).toMatchObject({ ok: false, code: "SHIP_FROM_IS_BUYER" });
  });
});
