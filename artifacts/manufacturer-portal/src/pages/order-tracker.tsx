import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, ExternalLink, Loader2, MessageSquare, Package, Shirt, Truck, XCircle } from "lucide-react";
import { getGetManufacturerSampleOrderQueryKey, useGetManufacturerSampleOrder } from "@workspace/api-client-react";
import { deriveCardState, formatMoney, formatTimestamp, orderStatusLabel, orderTypeLabel } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, QueryError } from "@/components/query-state";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { TrackingDialog } from "@/components/orders/tracking-dialog";
import { useOrderActions, useOrderTimeline } from "@/hooks/use-order-actions";
import { errorMessage } from "@/lib/api";

const ACTOR_LABEL: Record<string, string> = { manufacturer: "You", seller: "Seller", payment_system: "Stripe" };

export default function OrderTracker({ orderId }: { orderId: string }) {
  const timeline = useOrderTimeline(orderId);
  const detail = useGetManufacturerSampleOrder(orderId, {
    query: { queryKey: getGetManufacturerSampleOrderQueryKey(orderId), refetchInterval: 30_000 },
  });
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const order = timeline.data?.order;
  const { advance, withdraw } = useOrderActions(detail.data?.threadId ?? null);

  if (timeline.isLoading) {
    return (
      <div className="space-y-6" data-testid="status-tracker-loading">
        <div className="h-5 w-24 animate-pulse rounded bg-secondary" />
        <div className="h-36 animate-pulse rounded-lg border border-border bg-card" />
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]"><div className="h-96 animate-pulse rounded-lg border border-border bg-card" /><div className="h-64 animate-pulse rounded-lg border border-border bg-card" /></div>
      </div>
    );
  }
  if (timeline.error?.status === 404) {
    return <EmptyState icon={Package} title="Order not found" description="This order may have been removed, or it belongs to another manufacturer." />;
  }
  if (timeline.isError || !order || !timeline.data) {
    return <QueryError title="Unable to load order tracker" description="This order could not be retrieved." onRetry={() => void timeline.refetch()} />;
  }

  const data = timeline.data;
  const state = deriveCardState(order, "manufacturer");
  const nextAction = state.actions.find((action) => action.kind === "advance");
  const sellerName = detail.data?.sellerName ?? "Seller";
  const Icon = order.orderType === "bulk" ? Package : Shirt;
  const images = (detail.data?.imageUrls ?? []).filter((url): url is string => typeof url === "string");
  const reviewHold = order.paymentReviewState && order.paymentReviewState !== "none";

  const runAdvance = (tracking?: { carrier: string; trackingNumber: string }) => {
    if (!nextAction || nextAction.kind !== "advance") return;
    setError(null);
    advance.mutate(
      { orderId, status: nextAction.to, expectedRevision: order.revision, ...tracking },
      { onSuccess: () => setTrackingOpen(false), onError: (err) => setError(errorMessage(err)) },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-orders">
        <ArrowLeft className="h-4 w-4" /> Orders
      </Link>

      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary"><Icon className="h-6 w-6 text-primary" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] uppercase text-primary">{orderTypeLabel(order.orderType)}</span>
                <span className="rounded border border-border px-2 py-0.5 font-mono text-[11px] uppercase text-muted-foreground" data-testid="text-order-status">{orderStatusLabel(order.status)}</span>
              </div>
              <h1 className="mt-2 text-2xl font-bold md:text-3xl" data-testid="text-order-title">{order.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                For <span className="text-foreground">{sellerName}</span> · {order.quantity.toLocaleString("en-US")} {order.quantity === 1 ? "piece" : "pieces"} · Sent {formatTimestamp(data.createdAt)}
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="font-mono text-2xl font-semibold">{formatMoney(order.priceCents, order.currency)}</p>
            <p className="text-xs text-muted-foreground">{data.paidAt ? `Paid ${formatTimestamp(data.paidAt)}` : order.status === "cancelled" ? "Not charged" : "Not paid yet"}</p>
          </div>
        </div>
        {order.description && <p className="mt-5 whitespace-pre-wrap border-t border-border pt-5 text-sm text-muted-foreground">{order.description}</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="rounded-lg border border-border bg-card p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-semibold">Production tracker</h2>
            <span className="font-mono text-xs text-muted-foreground">{state.completedStages}/6 complete</span>
          </div>
          <OrderTimeline steps={data.steps} awaitingPayment={order.status === "pending_payment"} cancelled={order.status === "cancelled"} />
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5" data-testid="panel-next-step">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Next step</h2>
            {order.status === "pending_payment" ? (
              <div className="mt-3 space-y-3">
                <div className="flex gap-2 text-sm text-amber-200"><Clock className="mt-0.5 h-4 w-4 shrink-0" /><p>{state.detail}</p></div>
                {!order.manufacturerPayoutReady && (
                  <Button asChild size="sm" className="w-full"><Link href="/payment">Finish payout setup</Link></Button>
                )}
                <Button variant="outline" size="sm" className="w-full" onClick={() => setConfirmWithdraw(true)} disabled={withdraw.isPending} data-testid="button-withdraw-order">
                  <XCircle className="mr-2 h-4 w-4" /> Withdraw card
                </Button>
              </div>
            ) : order.status === "cancelled" ? (
              <p className="mt-3 text-sm text-muted-foreground">This card was closed before payment. Send a new card from the conversation if plans change.</p>
            ) : order.status === "delivered" ? (
              <div className="mt-3 flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>Delivered{data.steps[5]?.at ? ` ${formatTimestamp(data.steps[5].at)}` : ""}. Nice work.</p></div>
            ) : nextAction && nextAction.kind === "advance" ? (
              <div className="mt-3 space-y-3">
                {reviewHold && (
                  <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Stripe is reviewing this payment. Hold production until it clears.</div>
                )}
                <p className="text-sm text-muted-foreground">When this stage is done, move the order forward. The seller is notified right away.</p>
                <Button className="w-full" onClick={() => nextAction.needsTracking ? setTrackingOpen(true) : runAdvance()} disabled={advance.isPending} data-testid="button-advance-order">
                  {advance.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : nextAction.needsTracking ? <Truck className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  {nextAction.label}
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{state.detail}</p>
            )}
            {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
          </section>

          {(data.tracking.trackingNumber || order.status === "shipped") && (
            <section className="rounded-lg border border-border bg-card p-5" data-testid="panel-shipment">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Shipment</h2>
              <p className="mt-3 font-medium">{data.tracking.carrierName ?? "Carrier"}</p>
              <p className="font-mono text-sm text-muted-foreground">{data.tracking.trackingNumber}</p>
              {data.tracking.url && (
                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                  <a href={data.tracking.url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Track with carrier</a>
                </Button>
              )}
            </section>
          )}

          {detail.data?.threadId && (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/messages/${detail.data.threadId}`}><MessageSquare className="mr-2 h-4 w-4" /> Message {sellerName}</Link>
            </Button>
          )}

          {data.events.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activity</h2>
              <ul className="mt-3 space-y-3">
                {[...data.events].reverse().map((event) => (
                  <li key={event.id} className="text-sm">
                    <p><span className="font-medium">{ACTOR_LABEL[event.actorRole] ?? event.actorRole}</span> <span className="text-muted-foreground">{event.toStatus === "pending_payment" ? "sent the card" : event.toStatus === "cancelled" ? "closed the card" : `→ ${orderStatusLabel(event.toStatus)}`}</span></p>
                    {event.note && <p className="text-xs text-muted-foreground">"{event.note}"</p>}
                    <p className="font-mono text-[11px] text-muted-foreground">{formatTimestamp(event.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {images.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold">Reference photos</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((imageUrl) => <img key={imageUrl} src={imageUrl} alt={`${order.title} reference`} className="aspect-square rounded-md border border-border object-cover" />)}
          </div>
        </section>
      )}

      <TrackingDialog open={trackingOpen} onOpenChange={setTrackingOpen} pending={advance.isPending} error={error} onSubmit={(tracking) => runAdvance(tracking)} />

      <AlertDialog open={confirmWithdraw} onOpenChange={setConfirmWithdraw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this card?</AlertDialogTitle>
            <AlertDialogDescription>{sellerName} won't be able to pay it anymore. You can send a new card from the conversation.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep card</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setError(null); withdraw.mutate({ orderId }, { onError: (err) => setError(errorMessage(err)) }); }}>Withdraw</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
