import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, Package, Truck } from "lucide-react";
import { getGetManufacturerSampleOrderQueryKey, getListManufacturerSampleOrdersQueryKey, useAdvanceManufacturerSampleOrder, useGetManufacturerSampleOrder } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, QueryError } from "@/components/query-state";
import { isTerminalOrderStatus } from "@/lib/order-status";

const NEXT_STAGE: Record<string, string | undefined> = {
  payment_received: "processing",
  processing: "cut_and_sew",
  cut_and_sew: "packing",
  packing: "shipped",
  shipped: "delivered",
};

export default function OrderTracker({ orderId }: { orderId: string }) {
  const query = useGetManufacturerSampleOrder(orderId, {
    query: { queryKey: getGetManufacturerSampleOrderQueryKey(orderId), refetchInterval: 15_000 },
  });
  const update = useAdvanceManufacturerSampleOrder();
  const queryClient = useQueryClient();
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  if (query.isLoading) return <div className="h-80 animate-pulse rounded-lg border border-border bg-card" />;
  if (query.isError) return <QueryError title="Unable to load order tracker" description="This order could not be retrieved." onRetry={() => void query.refetch()} />;
  const order = query.data;
  if (!order) return <EmptyState icon={Package} title="Order not found" description="This order may no longer be available." />;
  const awaitingPayment = order.status === "pending_payment";
  const next = isTerminalOrderStatus(order.status) ? undefined : NEXT_STAGE[order.status];
  const rawImageUrls = (order as Record<string, unknown>).imageUrls;
  const imageUrls: string[] = Array.isArray(rawImageUrls)
    ? rawImageUrls.filter((item): item is string => typeof item === "string")
    : [];
  const advance = () => {
    if (!next || (next === "shipped" && (!trackingNumber.trim() || !carrier.trim()))) return;
    update.mutate({ orderId, data: { status: next as "processing" | "cut_and_sew" | "packing" | "shipped" | "delivered", trackingNumber: trackingNumber.trim() || undefined, carrier: carrier.trim() || undefined } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetManufacturerSampleOrderQueryKey(orderId) });
        void queryClient.invalidateQueries({ queryKey: getListManufacturerSampleOrdersQueryKey() });
      },
    });
  };
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-orders"><ArrowLeft className="h-4 w-4" /> Orders</Link>
      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row">
          <div>
            <div className="flex items-center gap-2"><span className="rounded bg-primary/10 px-2 py-1 font-mono text-xs uppercase text-primary">{order.orderType}</span><span className="font-mono text-xs uppercase text-muted-foreground">{order.status.replaceAll("_", " ")}</span></div>
            <h1 className="mt-3 text-3xl font-bold">{order.title}</h1>
            <p className="mt-1 text-muted-foreground">{order.quantity} units · Seller ID: {order.sellerId}</p>
          </div>
          <p className="font-mono text-lg">${(order.priceCents / 100).toFixed(2)}</p>
        </div>
        {imageUrls.length > 0 && <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{imageUrls.map((imageUrl) => <img key={imageUrl} src={imageUrl} alt={`${order.title} reference`} className="aspect-square rounded-md border border-border object-cover" />)}</div>}
      </section>
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold">Live production tracker</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">{["processing", "cut_and_sew", "packing", "shipped", "delivered"].map((stage) => <div key={stage} className={`rounded border p-3 text-center text-xs uppercase ${stage === order.status ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}><CheckCircle2 className="mx-auto mb-2 h-4 w-4" />{stage.replaceAll("_", " ")}</div>)}</div>
        {awaitingPayment ? (
          <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200" data-testid="status-awaiting-payment">
            Waiting for payment. Production can begin only after the seller's payment is complete.
          </div>
        ) : next && <div className="mt-6 border-t border-border pt-5">
          {next === "shipped" && <div className="mb-4 grid gap-3 sm:grid-cols-2"><Input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="Carrier (required)" data-testid="input-carrier" /><Input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Tracking number (required)" data-testid="input-tracking-number" /></div>}
          <Button onClick={advance} disabled={update.isPending || (next === "shipped" && (!carrier.trim() || !trackingNumber.trim()))} data-testid="button-advance-order"><Truck className="mr-2 h-4 w-4" />{update.isPending ? "Updating..." : `Mark ${next.replaceAll("_", " ")}`}</Button>
          {update.isError && <p className="mt-3 text-sm text-destructive">Unable to advance this order. Please try again.</p>}
        </div>}
      </section>
    </div>
  );
}