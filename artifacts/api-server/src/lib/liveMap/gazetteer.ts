/**
 * City-level geocoding for the seller Live map, from the bundled GeoNames
 * gazetteer in ./gazetteerData.ts (no network, no paid geocoder).
 *
 * resolveCity() takes an order's shipping city/region/country and returns
 * a city-level point, or a US-state / country fallback point, or null when
 * nothing matches. Street, zip and recipient name are never inputs here, so
 * they can't leak into anything built from the result.
 */
import { CITIES, COUNTRY_CENTROIDS, US_STATE_CENTROIDS } from "./gazetteerData";

export interface ResolvedPlace {
  /** Stable aggregation key, e.g. "US:TX:austin", "US:TX:", "DE::". */
  key: string;
  /** Canonical gazetteer city name; "" for a region/country fallback. */
  city: string;
  /** US: two-letter state code. Elsewhere: GeoNames admin1 code or "". */
  region: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lng: number;
  precision: "city" | "region" | "country";
}

interface CityRow { name: string; admin1: string; country: string; lat: number; lng: number }

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US", "united states": "US", "united states of america": "US", america: "US",
  uk: "GB", "united kingdom": "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB",
  "northern ireland": "GB",
};

/** Lowercase, accents stripped, punctuation folded, "Saint"/"St." unified. */
export function normalizePlaceName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[-_,/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(saint|ste|st) /, "st ");
}

/**
 * GeoNames' canonical name → the name sellers expect to read. Display only:
 * matching and the aggregation key still use the GeoNames name.
 */
const DISPLAY_NAMES: Record<string, string> = {
  "New York City": "New York",
};

export function displayCityName(name: string): string {
  return DISPLAY_NAMES[name] ?? name;
}

let index: Map<string, CityRow[]> | null = null;
let stateCentroids: Map<string, [number, number]> | null = null;
let countryCentroids: Map<string, [number, number]> | null = null;
let countryNames: Map<string, string> | null = null;

function parseCentroids(text: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const line of text.split("\n")) {
    const [code, lat, lng] = line.split("\t");
    if (code) out.set(code, [Number(lat), Number(lng)]);
  }
  return out;
}

function load(): void {
  if (index) return;
  index = new Map();
  let country = "";
  for (const line of CITIES.split("\n")) {
    if (line.startsWith("#")) { country = line.slice(1); continue; }
    const [name, admin1, lat, lng] = line.split("\t");
    if (!name) continue;
    const row: CityRow = { name, admin1, country, lat: Number(lat), lng: Number(lng) };
    const norm = normalizePlaceName(name);
    // "New York City" is what GeoNames calls it; addresses say "New York".
    const keys = norm.endsWith(" city") ? [norm, norm.slice(0, -5)] : [norm];
    for (const k of keys) {
      const key = `${country}|${k}`;
      const bucket = index.get(key);
      // Rows are pre-sorted by population, so bucket[0] is the most populous.
      if (bucket) bucket.push(row); else index.set(key, [row]);
    }
  }
  stateCentroids = parseCentroids(US_STATE_CENTROIDS);
  countryCentroids = parseCentroids(COUNTRY_CENTROIDS);
  countryNames = new Map();
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const code of countryCentroids.keys()) {
      const name = names.of(code);
      if (name && name !== code) countryNames.set(normalizePlaceName(name), code);
    }
  } catch { /* Intl without region names: ISO codes + aliases still work */ }
}

function resolveCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    if (code === "UK") return "GB";
    return countryCentroids!.has(code) ? code : null;
  }
  const norm = normalizePlaceName(trimmed);
  return COUNTRY_ALIASES[norm] ?? countryNames!.get(norm) ?? null;
}

function resolveUsState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    return stateCentroids!.has(code) ? code : null;
  }
  return US_STATE_NAMES[normalizePlaceName(trimmed)] ?? null;
}

export function resolveCity(input: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): ResolvedPlace | null {
  load();
  if (!input.city?.trim() && !input.region?.trim() && !input.country?.trim()) return null;
  // Empty country on a domestic checkout is overwhelmingly US in this app.
  const country = input.country && input.country.trim() ? resolveCountry(input.country) : "US";
  if (!country) return null;
  const usState = country === "US" ? resolveUsState(input.region) : null;
  const regionRaw = (input.region ?? "").trim();

  const cityNorm = input.city ? normalizePlaceName(input.city) : "";
  if (cityNorm) {
    const candidates = index!.get(`${country}|${cityNorm}`);
    if (candidates && candidates.length) {
      let match: CityRow | undefined;
      if (country === "US") {
        // A US city name without a matching state is ambiguous (Paris, TX vs
        // Paris, TN): only trust it when the state agrees, or no state was given.
        match = usState ? candidates.find((c) => c.admin1 === usState) : candidates[0];
      } else {
        match = candidates.find((c) => c.admin1 && c.admin1.toLowerCase() === regionRaw.toLowerCase()) ?? candidates[0];
      }
      if (match) {
        return {
          key: `${country}:${match.admin1}:${normalizePlaceName(match.name)}`,
          city: displayCityName(match.name),
          region: match.admin1,
          country,
          lat: match.lat,
          lng: match.lng,
          precision: "city",
        };
      }
    }
  }

  if (usState) {
    const [lat, lng] = stateCentroids!.get(usState)!;
    return { key: `US:${usState}:`, city: "", region: usState, country, lat, lng, precision: "region" };
  }
  const centroid = countryCentroids!.get(country);
  if (!centroid) return null;
  return { key: `${country}::`, city: "", region: "", country, lat: centroid[0], lng: centroid[1], precision: "country" };
}
