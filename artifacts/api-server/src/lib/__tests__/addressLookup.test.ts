import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addressPlacesApiKey, classifyPlacesFailure, clearPostalCacheForTests, lookupUsZip,
} from "../addressLookup";

describe("address suggestions key and failures", () => {
  const saved = { maps: process.env.GOOGLE_MAPS_API_KEY, places: process.env.GOOGLE_PLACES_API_KEY };
  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = saved.maps;
    process.env.GOOGLE_PLACES_API_KEY = saved.places;
    if (saved.maps === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    if (saved.places === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it("reads either env var, GOOGLE_MAPS_API_KEY first", () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(addressPlacesApiKey()).toBeNull();
    process.env.GOOGLE_PLACES_API_KEY = "places-key";
    expect(addressPlacesApiKey()).toBe("places-key");
    process.env.GOOGLE_MAPS_API_KEY = "maps-key";
    expect(addressPlacesApiKey()).toBe("maps-key");
    process.env.GOOGLE_MAPS_API_KEY = "   ";
    expect(addressPlacesApiKey()).toBe("places-key");
  });

  it("a key Google rejects is 'unavailable' (manual entry), an outage is 'try again'", () => {
    const denied = classifyPlacesFailure(403, { error: { status: "PERMISSION_DENIED", message: "Places API (New) has not been used in project 123 before or it is disabled." } });
    expect(denied).toMatchObject({ status: 503, code: "PLACES_MISCONFIGURED" });
    expect(denied.detail).toContain("PERMISSION_DENIED");
    expect(classifyPlacesFailure(400, { error: { message: "API key not valid. Please pass a valid API key." } }).code).toBe("PLACES_MISCONFIGURED");
    expect(classifyPlacesFailure(400, { error: { message: "Invalid input" } })).toMatchObject({ status: 502, code: "PLACES_UNAVAILABLE" });
    expect(classifyPlacesFailure(500, null)).toMatchObject({ status: 502, code: "PLACES_UNAVAILABLE" });
  });
});

describe("ZIP → city / state", () => {
  beforeEach(() => clearPostalCacheForTests());

  const reply = (status: number, body?: unknown) => async () => new Response(body === undefined ? "" : JSON.stringify(body), { status });

  it("returns the city (title case) and the state code, and caches it", async () => {
    let calls = 0;
    const fetcher = (async (url: string) => {
      calls += 1;
      expect(url).toBe("https://api.zippopotam.us/us/10012");
      return new Response(JSON.stringify({ places: [{ "place name": "NEW YORK", "state abbreviation": "NY" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await lookupUsZip("10012", fetcher)).toEqual({ postalCode: "10012", city: "New York", state: "NY", country: "US" });
    expect(await lookupUsZip("10012-1234", fetcher)).toEqual({ postalCode: "10012", city: "New York", state: "NY", country: "US" });
    expect(calls).toBe(1);
  });

  it("is null for unknown or malformed ZIPs and when the service is down, never throws", async () => {
    expect(await lookupUsZip("00000", reply(404, {}) as unknown as typeof fetch)).toBeNull();
    expect(await lookupUsZip("123", reply(200, {}) as unknown as typeof fetch)).toBeNull();
    expect(await lookupUsZip("94110", reply(503) as unknown as typeof fetch)).toBeNull();
    expect(await lookupUsZip("94110", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(await lookupUsZip("94110", reply(200, { places: [{ "place name": "X", "state abbreviation": "Nope" }] }) as unknown as typeof fetch)).toBeNull();
  });
});
