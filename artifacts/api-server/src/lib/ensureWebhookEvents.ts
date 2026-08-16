/**
 * ensureWebhookEvents — called once at server startup.
 *
 * Finds the Stripe webhook endpoint that points at this server and makes sure
 * it includes all the event types the handler in webhooks.ts listens for —
 * especially the three subscription events that were missing when the
 * customer.subscription.* handlers were first added.
 *
 * If no matching endpoint is found the function logs a warning and exits
 * cleanly — the server still boots, but real-time subscription updates will
 * not work until the endpoint is registered in the Stripe dashboard.
 */

import { stripe } from "./stripe";
import { logger } from "./logger";

/**
 * Full set of event types the /api/webhooks/stripe handler processes.
 * Keep this in sync with the switch statement in routes/webhooks.ts.
 */
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "account.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "identity.verification_session.verified",
  "identity.verification_session.requires_input",
  "identity.verification_session.processing",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
];

export async function ensureWebhookEvents(): Promise<void> {
  if (!stripe) {
    logger.warn("ensureWebhookEvents: Stripe not configured — skipping");
    return;
  }

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (!devDomain) {
    logger.warn(
      "ensureWebhookEvents: REPLIT_DEV_DOMAIN not set — cannot locate webhook endpoint",
    );
    return;
  }

  try {
    // List all registered webhook endpoints (Stripe caps at 100, well within range)
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });

    // Find the endpoint(s) pointing at this server
    const matching = endpoints.data.filter((ep) =>
      ep.url.includes(devDomain) && ep.url.includes("/webhooks/stripe"),
    );

    if (matching.length === 0) {
      logger.warn(
        { devDomain },
        "ensureWebhookEvents: no webhook endpoint found for this domain — " +
          "register one in the Stripe dashboard pointing to " +
          `https://${devDomain}/api-server/api/webhooks/stripe`,
      );
      return;
    }

    for (const ep of matching) {
      const current = new Set(ep.enabled_events);

      // Check if ["*"] wildcard already covers everything
      if (current.has("*")) {
        logger.info(
          { endpointId: ep.id },
          "ensureWebhookEvents: endpoint uses wildcard (*) — all events already enabled",
        );
        continue;
      }

      const missing = REQUIRED_EVENTS.filter((e) => !current.has(e));
      if (missing.length === 0) {
        logger.info(
          { endpointId: ep.id },
          "ensureWebhookEvents: all required events already enabled",
        );
        continue;
      }

      // Merge and update
      const updated = Array.from(new Set([...ep.enabled_events, ...missing]));
      await stripe.webhookEndpoints.update(ep.id, {
        enabled_events: updated as any,
      });

      logger.info(
        { endpointId: ep.id, added: missing },
        "ensureWebhookEvents: webhook endpoint updated with missing events",
      );
    }
  } catch (err) {
    // Non-fatal — the server still boots; log and move on.
    logger.error(
      { err },
      "ensureWebhookEvents: failed to inspect/update Stripe webhook endpoints",
    );
  }
}
