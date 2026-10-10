import { describe, expect, it } from "vitest";
import {
  normalizeState, normalizeZip, unverifiedDeliveryFlag, verifyTrackDestination, withUnverifiedDeliveryFlag,
} from "../destinationCheck";

const order = { street: "1 Main St", city: "Brooklyn", state: "NY", zip: "11201", country: "US" };

describe("normalizeZip / normalizeState", () => {
  it("keeps the first 5 digits of a US ZIP+4 and compares other postcodes whole", () => {
    expect(normalizeZip("11201-4410")).toBe("11201");
    expect(normalizeZip("112014410")).toBe("11201");
    expect(normalizeZip(" 11201 ")).toBe("11201");
    expect(normalizeZip("sw1a 1aa")).toBe("SW1A1AA");
    expect(normalizeZip(null)).toBe("");
  });
  it("maps state names to USPS codes", () => {
    expect(normalizeState("New York")).toBe("NY");
    expect(normalizeState("ny")).toBe("NY");
    expect(normalizeState("")).toBe("");
  });
});

describe("verifyTrackDestination (BT-070)", () => {
  it("trusts labels bought through Brandthread regardless of track data", () => {
    expect(verifyTrackDestination({ brandthreadLabel: true, orderAddress: null, trackAddressTo: null }))
      .toEqual({ accept: true, reason: "brandthread_label" });
  });

  it("accepts a matching ZIP (first 5)", () => {
    expect(verifyTrackDestination({ brandthreadLabel: false, orderAddress: order, trackAddressTo: { zip: "11201-0001" } }))
      .toEqual({ accept: true, reason: "zip_match" });
  });

  it("rejects a different ZIP even when the city matches", () => {
    expect(verifyTrackDestination({
      brandthreadLabel: false, orderAddress: order, trackAddressTo: { city: "Brooklyn", state: "NY", zip: "11215" },
    })).toEqual({ accept: false, reason: "zip_mismatch" });
  });

  it("falls back to city + state when the carrier has no ZIP", () => {
    expect(verifyTrackDestination({ brandthreadLabel: false, orderAddress: order, trackAddressTo: { city: "BROOKLYN", state: "New York" } }))
      .toEqual({ accept: true, reason: "city_state_match" });
    expect(verifyTrackDestination({ brandthreadLabel: false, orderAddress: order, trackAddressTo: { city: "Austin", state: "TX" } }))
      .toEqual({ accept: false, reason: "city_state_mismatch" });
  });

  it("requires buyer confirmation when there is nothing to compare", () => {
    const none = { accept: false, reason: "no_destination_data" };
    expect(verifyTrackDestination({ brandthreadLabel: false, orderAddress: order, trackAddressTo: null })).toEqual(none);
    expect(verifyTrackDestination({ brandthreadLabel: false, orderAddress: order, trackAddressTo: { state: "NY" } })).toEqual(none);
    expect(verifyTrackDestination({ brandthreadLabel: false, orderAddress: null, trackAddressTo: { zip: "11201" } })).toEqual(none);
  });
});

describe("unverified delivery flag", () => {
  it("is high severity for a mismatch and medium when unverifiable; none when accepted", () => {
    expect(unverifiedDeliveryFlag({ accept: false, reason: "zip_mismatch" })?.severity).toBe("high");
    expect(unverifiedDeliveryFlag({ accept: false, reason: "no_destination_data" })?.code).toBe("tracking_destination_unverified");
    expect(unverifiedDeliveryFlag({ accept: true, reason: "zip_match" })).toBeNull();
  });

  it("is added once and keeps existing risk flags", () => {
    const flag = unverifiedDeliveryFlag({ accept: false, reason: "zip_mismatch" })!;
    const existing = [{ code: "radar_elevated", label: "Elevated risk", severity: "medium" }];
    const next = withUnverifiedDeliveryFlag(existing, flag);
    expect(next?.map((f) => f.code)).toEqual(["radar_elevated", "tracking_destination_mismatch"]);
    expect(withUnverifiedDeliveryFlag(next, flag)).toBeNull();
    expect(withUnverifiedDeliveryFlag(null, flag)).toEqual([flag]);
  });
});
