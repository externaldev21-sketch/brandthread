/**
 * Address helpers for checkout:
 *  - the Google Places key for street-address suggestions, and how a failed
 *    Places call is reported to the app;
 *  - ZIP → city / state, so most buyers never open the State picker.
 *
 * Street suggestions use Google Places API (New). Either env var works, so
 * the key already set for location tags also serves checkout:
 *   GOOGLE_MAPS_API_KEY (checkout's original name) or GOOGLE_PLACES_API_KEY.
 * The key must have "Places API (New)" enabled (Google Cloud Console → APIs &
 * Services) and must not be restricted to HTTP referrers or app bundles: it
 * is used from this server, never from the app.
 *
 * ZIP lookup needs no account or key: US ZIP codes resolve through the free
 * Zippopotam.us API (https://api.zippopotam.us), cached in memory. Any
 * failure returns null and the buyer types city and state themselves.
 */

/** The server-side Google Places key, from either env var name. */
export function addressPlacesApiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim() || process.env.GOOGLE_PLACES_API_KEY?.trim();
  return key || null;
}

export type PlacesFailure = {
  /** HTTP status for the app: 503 = search can't work until the key is fixed (manual entry), 502 = try again. */
  status: 502 | 503;
  code: "PLACES_MISCONFIGURED" | "PLACES_UNAVAILABLE";
  /** Google's own reason, for the server log only. */
  detail: string;
};

/**
 * How a non-OK Google Places response is reported. A rejected key (invalid,
 * Places API (New) not enabled, billing off, or restricted to a referrer)
 * can never succeed on retry, so the app shows manual entry instead of
 * "Suggestions aren't loading · Try again".
 */
export function classifyPlacesFailure(googleStatus: number, body: unknown): PlacesFailure {
  const error = (body as { error?: { status?: string; message?: string } } | null)?.error;
  const detail = `${googleStatus} ${error?.status ?? ""} ${error?.message ?? ""}`.replace(/\s+/g, " ").trim();
  const keyProblem = googleStatus === 401 || googleStatus === 403
    || (googleStatus === 400 && /API key|API_KEY/i.test(error?.message ?? ""));
  return keyProblem
    ? { status: 503, code: "PLACES_MISCONFIGURED", detail }
    : { status: 502, code: "PLACES_UNAVAILABLE", detail };
}

// ─── ZIP → city / state ───────────────────────────────────────────────────────

export type PostalLookup = { postalCode: string; city: string; state: string; country: "US" };

const CACHE_MAX = 2000;
const cache = new Map<string, PostalLookup | null>();

function remember(zip: string, value: PostalLookup | null) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(zip, value);
}

/** Title case for city names that come back upper-case ("NEW YORK" → "New York"). */
function cityCase(city: string): string {
  return city === city.toUpperCase()
    ? city.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    : city;
}

/**
 * City and state for a 5-digit US ZIP code, or null when unknown or the
 * lookup service is down. Never throws.
 */
export async function lookupUsZip(zip: string, fetcher: typeof fetch = fetch): Promise<PostalLookup | null> {
  const code = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(code)) return null;
  if (cache.has(code)) return cache.get(code) ?? null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetcher(`https://api.zippopotam.us/us/${code}`, { signal: controller.signal });
    if (res.status === 404) { remember(code, null); return null; }
    if (!res.ok) return null; // not cached: may work next time
    const body = await res.json() as { places?: Array<Record<string, string>> };
    const place = body.places?.[0];
    const city = place?.["place name"]?.trim();
    const state = place?.["state abbreviation"]?.trim().toUpperCase();
    const value = city && state && /^[A-Z]{2}$/.test(state) ? { postalCode: code, city: cityCase(city), state, country: "US" as const } : null;
    remember(code, value);
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function clearPostalCacheForTests() {
  cache.clear();
}
