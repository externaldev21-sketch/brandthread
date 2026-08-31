import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
  failStripeWebhookEvent,
  renewStripeWebhookLease,
} from "../stripeWebhookLedger";
import webhookRouter from "../../routes/webhooks";

const eventIds: string[] = [];
const eventId = () => {
  const id = `evt_test_${crypto.randomUUID()}`;
  eventIds.push(id);
  return id;
};

afterEach(async () => {
  if (eventIds.length === 0) return;
  await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id IN ${eventIds}`);
  eventIds.length = 0;
});

describe("Stripe webhook event ledger", () => {
  it("no-ops sequential replay after completion", async () => {
    const id = eventId();
    expect((await claimStripeWebhookEvent(id, "checkout.session.completed")).claimed).toBe(true);
    await completeStripeWebhookEvent(id, 1);
    expect((await claimStripeWebhookEvent(id, "checkout.session.completed")).claimed).toBe(false);
  });

  it("allows only one concurrent claimant", async () => {
    const id = eventId();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimStripeWebhookEvent(id, "account.updated")),
    );
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
  });

  it("allows a failed handler to be retried", async () => {
    const id = eventId();
    expect((await claimStripeWebhookEvent(id, "invoice.payment_failed")).claimed).toBe(true);
    await failStripeWebhookEvent(id, 1, new Error("provider details must not persist"));
    expect((await claimStripeWebhookEvent(id, "invoice.payment_failed")).claimed).toBe(true);
    await completeStripeWebhookEvent(id, 2);
  });

  it("renews only the active claim's lease", async () => {
    const id = eventId();
    expect((await claimStripeWebhookEvent(id, "payment_intent.succeeded")).claimed).toBe(true);
    expect(await renewStripeWebhookLease(id, 1)).toBe(true);
    expect(await renewStripeWebhookLease(id, 2)).toBe(false);
    await completeStripeWebhookEvent(id, 1);
  });

  it("processes different event ids independently", async () => {
    const first = eventId();
    const second = eventId();
    const claims = await Promise.all([
      claimStripeWebhookEvent(first, "charge.refunded"),
      claimStripeWebhookEvent(second, "charge.refunded"),
    ]);
    expect(claims.every((claim) => claim.claimed)).toBe(true);
  });

  it("applies replay protection uniformly across supported event families", async () => {
    for (const type of [
      "account.updated",
      "customer.subscription.updated",
      "identity.verification_session.verified",
      "charge.dispute.created",
      "checkout.session.completed",
      "payment_intent.succeeded",
    ]) {
      const id = eventId();
      expect((await claimStripeWebhookEvent(id, type)).claimed).toBe(true);
      await completeStripeWebhookEvent(id, 1);
      expect((await claimStripeWebhookEvent(id, type)).claimed).toBe(false);
    }
  });

  it("rejects invalid signatures before writing the ledger", async () => {
    const id = eventId();
    const app = express();
    app.use(express.raw({ type: "application/json" }));
    app.use((req, _res, next) => {
      (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
      next();
    });
    app.use(webhookRouter);
    let server: Server;
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server!.address() as AddressInfo).port}/stripe`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": "t=1,v1=invalid",
          },
          body: JSON.stringify({ id, type: "checkout.session.completed", data: { object: {} } }),
        },
      );
      expect(response.status).toBe(400);
      const result = await db.execute(sql`
        SELECT count(*)::int AS count
        FROM stripe_webhook_events
        WHERE event_id = ${id}
      `);
      expect(Number((result.rows[0] as { count: number }).count)).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });
});