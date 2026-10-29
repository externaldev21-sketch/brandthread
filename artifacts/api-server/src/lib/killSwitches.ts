/**
 * Kill switches for Live, Payments and AI: rows in the existing feature_flags
 * table (migration 533), flipped from the web admin (Admin → Kill switches).
 * `enabled = false` pauses the area for everyone within ~10 seconds.
 *
 * Only the entry points that START something are paused:
 * - liveEnabled:     going live, joining a live, sending a live tip
 * - paymentsEnabled: creating a checkout (in-app, payment intent, guest) and
 *                    buying a gift card. Webhooks, refunds, order updates and
 *                    payouts keep working, so money already in flight settles.
 * - aiEnabled:       every AI generation / chat endpoint
 * Ending a live, leaving, reading, and everything else is untouched.
 *
 * Fail-open: a missing row or an unreadable table means "on". A switch is
 * only ever off because an admin turned it off.
 */
import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";
import { normalizeGatePath } from "./gatePath";

export const KILL_SWITCHES = {
  liveEnabled: {
    label: "Live",
    code: "LIVE_PAUSED",
    message: "Live is paused right now. Try again in a little while.",
  },
  paymentsEnabled: {
    label: "Payments",
    code: "PAYMENTS_PAUSED",
    message: "Checkout is paused right now. Nothing was charged. Try again in a little while.",
  },
  aiEnabled: {
    label: "AI tools",
    code: "AI_PAUSED",
    message: "AI tools are paused right now. Try again in a little while.",
  },
} as const;

export type KillSwitchKey = keyof typeof KILL_SWITCHES;
export const KILL_SWITCH_KEYS = Object.keys(KILL_SWITCHES) as KillSwitchKey[];

const WRITE = new Set(["POST", "PUT", "PATCH"]);

/** Paths are relative to the /api router (no /api or /api/v1 prefix). */
const ROUTES: Record<KillSwitchKey, RegExp[]> = {
  liveEnabled: [
    /^\/live\/start\/?$/,
    /^\/live\/[^/]+\/join\/?$/,
    /^\/live-tips(\/.*)?$/,
  ],
  paymentsEnabled: [
    /^\/buyer\/checkout\/session\/?$/,
    /^\/buyer\/checkout\/payment-intent\/?$/,
    /^\/guest\/checkout\/session\/?$/,
    /^\/gift-cards\/purchase\/?$/,
  ],
  aiEnabled: [
    /^\/(ai|ai-helpers|logo|mockup|photography|bg-removal|lifestyle|techpack|onboarding-sample|brandthread-agent|support-chat)(\/.*)?$/,
    /^\/store\/ai(\/.*)?$/,
  ],
};

// Buying AI credit packs is a payment, not AI generation.
const AI_EXEMPT = [/^\/ai\/credits(\/.*)?$/];

/** Which switch, if any, guards this request. Pure; exported for tests. */
export function switchFor(method: string, rawPath: string): KillSwitchKey | null {
  if (!WRITE.has(method.toUpperCase())) return null;
  // Express routing is case-insensitive and non-strict, so "/Buyer/Checkout/Session"
  // or "/buyer//checkout/session/" still reach the handler: match the canonical form.
  const path = normalizeGatePath(rawPath);
  for (const key of KILL_SWITCH_KEYS) {
    if (key === "aiEnabled" && AI_EXEMPT.some((re) => re.test(path))) continue;
    if (ROUTES[key].some((re) => re.test(path))) return key;
  }
  return null;
}

const TTL_MS = 10_000;
let cache: { at: number; values: Partial<Record<KillSwitchKey, boolean>> } | null = null;

export function resetKillSwitchCache(): void {
  cache = null;
}

/** Current state of every switch (true = on). Cached for 10 seconds; fails open. */
export async function killSwitchStates(now = Date.now()): Promise<Record<KillSwitchKey, boolean>> {
  if (!cache || now - cache.at > TTL_MS) {
    try {
      const { rows } = await pool.query<{ key: string; enabled: boolean }>(
        "SELECT key, enabled FROM feature_flags WHERE key = ANY($1)", [KILL_SWITCH_KEYS]);
      cache = { at: now, values: Object.fromEntries(rows.map((r) => [r.key, r.enabled])) };
    } catch {
      cache = { at: now, values: {} };
    }
  }
  return Object.fromEntries(KILL_SWITCH_KEYS.map((k) => [k, cache!.values[k] !== false])) as Record<KillSwitchKey, boolean>;
}

/** Express middleware, mounted once on the /api router before the feature routers. */
export async function killSwitchGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = switchFor(req.method, req.path);
  if (!key) return next();
  const states = await killSwitchStates();
  if (states[key]) return next();
  const s = KILL_SWITCHES[key];
  res.setHeader("Retry-After", "300");
  res.status(503).json({ error: s.message, code: s.code, paused: true });
}
