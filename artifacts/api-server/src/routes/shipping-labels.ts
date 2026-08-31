import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db, orders, shippingLabelQuotes, shippingLabels, orderFundReservations, dropWallets,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { createShipment, findTransaction, purchaseTransaction, refundTransaction } from "../lib/shippo";
import { isPendingProviderPurchase } from "../lib/shippingOperationPolicy";

const router = Router();
router.use(requireAuth);
router.use(teamContext());
const ELIGIBLE_STATUSES = ["pending", "processing", "fulfilled"];

function cents(amount: string): number {
  const match = amount.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw Object.assign(new Error("Shipping provider returned an invalid rate"), { status: 502 });
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function address(value: any) {
  return {
    name: value?.name,
    street1: value?.street ?? value?.line1,
    street2: value?.line2 ?? undefined,
    city: value?.city,
    state: value?.state,
    zip: value?.zip,
    country: value?.country ?? "US",
    phone: value?.phone,
    email: value?.email,
  };
}

router.post("/:orderId/rates", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [order] = await db.select().from(orders).where(and(
    eq(orders.id, req.params.orderId), eq(orders.ownerId, ownerId),
  )).limit(1);
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (!ELIGIBLE_STATUSES.includes(order.status)) {
    return void res.status(409).json({ error: "Labels are only available before shipment" });
  }
  try {
    const shipment = await createShipment({
      address_from: address(req.body.fromAddress),
      address_to: address(order.shippingAddress),
      parcels: [{
        length: req.body.length, width: req.body.width, height: req.body.height,
        distance_unit: "in", weight: req.body.weight, mass_unit: "lb",
      }],
    });
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await db.insert(shippingLabelQuotes).values(shipment.rates.map((rate) => ({
      orderId: order.id,
      ownerId,
      providerShipmentId: shipment.object_id,
      providerRateId: rate.object_id,
      carrier: rate.provider,
      service: rate.servicelevel?.name ?? rate.servicelevel?.token ?? "Shipping",
      priceCents: cents(rate.amount),
      expiresAt,
    }))).onConflictDoNothing();
    res.json({
      shipmentId: shipment.object_id,
      rates: shipment.rates.map((rate) => ({
        id: rate.object_id, carrier: rate.provider, service: rate.servicelevel?.name ?? rate.servicelevel?.token ?? "Shipping",
        priceCents: cents(rate.amount), currency: rate.currency, estimatedDays: rate.estimated_days,
        estimatedDelivery: rate.duration_terms, trackingIncluded: true, insuranceIncluded: false,
      })),
    });
  } catch (err: any) {
    req.log.error({ err, providerBody: err.providerBody, orderId: order.id }, "Shipping rates failed");
    res.status(err.status === 401 || err.status === 403 ? 503 : 502).json({ error: "Shipping rates are unavailable" });
  }
});

router.post("/:orderId/purchase", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { rateId, idempotencyKey } = req.body;
  if (!rateId || !idempotencyKey) {
    return void res.status(400).json({ error: "rateId and idempotencyKey are required" });
  }

  try {
    let label!: typeof shippingLabels.$inferSelect;
    let duplicate = false;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
      const lock = await tx.execute(sql`
        SELECT * FROM orders WHERE id = ${req.params.orderId}::uuid AND owner_id = ${ownerId} FOR UPDATE
      `);
      const order = (lock as any).rows?.[0];
      if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
      const openResult = await tx.execute(sql`
        SELECT * FROM shipping_labels
        WHERE order_id = ${order.id}::uuid
          AND owner_id = ${ownerId}
          AND status IN ('purchasing', 'active', 'void_pending')
        ORDER BY created_at DESC LIMIT 1
      `);
      const open = (openResult as any).rows?.[0];
      if (open) {
        label = {
          ...open,
          orderId: open.order_id,
          ownerId: open.owner_id,
          idempotencyKey: open.idempotency_key,
          providerRateId: open.provider_rate_id,
          providerShipmentId: open.provider_shipment_id,
          providerTransactionId: open.provider_transaction_id,
          trackingNumber: open.tracking_number,
          labelUrl: open.label_url,
          priceCents: open.price_cents,
          previousOrderStatus: open.previous_order_status,
          createdAt: open.created_at,
          updatedAt: open.updated_at,
          refundedAt: open.refunded_at,
        };
        duplicate = open.status !== "purchasing";
        return;
      }
      if (!ELIGIBLE_STATUSES.includes(order.status)) {
        throw Object.assign(new Error("Labels are only available before shipment"), { status: 409 });
      }
      const [quote] = await tx.select().from(shippingLabelQuotes).where(and(
        eq(shippingLabelQuotes.orderId, order.id),
        eq(shippingLabelQuotes.ownerId, ownerId),
        eq(shippingLabelQuotes.providerRateId, rateId),
      )).limit(1);
      if (!quote || quote.expiresAt.valueOf() <= Date.now()) {
        throw Object.assign(new Error("This shipping rate is expired or does not belong to this order"), { status: 409, code: "INVALID_SHIPPING_QUOTE" });
      }
      const priceCents = quote.priceCents;

      const reservedResult = await tx.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::int AS reserved
        FROM order_fund_reservations
        WHERE order_id = ${req.params.orderId}::uuid AND status IN ('reserved', 'spent')
      `);
      const reserved = Number((reservedResult as any).rows?.[0]?.reserved ?? 0);
      if (Number(order.total_cents) - reserved < priceCents) {
        throw Object.assign(new Error("Insufficient pending order funds for this label"), { status: 409, code: "INSUFFICIENT_PENDING_FUNDS" });
      }

      let wallet: any = null;
      if (order.drop_id) {
        const walletLock = await tx.execute(sql`
          SELECT * FROM drop_wallets WHERE drop_id = ${order.drop_id}::uuid AND seller_id = ${ownerId} FOR UPDATE
        `);
        wallet = (walletLock as any).rows?.[0];
        const available = wallet ? Number(wallet.balance_cents) - Number(wallet.released_cents) - Number(wallet.reserved_cents) : 0;
        if (!wallet || available < priceCents) {
          throw Object.assign(new Error("Insufficient pending preorder funds for this label"), { status: 409, code: "INSUFFICIENT_PENDING_FUNDS" });
        }
      }

      [label] = await tx.insert(shippingLabels).values({
        orderId: order.id, ownerId, idempotencyKey, providerRateId: rateId,
        providerShipmentId: quote.providerShipmentId,
        carrier: quote.carrier, service: quote.service,
        priceCents, status: "purchasing", previousOrderStatus: order.status,
      }).returning();
      await tx.insert(orderFundReservations).values({
        orderId: order.id, ownerId, shippingLabelId: label.id, amountCents: priceCents, status: "reserved",
      });
      if (wallet) {
        await tx.update(dropWallets).set({ reservedCents: sql`${dropWallets.reservedCents} + ${priceCents}`, updatedAt: new Date() })
          .where(eq(dropWallets.id, wallet.id));
      }
      await tx.update(orders).set({ status: "label_purchasing", updatedAt: new Date() }).where(eq(orders.id, order.id));
    });
    if (duplicate) {
      return void res.json({
        label,
        duplicate: true,
        fundingSource: "pending_order_funds",
      });
    }

    const providerFailure: { value: { code: string; message: string } | null } = { value: null };
    label = await db.transaction(async (tx) => {
      // Keep these database locks for the complete provider lookup/create. A
      // concurrent retry waits here; a crashed process releases them so the
      // next request can reconcile by the stable provider reference.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
      await tx.execute(sql`SELECT id FROM orders WHERE id = ${label.orderId}::uuid FOR UPDATE`);
      const labelLock = await tx.execute(sql`SELECT * FROM shipping_labels WHERE id = ${label.id}::uuid FOR UPDATE`);
      const current = (labelLock as any).rows?.[0];
      if (current?.status === "active") {
        return {
          ...label,
          providerTransactionId: current.provider_transaction_id,
          trackingNumber: current.tracking_number,
          labelUrl: current.label_url,
          status: current.status,
        };
      }

      const providerReference = `brandthread-label/${label.id}`;
      const transaction = await findTransaction(providerReference)
        ?? await purchaseTransaction(label.providerRateId, providerReference);
      if (transaction.status !== "SUCCESS") {
        if (isPendingProviderPurchase(transaction.status)) {
          throw Object.assign(new Error("Carrier label purchase is still pending"), {
            status: 202,
            purchasePending: true,
            providerStatus: transaction.status,
          });
        }
        await tx.update(shippingLabels).set({
          status: "failed",
          failureReason: "Carrier rejected label purchase",
          idempotencyKey: `${label.idempotencyKey}:failed:${label.id}`,
          updatedAt: new Date(),
        }).where(eq(shippingLabels.id, label.id));
        await tx.update(orderFundReservations).set({ status: "released", updatedAt: new Date() })
          .where(eq(orderFundReservations.shippingLabelId, label.id));
        const [order] = await tx.select({ dropId: orders.dropId }).from(orders).where(eq(orders.id, label.orderId)).limit(1);
        if (order?.dropId) {
          await tx.update(dropWallets).set({
            reservedCents: sql`GREATEST(0, ${dropWallets.reservedCents} - ${label.priceCents})`,
            updatedAt: new Date(),
          }).where(eq(dropWallets.dropId, order.dropId));
        }
        await tx.update(orders).set({ status: label.previousOrderStatus ?? "processing", updatedAt: new Date() })
          .where(and(eq(orders.id, label.orderId), eq(orders.status, "label_purchasing")));
        providerFailure.value = { code: "LABEL_PURCHASE_REJECTED", message: "Carrier rejected label purchase" };
        return { ...label, status: "failed" };
      }
      const [updated] = await tx.update(shippingLabels).set({
        providerTransactionId: transaction.object_id,
        carrier: transaction.rate?.provider ?? label.carrier,
        service: transaction.rate?.servicelevel?.name ?? label.service,
        trackingNumber: transaction.tracking_number,
        labelUrl: transaction.label_url,
        status: "active",
        updatedAt: new Date(),
      }).where(and(eq(shippingLabels.id, label.id), eq(shippingLabels.status, "purchasing"))).returning();
      await tx.update(orderFundReservations).set({ status: "spent", updatedAt: new Date() })
        .where(eq(orderFundReservations.shippingLabelId, label.id));
      await tx.update(orders).set({
        status: label.previousOrderStatus ?? "processing",
        updatedAt: new Date(),
      }).where(and(eq(orders.id, label.orderId), eq(orders.status, "label_purchasing")));
      return updated ?? label;
    });
    if (providerFailure.value) {
      return void res.status(409).json({ error: providerFailure.value.message, code: providerFailure.value.code });
    }
    res.status(201).json({ label, duplicate: false, fundingSource: "pending_order_funds" });
  } catch (err: any) {
    if (err.purchasePending) {
      return void res.status(202).json({
        error: err.message,
        purchasePending: true,
        providerStatus: err.providerStatus,
        fundingSource: "pending_order_funds",
      });
    }
    if (err.status && err.status < 500) return void res.status(err.status).json({ error: err.message, code: err.code });
    req.log.error({ err, orderId: req.params.orderId }, "Shipping label purchase failed");
    res.status(502).json({ error: "Shipping label purchase failed" });
  }
});

router.post("/:orderId/:labelId/void", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const claim = await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`
      SELECT * FROM shipping_labels
      WHERE id = ${req.params.labelId}::uuid
        AND order_id = ${req.params.orderId}::uuid
        AND owner_id = ${ownerId}
      FOR UPDATE
    `);
    const current = (lock as any).rows?.[0];
    if (!current) return null;
    if (current.status === "voided") return { label: current, claimed: false };
    if (current.status === "void_pending") {
      const stale = Date.now() - new Date(current.updated_at).valueOf() >= 30_000;
      if (!stale) return { label: current, claimed: false };
      const [reclaimed] = await tx.update(shippingLabels).set({ updatedAt: new Date() })
        .where(and(eq(shippingLabels.id, current.id), eq(shippingLabels.status, "void_pending"))).returning();
      return { label: reclaimed ?? current, claimed: Boolean(reclaimed) };
    }
    const [claimed] = await tx.update(shippingLabels).set({ status: "void_pending", updatedAt: new Date() })
      .where(and(eq(shippingLabels.id, current.id), eq(shippingLabels.status, "active"))).returning();
    return { label: claimed ?? current, claimed: Boolean(claimed) };
  });
  if (!claim) return void res.status(404).json({ error: "Label not found" });
  const label = claim.label;
  if (label.status === "voided") return void res.json({ label, duplicate: true });
  if (!claim.claimed) {
    return void res.json({ label, duplicate: true, refundPending: true });
  }
  const providerTransactionId = label.providerTransactionId ?? label.provider_transaction_id;
  if (!providerTransactionId) return void res.status(409).json({ error: "Label cannot be voided" });
  try {
    const refund = await refundTransaction(providerTransactionId);
    const pending = refund.status !== "SUCCESS";
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx.update(shippingLabels).set({
        status: pending ? "void_pending" : "voided", refundedAt: pending ? null : new Date(), updatedAt: new Date(),
      }).where(eq(shippingLabels.id, label.id)).returning();
      if (!pending) {
        await tx.update(orderFundReservations).set({ status: "refunded", updatedAt: new Date() }).where(eq(orderFundReservations.shippingLabelId, label.id));
        const [order] = await tx.select({ dropId: orders.dropId }).from(orders).where(eq(orders.id, label.orderId)).limit(1);
        if (order?.dropId) {
          await tx.update(dropWallets).set({
            reservedCents: sql`GREATEST(0, ${dropWallets.reservedCents} - ${label.priceCents})`,
            updatedAt: new Date(),
          }).where(eq(dropWallets.dropId, order.dropId));
        }
      }
      return next;
    });
    res.json({ label: updated, refundPending: pending });
  } catch (err) {
    req.log.error({ err, labelId: label.id }, "Shipping label void failed");
    res.status(502).json({ error: "Shipping provider could not void this label" });
  }
});

export default router;