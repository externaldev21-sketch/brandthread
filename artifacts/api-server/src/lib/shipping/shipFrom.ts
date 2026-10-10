/**
 * Ship-from address for shipping labels.
 *
 * A label must ship from the seller. The client used to fall back to the
 * buyer's own address when it had no seller address, which quoted
 * buyer-to-buyer rates and printed the buyer as the sender (returns went to
 * the buyer). Now: an address the client sends is used only when it is
 * complete and differs from the destination; otherwise the seller's primary
 * active location (Settings → Locations) is used; otherwise the request is
 * refused with SHIP_FROM_REQUIRED so the app can ask for one.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, sellerLocations } from "@workspace/db";

export type ShipFromAddress = {
  name?: string | null;
  street?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type ShipFromResult =
  | { ok: true; address: ShipFromAddress; source: "request" | "location" }
  | { ok: false; status: 400; code: "SHIP_FROM_REQUIRED" | "SHIP_FROM_IS_BUYER"; error: string };

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function street(a: ShipFromAddress | null | undefined): string {
  return clean(a?.street ?? a?.line1);
}

/** Street, city and ZIP are the minimum a carrier needs for the sender. */
export function isCompleteAddress(a: ShipFromAddress | null | undefined): boolean {
  return !!a && !!street(a) && !!clean(a.city) && !!clean(a.zip);
}

/** Same street + ZIP (first 5) means the "sender" is the buyer. */
export function isSameAddress(a: ShipFromAddress | null | undefined, b: ShipFromAddress | null | undefined): boolean {
  if (!a || !b) return false;
  const zipA = clean(a.zip).slice(0, 5);
  const zipB = clean(b.zip).slice(0, 5);
  return !!street(a) && street(a) === street(b) && !!zipA && zipA === zipB;
}

/** Pure decision: request address → saved location → refuse. */
export function chooseShipFrom(
  requested: ShipFromAddress | null | undefined,
  location: ShipFromAddress | null | undefined,
  destination: ShipFromAddress | null | undefined,
): ShipFromResult {
  if (isCompleteAddress(requested) && !isSameAddress(requested, destination)) {
    return { ok: true, address: requested!, source: "request" };
  }
  if (isCompleteAddress(location)) {
    if (isSameAddress(location, destination)) {
      return { ok: false, status: 400, code: "SHIP_FROM_IS_BUYER", error: "Your ship-from address matches the buyer's address. Update it in Settings → Locations." };
    }
    return { ok: true, address: location!, source: "location" };
  }
  return { ok: false, status: 400, code: "SHIP_FROM_REQUIRED", error: "Add your ship-from address in Settings → Locations to buy labels." };
}

/** The seller's primary active location, shaped like an order address. */
export async function primaryShipFromLocation(ownerId: string): Promise<ShipFromAddress | null> {
  const [loc] = await db.select().from(sellerLocations)
    .where(and(eq(sellerLocations.ownerId, ownerId), eq(sellerLocations.isActive, true)))
    .orderBy(desc(sellerLocations.isPrimary), sellerLocations.createdAt)
    .limit(1);
  if (!loc) return null;
  return {
    name: loc.name, street: loc.address, city: loc.city, state: loc.state,
    zip: loc.zip, country: loc.country, phone: loc.phone,
  };
}

export async function resolveShipFrom(
  ownerId: string,
  requested: ShipFromAddress | null | undefined,
  destination: ShipFromAddress | null | undefined,
): Promise<ShipFromResult> {
  if (isCompleteAddress(requested) && !isSameAddress(requested, destination)) {
    return { ok: true, address: requested!, source: "request" };
  }
  return chooseShipFrom(null, await primaryShipFromLocation(ownerId), destination);
}
