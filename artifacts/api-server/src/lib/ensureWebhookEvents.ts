/**
 * ensureWebhookEvents — called once at server startup.
 *
 * Keeps one Brandthread Stripe webhook endpoint pointed at the current Replit
 * API artifact and makes sure it includes every event handled by webhooks.ts.
 *
 * Replit development hostnames can change. When there is one legacy
 * Brandthread endpoint, update it in place instead of creating a replacement:
 * Stripe preserves the endpoint's signing secret, so STRIPE_WEBHOOK_SECRET
 * remains valid.
 */

import type Stripe from "stripe";
import { stripe, STRIPE_WEBHOOK_SECRET } from "./stripe";
import { logger } from "./logger";
import { getWebOrigin } from "./webOrigin";

/**
 * Full set of event types the /api/webhooks/stripe handler processes.
 * Keep this in sync with the switch statement in routes/webhooks.ts.
 */
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "account.updated",
  "transfer.created",
  "transfer.updated",
  "transfer.reversed",
  "charge.refunded",
  "charge.refund.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.trial_will_end",
  "invoice.payment_failed",
  "customer.subscription.deleted",
  "identity.verification_session.verified",
  "identity.verification_session.requires_input",
  "identity.verification_session.processing",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

const WEBHOOK_PATH = "/api-server/api/webhooks/stripe";
const LEGACY_WEBHOOK_PATH = "/api/webhooks/stripe";
const MANAGED_METADATA = {
  application: "brandthread",
  managedBy: "api-server",
};

function getCurrentWebhookUrl(): string | null {
  return `${getWebOrigin()}${WEBHOOK_PATH}`;
}

function isBrandthreadWebhook(endpoint: Stripe.WebhookEndpoint): boolean {
  if (
    endpoint.metadata?.application === MANAGED_METADATA.application &&
    endpoint.metadata?.managedBy === MANAGED_METADATA.managedBy
  ) {
    return true;
  }

  try {
    const path = new URL(endpoint.url).pathname;
    return path.endsWith(WEBHOOK_PATH) || path.endsWith(LEGACY_WEBHOOK_PATH);
  } catch {
    return false;
  }
}

function mergedEvents(
  enabledEvents: Stripe.WebhookEndpoint["enabled_events"],
): Stripe.WebhookEndpoint["enabled_events"] {
  if (enabledEvents.includes("*")) return enabledEvents;
  return Array.from(new Set([...enabledEvents, ...REQUIRED_EVENTS]));
}

export async function ensureWebhookEvents(): Promise<void> {
  if (!stripe) {
    logger.warn("ensureWebhookEvents: Stripe not configured — skipping");
    return;
  }

  const desiredUrl = getCurrentWebhookUrl();
  if (!desiredUrl) {
    logger.warn(
      "ensureWebhookEvents: no Replit runtime domain is available",
    );
    return;
  }

  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const exact = endpoints.data.find((endpoint) => endpoint.url === desiredUrl);
    const managed = endpoints.data.filter(isBrandthreadWebhook);

    let endpoint = exact;
    if (!endpoint && managed.length === 1) {
      endpoint = managed[0];
    }

    if (!endpoint && managed.length > 1) {
      logger.error(
        {
          desiredUrl,
          endpointIds: managed.map((candidate) => candidate.id),
        },
        "ensureWebhookEvents: multiple legacy Brandthread endpoints found; refusing to guess which signing secret is configured",
      );
      return;
    }

    if (!endpoint) {
      logger.error(
        { desiredUrl },
        "ensureWebhookEvents: no existing Brandthread endpoint found; refusing to create one because its signing secret cannot be configured safely at runtime",
      );
      return;
    }

    const currentEvents = endpoint.enabled_events;
    const enabledEvents = mergedEvents(currentEvents);
    const urlChanged = endpoint.url !== desiredUrl;
    const eventsChanged =
      enabledEvents.length !== currentEvents.length ||
      enabledEvents.some((event) => !currentEvents.includes(event));
    const metadataChanged =
      endpoint.metadata?.application !== MANAGED_METADATA.application ||
      endpoint.metadata?.managedBy !== MANAGED_METADATA.managedBy;

    if (urlChanged || eventsChanged || metadataChanged) {
      endpoint = await stripe.webhookEndpoints.update(endpoint.id, {
        url: desiredUrl,
        enabled_events: enabledEvents,
        metadata: MANAGED_METADATA,
        description: "Brandthread API webhook",
      });
    }

    logger.info(
      {
        endpointId: endpoint.id,
        desiredUrl,
        urlChanged,
        eventsChanged,
        signingSecretConfigured: Boolean(STRIPE_WEBHOOK_SECRET),
      },
      "ensureWebhookEvents: webhook endpoint is current",
    );
  } catch (err) {
    logger.error(
      { err },
      "ensureWebhookEvents: failed to inspect/update Stripe webhook endpoints",
    );
  }
}
