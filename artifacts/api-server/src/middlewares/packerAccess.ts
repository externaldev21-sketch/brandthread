/**
 * Packer seat: a team member who only packs and ships orders.
 *
 * Enforced deny-by-default, centrally: every store-scoped request resolves
 * its team context through `teamContext()` / `requireRole()` /
 * `requirePermission()` / `requirePayoutsRead()` (middlewares/requireRole.ts),
 * and each of those calls `enforcePackerScope` right after resolving. When the
 * caller acts in a store as a `packer`, only the explicit allowlist below
 * passes; everything else gets a 403 with the standard role-error shape
 * (`code: "PERMISSION_REQUIRED"`, which mobile `lib/roleError.ts` already
 * parses) plus the stable `restriction: "PACKER_ORDERS_ONLY"` marker.
 *
 * Requests that never resolve a team context (buyer routes, /auth, /push…)
 * act on the caller's own account, not the store, so they are unaffected.
 *
 * Allowed responses are also redacted for a packer: buyer email addresses and
 * phone numbers are blanked out anywhere in the JSON body. The shipping
 * address (name, street, city, postcode, country) is kept, since a packer
 * needs it on the parcel.
 */
import type { Request, Response } from "express";

export const PACKER_ROLE = "packer" as const;
export const PACKER_RESTRICTION = "PACKER_ORDERS_ONLY" as const;

/** Statuses a packer may move an order to. Cancelling (which refunds) and
 *  re-opening stay with the roles that can see money. */
export const PACKER_ORDER_STATUSES = ["processing", "fulfilled", "shipped"] as const;

type Rule = {
  method: "GET" | "POST" | "PATCH";
  pattern: RegExp;
  /** Optional body check — returns false to deny. */
  body?: (body: any) => boolean;
};

const SEG = "[^/]+";

const PACKER_ALLOWLIST: Rule[] = [
  // Orders to pack: list + detail (detail carries items and shipping address,
  // which is everything a packing slip needs).
  { method: "GET", pattern: /^\/orders\/?$/ },
  { method: "GET", pattern: new RegExp(`^/orders/${SEG}/?$`) },
  // Fulfilment updates.
  {
    method: "PATCH",
    pattern: new RegExp(`^/orders/${SEG}/status/?$`),
    body: (body) => (PACKER_ORDER_STATUSES as readonly string[]).includes(body?.status),
  },
  { method: "PATCH", pattern: new RegExp(`^/orders/${SEG}/tracking/?$`) },
  { method: "PATCH", pattern: new RegExp(`^/orders/${SEG}/items-tracking/?$`) },
  { method: "PATCH", pattern: new RegExp(`^/orders/${SEG}/fulfillment-checklist/?$`) },
  // Shipping labels for an order.
  { method: "GET", pattern: new RegExp(`^/shipping-labels/${SEG}/parcel-suggestion/?$`) },
  { method: "POST", pattern: new RegExp(`^/shipping-labels/${SEG}/rates/?$`) },
  { method: "POST", pattern: new RegExp(`^/shipping-labels/${SEG}/purchase/?$`) },
  { method: "POST", pattern: new RegExp(`^/shipping-labels/${SEG}/${SEG}/void/?$`) },
  // Knowing (and switching) which store and role you act in.
  { method: "GET", pattern: /^\/team\/context\/?$/ },
  { method: "POST", pattern: /^\/team\/context\/?$/ },
  { method: "POST", pattern: new RegExp(`^/team/(invite/)?accept/${SEG}/?$`) },
];

/** Path relative to the API root (`/api` or `/api/v1`), without the query. */
export function apiRelativePath(req: Request): string {
  const raw = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  return raw.replace(/^\/api(\/v1)?(?=\/|$)/, "") || "/";
}

export function isPackerRequestAllowed(method: string, path: string, body: unknown): boolean {
  const m = method.toUpperCase();
  return PACKER_ALLOWLIST.some((rule) =>
    rule.method === m && rule.pattern.test(path) && (!rule.body || rule.body(body)),
  );
}

const CONTACT_KEY = /(email|phone)/i;

/** Blank out every string/number value whose key names an email or phone. */
export function redactBuyerContact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactBuyerContact(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (CONTACT_KEY.test(key) && (typeof v === "string" || typeof v === "number")) {
        out[key] = null;
      } else {
        out[key] = redactBuyerContact(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Returns true when the request may continue. For a packer outside the
 * allowlist it sends the 403 and returns false. Idempotent: safe to call from
 * every team-context middleware on the same request.
 */
export function enforcePackerScope(req: Request, res: Response, role: string | undefined): boolean {
  if (role !== PACKER_ROLE) return true;
  const path = apiRelativePath(req);
  if (!isPackerRequestAllowed(req.method, path, (req as any).body)) {
    res.status(403).json({
      error: "Insufficient permission",
      code: "PERMISSION_REQUIRED",
      requiredPermission: "orders",
      currentRole: PACKER_ROLE,
      restriction: PACKER_RESTRICTION,
      message: "Packers can only see and ship orders. Ask the store owner to change your access.",
    });
    return false;
  }
  if (!(res as any).__packerRedaction) {
    (res as any).__packerRedaction = true;
    const json = res.json.bind(res);
    res.json = ((body: unknown) => json(redactBuyerContact(body))) as Response["json"];
  }
  return true;
}
