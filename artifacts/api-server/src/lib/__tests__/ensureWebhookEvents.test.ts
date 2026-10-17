import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { getCurrentWebhookUrl, isBrandthreadWebhook, WEBHOOK_PATH } from "../ensureWebhookEvents";

const endpoint = (url: string, metadata: Record<string, string> = {}) =>
  ({ url, metadata }) as unknown as Stripe.WebhookEndpoint;

describe("ensureWebhookEvents paths", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("points Stripe at the /api route the server actually serves", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(WEBHOOK_PATH).toBe("/api/webhooks/stripe");
    expect(getCurrentWebhookUrl()).toBe("https://brandthread.app/api/webhooks/stripe");
    expect(getCurrentWebhookUrl()).not.toContain("/api-server/");
  });

  it("still recognises an endpoint left on the old /api-server path so it gets repointed", () => {
    expect(isBrandthreadWebhook(endpoint("https://x.replit.dev/api-server/api/webhooks/stripe"))).toBe(true);
    expect(isBrandthreadWebhook(endpoint("https://x.replit.dev/api/webhooks/stripe"))).toBe(true);
    expect(isBrandthreadWebhook(endpoint("https://other.example.com/hooks"))).toBe(false);
  });
});
