import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ExternalLink, Loader2, Package, Shirt, XCircle } from "lucide-react";
import { deriveCardState, formatMoney, orderStatusLabel, orderTypeLabel, trackingUrl, type CardAction } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/api";
import { useOrderActions } from "@/hooks/use-order-actions";
import { TrackingDialog } from "./tracking-dialog";
import type { OrderCardSnapshot } from "@/lib/order-types";

const PHASE_TONE: Record<string, string> = {
  awaiting_payment: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  in_production: "border-primary/40 bg-primary/10 text-primary",
  shipped: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  delivered: "border-primary/40 bg-primary/15 text-primary",
  cancelled: "border-border bg-secondary text-muted-foreground",
  closed: "border-border bg-secondary text-muted-foreground",
};

/** A sample / bulk order card inside the conversation, always showing live state. */
export function OrderCard({ order, threadId }: { order: OrderCardSnapshot; threadId: string }) {
  const state = deriveCardState(order, "manufacturer");
  const { advance, withdraw } = useOrderActions(threadId);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = order.orderType === "bulk" ? Package : Shirt;
  const link = trackingUrl(order.carrier, order.trackingNumber);

  const runAdvance = (action: Extract<CardAction, { kind: "advance" }>, tracking?: { carrier: string; trackingNumber: string }) => {
    setError(null);
    advance.mutate(
      { orderId: order.id, status: action.to, expectedRevision: order.revision, ...tracking },
      {
        onSuccess: () => setTrackingOpen(false),
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm" data-testid={`order-card-${order.id}`}>
      <div className="flex items-start gap-3 border-b border-border p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary"><Icon className="h-5 w-5 text-primary" /></div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{orderTypeLabel(order.orderType)} card</p>
          <p className="line-clamp-2 break-words font-semibold leading-snug" title={order.title}>{order.title}</p>
          <p className="text-sm text-muted-foreground">{order.quantity.toLocaleString("en-US")} {order.quantity === 1 ? "piece" : "pieces"}</p>
        </div>
        <p className="shrink-0 font-mono text-base font-semibold" data-testid={`order-card-price-${order.id}`}>{formatMoney(order.priceCents, order.currency)}</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", PHASE_TONE[state.phase])} data-testid={`order-card-status-${order.id}`}>
            {state.headline}
          </span>
          {state.completedStages > 0 && <span className="font-mono text-[11px] text-muted-foreground">{state.completedStages}/6 stages</span>}
        </div>
        {state.phase !== "cancelled" && (
          <div className="grid grid-cols-6 gap-1" aria-label={`${state.completedStages} of 6 stages complete`}>
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className={cn("h-1.5 rounded-full", index < state.completedStages ? "bg-primary" : "bg-secondary")} />
            ))}
          </div>
        )}
        <p className="text-sm text-muted-foreground">{state.detail}</p>
        {order.status === "shipped" || order.status === "delivered" ? (
          order.trackingNumber && <p className="font-mono text-xs text-muted-foreground">{order.carrier} · {order.trackingNumber}</p>
        ) : null}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {state.actions.map((action) => {
            if (action.kind === "advance") {
              return (
                <Button
                  key={action.kind}
                  size="sm"
                  onClick={() => action.needsTracking ? setTrackingOpen(true) : runAdvance(action)}
                  disabled={advance.isPending}
                  data-testid={`button-card-advance-${order.id}`}
                >
                  {advance.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
                  {action.label}
                </Button>
              );
            }
            if (action.kind === "withdraw") {
              return (
                <Button key={action.kind} size="sm" variant="outline" onClick={() => setConfirmWithdraw(true)} disabled={withdraw.isPending} data-testid={`button-card-withdraw-${order.id}`}>
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> {action.label}
                </Button>
              );
            }
            if (action.kind === "track" && link) {
              return (
                <Button key={action.kind} size="sm" variant="outline" asChild>
                  <a href={link} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> {action.label}</a>
                </Button>
              );
            }
            return null;
          })}
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/orders/${order.id}`} data-testid={`link-card-tracker-${order.id}`}>Open tracker</Link>
          </Button>
        </div>
      </div>

      {state.actions.some((action) => action.kind === "advance" && action.needsTracking) && (
        <TrackingDialog
          open={trackingOpen}
          onOpenChange={setTrackingOpen}
          pending={advance.isPending}
          error={error}
          onSubmit={(tracking) => {
            const action = state.actions.find((item): item is Extract<CardAction, { kind: "advance" }> => item.kind === "advance");
            if (action) runAdvance(action, tracking);
          }}
        />
      )}

      <AlertDialog open={confirmWithdraw} onOpenChange={setConfirmWithdraw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this {orderTypeLabel(order.orderType).toLowerCase()} card?</AlertDialogTitle>
            <AlertDialogDescription>
              The seller won't be able to pay it anymore. You can send a new card with a different price at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep card</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setError(null);
                withdraw.mutate({ orderId: order.id }, { onError: (err) => setError(errorMessage(err)) });
              }}
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span className="sr-only">Status: {orderStatusLabel(order.status)}</span>
    </div>
  );
}
