/**
 * Every Stripe event the webhook route handles must be one the endpoint is
 * subscribed to. A handled-but-unsubscribed event silently never arrives —
 * that is how paid in-app (PaymentSheet / Apple Pay) carts stopped becoming
 * orders: payment_intent.* was handled in routes/webhooks.ts but missing here.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../stripe", () => ({ stripe: null, STRIPE_WEBHOOK_SECRET: "" }));

import { REQUIRED_EVENTS } from "../ensureWebhookEvents";

// Delivered only to a Connect endpoint (event.account set), not this one.
const CONNECT_ONLY = new Set(["payout.paid"]);

describe("Stripe webhook subscription", () => {
  it("subscribes to every event type routes/webhooks.ts handles", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "../../routes/webhooks.ts"), "utf8");
    const handled = [...source.matchAll(/case "([a-z_]+\.[a-z_.]+)"/g)]
      .map((m) => m[1])
      .filter((type) => !CONNECT_ONLY.has(type));
    expect(handled).toContain("payment_intent.succeeded");
    const missing = [...new Set(handled)].filter((type) => !(REQUIRED_EVENTS as readonly string[]).includes(type));
    expect(missing).toEqual([]);
  });
});
