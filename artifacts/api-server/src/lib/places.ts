/**
 * Places: validation, find-or-create (duplicate merging), batched lookups for
 * post payloads, and the optional Google Places proxy.
 *
 * Google Places is behind GOOGLE_PLACES_API_KEY (Places API (New), enabled in
 * Google Cloud Console). Without the key every function degrades to the
 * existing-places-only behaviour and nothing throws.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, places } from "@workspace/db";
import { evaluateContent } from "./contentModerator";

export const MAX_PLACE_NAME = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

export interface PlaceDto {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export function normalizePlaceName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s'&.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const round2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function placeDedupeKey(p: {
  normalizedName: string; lat: number | null; lng: number | null; region: string | null; country: string | null;
}): string {
  if (p.lat !== null && p.lng !== null) return `${p.normalizedName}|${round2(p.lat)}|${round2(p.lng)}`;
  return `${p.normalizedName}|${(p.region ?? "").toLowerCase()}|${(p.country ?? "").toLowerCase()}`;
}

export interface PlaceInput {
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  providerPlaceId: string | null;
}

export type PlaceInputResult =
  | { ok: true; value: PlaceInput }
  | { ok: false; status: number; error: string; code?: string };

const optionalText = (v: unknown, max = 80): string | null | undefined => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > max ? undefined : t || null;
};

/** Validates and moderates a client-submitted place. */
export function parsePlaceInput(raw: unknown): PlaceInputResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 400, error: "place must be an object" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.name !== "string") return { ok: false, status: 400, error: "name is required" };
  const name = body.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > MAX_PLACE_NAME) {
    return { ok: false, status: 400, error: `name must be 1-${MAX_PLACE_NAME} characters` };
  }
  if (!normalizePlaceName(name)) return { ok: false, status: 400, error: "name must contain letters or numbers" };
  const city = optionalText(body.city);
  const region = optionalText(body.region);
  const country = optionalText(body.country);
  if (city === undefined || region === undefined || country === undefined) {
    return { ok: false, status: 400, error: "city, region and country must be short strings" };
  }
  let lat: number | null = null;
  let lng: number | null = null;
  if ((body.lat === undefined || body.lat === null) !== (body.lng === undefined || body.lng === null)) {
    return { ok: false, status: 400, error: "lat and lng must be provided together" };
  }
  if (body.lat !== undefined && body.lat !== null) {
    lat = Number(body.lat);
    lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { ok: false, status: 400, error: "lat/lng out of range" };
    }
  }
  const providerPlaceId = typeof body.providerPlaceId === "string" && /^[A-Za-z0-9_-]{5,200}$/.test(body.providerPlaceId)
    ? body.providerPlaceId : null;
  const decision = evaluateContent([name, city, region, country].filter(Boolean).join(" "), "public");
  if (decision.action !== "allow") {
    return {
      ok: false, status: 422, code: "CONTENT_REJECTED",
      error: `${decision.reason} Choose a different place name.`,
    };
  }
  return { ok: true, value: { name, city, region, country, lat, lng, providerPlaceId } };
}

const toNumber = (v: string | number | null): number | null => (v === null || v === undefined ? null : Number(v));

function toDto(row: typeof places.$inferSelect): PlaceDto {
  return {
    id: row.id, name: row.name, city: row.city, region: row.region, country: row.country,
    lat: toNumber(row.lat), lng: toNumber(row.lng),
  };
}

// ─── Google Places (optional) ─────────────────────────────────────────────────

export const placesProviderEnabled = () => !!process.env.GOOGLE_PLACES_API_KEY;

async function googleFetch(url: string, init: RequestInit & { headers: Record<string, string> }): Promise<any | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { ...init, headers: { ...init.headers, "X-Goog-Api-Key": key }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProviderSuggestion {
  providerPlaceId: string;
  name: string;
  secondary: string | null;
}

/** Places Autocomplete (New). Returns [] when the key is missing or the call fails. */
export async function providerAutocomplete(q: string, lat: number | null, lng: number | null): Promise<ProviderSuggestion[]> {
  if (!placesProviderEnabled()) return [];
  const body: Record<string, unknown> = { input: q };
  if (lat !== null && lng !== null) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 30000 } };
  }
  const json = await googleFetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const suggestions: any[] = Array.isArray(json?.suggestions) ? json.suggestions : [];
  return suggestions
    .map((s) => s?.placePrediction)
    .filter((p) => p?.placeId)
    .slice(0, 8)
    .map((p) => ({
      providerPlaceId: String(p.placeId),
      name: String(p.structuredFormat?.mainText?.text ?? p.text?.text ?? "").slice(0, MAX_PLACE_NAME),
      secondary: p.structuredFormat?.secondaryText?.text ? String(p.structuredFormat.secondaryText.text).slice(0, 120) : null,
    }))
    .filter((p) => p.name);
}

/** Places Details (New): coordinates and address parts for one provider place. */
export async function providerDetails(providerPlaceId: string): Promise<Partial<PlaceInput> | null> {
  if (!placesProviderEnabled() || !/^[A-Za-z0-9_-]{5,200}$/.test(providerPlaceId)) return null;
  const json = await googleFetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(providerPlaceId)}`, {
    method: "GET",
    headers: { "X-Goog-FieldMask": "displayName,location,addressComponents" },
  });
  if (!json) return null;
  const parts: any[] = Array.isArray(json.addressComponents) ? json.addressComponents : [];
  const pick = (type: string, field: "longText" | "shortText" = "longText") =>
    parts.find((c) => Array.isArray(c.types) && c.types.includes(type))?.[field] ?? null;
  return {
    name: json.displayName?.text ? String(json.displayName.text).slice(0, MAX_PLACE_NAME) : undefined,
    lat: typeof json.location?.latitude === "number" ? json.location.latitude : null,
    lng: typeof json.location?.longitude === "number" ? json.location.longitude : null,
    city: pick("locality") ?? pick("postal_town") ?? pick("sublocality"),
    region: pick("administrative_area_level_1", "shortText"),
    country: pick("country"),
  };
}

// ─── Find or create ───────────────────────────────────────────────────────────

/** Finds the existing place (provider id, then duplicate key) or creates it. */
export async function findOrCreatePlace(input: PlaceInput, userId: string): Promise<{ place: PlaceDto; created: boolean }> {
  let data = { ...input };
  if (data.providerPlaceId && (data.lat === null || data.lng === null)) {
    const details = await providerDetails(data.providerPlaceId);
    if (details) {
      data = {
        ...data,
        lat: details.lat ?? data.lat, lng: details.lng ?? data.lng,
        city: data.city ?? details.city ?? null, region: data.region ?? details.region ?? null,
        country: data.country ?? details.country ?? null,
      };
    }
  }
  if (data.providerPlaceId) {
    const [byProvider] = await db.select().from(places)
      .where(and(eq(places.provider, "google"), eq(places.providerPlaceId, data.providerPlaceId))).limit(1);
    if (byProvider) return { place: toDto(byProvider), created: false };
  }
  const normalizedName = normalizePlaceName(data.name);
  const dedupeKey = placeDedupeKey({ normalizedName, lat: data.lat, lng: data.lng, region: data.region, country: data.country });
  const [byKey] = await db.select().from(places).where(eq(places.dedupeKey, dedupeKey)).limit(1);
  if (byKey) return { place: toDto(byKey), created: false };

  const inserted = await db.insert(places).values({
    name: data.name,
    normalizedName,
    city: data.city, region: data.region, country: data.country,
    lat: data.lat === null ? null : String(data.lat),
    lng: data.lng === null ? null : String(data.lng),
    dedupeKey,
    provider: data.providerPlaceId ? "google" : null,
    providerPlaceId: data.providerPlaceId,
    createdBy: userId,
  }).onConflictDoNothing().returning();
  if (inserted[0]) return { place: toDto(inserted[0]), created: true };
  // Lost a race with a concurrent insert of the same place.
  const [winner] = await db.select().from(places).where(eq(places.dedupeKey, dedupeKey)).limit(1);
  if (winner) return { place: toDto(winner), created: false };
  throw new Error("Could not create place");
}

export async function getPlace(id: string): Promise<PlaceDto | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(places).where(eq(places.id, id)).limit(1);
  return row ? toDto(row) : null;
}

// ─── Post payloads ────────────────────────────────────────────────────────────

export interface PostLocation { id: string; name: string }

/** One batched query: placeId -> {id, name} for every post in a page. */
export async function locationsByPlaceId(placeIds: Array<string | null | undefined>): Promise<Map<string, PostLocation>> {
  const ids = [...new Set(placeIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: places.id, name: places.name }).from(places).where(inArray(places.id, ids));
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }]));
}

/** `location: {id,name} | null` for a post row carrying `placeId`. */
export function withLocation<T extends { placeId?: string | null }>(
  row: T, byId: Map<string, PostLocation>,
): T & { location: PostLocation | null } {
  return { ...row, location: row.placeId ? byId.get(row.placeId) ?? null : null };
}

export type PostLocationResolution =
  | { ok: true; placeId: string | null | undefined }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Reads the optional `placeId` / `location` fields of a post create/update body.
 * `undefined` = leave unchanged, `null` = clear, string = place id.
 *   placeId: uuid | null
 *   location: { placeId?, name, lat?, lng?, city?, region?, country?, providerPlaceId? } | null
 */
export async function resolvePostLocation(userId: string, body: Record<string, unknown>): Promise<PostLocationResolution> {
  const { placeId, location } = body;
  if (location !== undefined && location !== null) {
    if (typeof location !== "object" || Array.isArray(location)) {
      return { ok: false, status: 400, error: "location must be an object or null" };
    }
    const loc = location as Record<string, unknown>;
    if (loc.placeId !== undefined && loc.placeId !== null) {
      if (!isUuid(loc.placeId) || !(await getPlace(loc.placeId))) {
        return { ok: false, status: 400, error: "Unknown placeId", code: "PLACE_NOT_FOUND" };
      }
      return { ok: true, placeId: loc.placeId };
    }
    const parsed = parsePlaceInput(loc);
    if (!parsed.ok) return parsed;
    const { place } = await findOrCreatePlace(parsed.value, userId);
    return { ok: true, placeId: place.id };
  }
  if (location === null || placeId === null) return { ok: true, placeId: null };
  if (placeId !== undefined) {
    if (!isUuid(placeId) || !(await getPlace(placeId))) {
      return { ok: false, status: 400, error: "Unknown placeId", code: "PLACE_NOT_FOUND" };
    }
    return { ok: true, placeId };
  }
  return { ok: true, placeId: undefined };
}
