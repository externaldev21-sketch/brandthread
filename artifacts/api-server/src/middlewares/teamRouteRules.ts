/**
 * Team rules per seller router, applied by teamContext() for the mount it
 * runs on (req.baseUrl) — so routes/index.ts mounts stay exactly as they are.
 * See docs/flows/team-roles.md.
 *
 *  self       — the router acts for the signed-in PERSON (buyer-side actions,
 *               a creator's own lives/posts/reviews, freelancer profile, AI
 *               chat history, notification prefs), never for the store the
 *               caller selected in the team switcher.
 *  selfPaths  — only these sub-paths act for the person.
 *  writes     — POST/PUT/PATCH/DELETE need this capability on the store
 *               (these routers had no write gate at all).
 *  ownerWrites — writes are owner-only.
 */
import type { Permission } from "./requireRole";
import { normalizeGatePath } from "../lib/gatePath";

export type TeamRouteRule = {
  self?: boolean;
  selfPaths?: Array<string | RegExp>;
  writes?: Permission;
  ownerWrites?: boolean;
};

const RULES: Record<string, TeamRouteRule> = {
  // Act as the signed-in person.
  "/ai": { self: true },
  "/reviews": { self: true },
  "/posts": { self: true },
  "/live": { self: true },
  "/freelancers": { self: true },
  "/freelancers/connect": { self: true },
  "/freelancer-jobs": { self: true },
  "/seller/notification-prefs": { self: true },
  // Mixed routers: a buyer-side or personal part + the store's own part.
  "/waitlist": { selfPaths: ["/join", "/leave", /^\/check\//], writes: "products" },
  "/discount-codes": { selfPaths: ["/validate"] },
  "/seller": { selfPaths: ["/tutorial/seen", "/onboarding/data"], writes: "products" },
  // Store, catalogue and store settings.
  // The public store pages take a visitor's store-password POST (lib/storePasswordGate.ts): no store write.
  "/store": { selfPaths: [/^\/site\/[^/]+$/, /^\/by-username\/[^/]+$/, "/host-site", /^\/public\/[^/]+\/unlock$/], writes: "products" },
  "/store/ai": { writes: "products" },
  "/bundles": { writes: "products" },
  "/integrations": { writes: "products" },
  "/shopify-imports": { writes: "products" },
  "/seller-hub": { writes: "products" },
  "/sample-orders": { writes: "products" },
  "/manufacturers/connect": { writes: "products" },
  "/seller/locations": { writes: "products" },
  "/seller/metafields": { writes: "products" },
  "/seller/settings": { writes: "products" },
  "/seller/vacation": { writes: "products" },
  // Mounted ahead of the /seller catch-all (routes/index.ts); these keep the
  // "products" write gate they used to get from the catch-all's rule.
  "/seller/payment-settings": { writes: "products" },
  "/seller/quick-replies": { writes: "products" },
  "/seller/away-message": { writes: "products" },
  // Orders and after-sale.
  "/returns": { writes: "orders" },
  "/disputes": { writes: "orders" },
  "/shipping-rates": { writes: "orders" },
  // Customers, marketing, money.
  "/customers": { writes: "customers" },
  "/boosts": { writes: "marketing" },
  "/meta-ads": { writes: "marketing" },
  "/taxes": { writes: "payouts" },
  "/drop-wallets": { writes: "payouts" },
  // The owner's identity verification.
  "/seller/verification": { ownerWrites: true },
};

/**
 * The mount a request is running under, relative to /api (or /api/v1).
 * req.baseUrl keeps the caller's spelling, and Express mounts match any case
 * and a trailing slash (`/api/STORE` runs the /store routers), so the lookup
 * uses the canonical form; otherwise a variant spelling skipped the rule.
 */
export function mountPathOf(baseUrl: string | undefined): string {
  return normalizeGatePath(String(baseUrl ?? "")).replace(/^\/api(\/v1)?(?=\/|$)/, "") || "/";
}

export function teamRouteRuleFor(baseUrl: string | undefined): TeamRouteRule | null {
  return RULES[mountPathOf(baseUrl)] ?? null;
}

export function actsAsSelf(rule: TeamRouteRule | null, subPath: string): boolean {
  if (!rule) return false;
  if (rule.self) return true;
  const path = normalizeGatePath(subPath);
  return (rule.selfPaths ?? []).some((p) => (typeof p === "string" ? path === p : p.test(path)));
}
