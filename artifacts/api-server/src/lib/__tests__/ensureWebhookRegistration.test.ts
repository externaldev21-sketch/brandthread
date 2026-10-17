import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../stripe", () => ({ stripe: null, STRIPE_WEBHOOK_SECRET: "" }));
vi.mock("../webOrigin", () => ({ getWebOrigin: () => "https://brandthread.test" }));
import { REQUIRED_EVENTS } from "../ensureWebhookEvents";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every `case "x.y":` label in the Stripe webhook switch. */
function handledStripeEvents(): string[] {
  const source = readFileSync(path.join(here, "../../routes/webhooks.ts"), "utf8");
  return [...source.matchAll(/case\s+"([a-z_]+(?:\.[a-z_]+)+)"\s*:/g)].map((m) => m[1]);
}

describe("managed Stripe webhook subscription (BT-054)", () => {
  it("subscribes to every event routes/webhooks.ts handles", () => {
    const handled = handledStripeEvents();
    expect(handled.length).toBeGreaterThan(20);
    const missing = handled.filter((event) => !(REQUIRED_EVENTS as readonly string[]).includes(event));
    expect(missing).toEqual([]);
  });

  it("includes the in-app checkout PaymentIntent events", () => {
    expect(REQUIRED_EVENTS).toEqual(expect.arrayContaining([
      "payment_intent.succeeded",
      "payment_intent.payment_failed",
      "payment_intent.canceled",
    ]));
  });
});
