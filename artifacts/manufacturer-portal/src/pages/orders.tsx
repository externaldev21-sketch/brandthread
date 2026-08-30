import { useState } from "react";
import { getListManufacturerSampleOrdersQueryKey, useListManufacturerSampleOrders } from "@workspace/api-client-react";
import { Package, Search, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { EmptyState, QueryError } from "@/components/query-state";
import { isTerminalOrderStatus } from "@/lib/order-status";

export default function Orders({ view }: { view: "active" | "history" }) {
  const { data: orders, isLoading, isError, refetch } = useListManufacturerSampleOrders({
    query: { queryKey: getListManufacturerSampleOrdersQueryKey(), refetchInterval: 30_000 },
  });
  const [searchTerm, setSearchTerm] = useState("");
  const filteredOrders = (orders ?? []).filter((order) => {
    const terminal = isTerminalOrderStatus(order.status);
    return (view === "history" ? terminal : !terminal) &&
      `${order.title} ${order.sellerId} ${order.id}`.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="flex h-full flex-col space-y-6 animate-in fade-in duration-500">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Production</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{view === "history" ? "Completed History" : "Active Orders"}</h1>
        <p className="mt-1 text-muted-foreground">{view === "history" ? "Delivered, approved, rejected, and cancelled work." : "Live sample and bulk production."}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search title or seller ID..." className="h-11 bg-card pl-9" data-testid="input-search-orders" />
        </div>
        <div className="flex rounded-md border border-border bg-card p-1">
          <Link href="/orders" className={`rounded px-3 py-2 text-sm ${view === "active" ? "bg-secondary text-foreground" : "text-muted-foreground"}`} data-testid="link-active-orders">Active</Link>
          <Link href="/orders/history" className={`rounded px-3 py-2 text-sm ${view === "history" ? "bg-secondary text-foreground" : "text-muted-foreground"}`} data-testid="link-order-history">Completed</Link>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg border border-border bg-card" />)}</div>
      ) : isError ? (
        <QueryError title="Unable to load orders" description="We couldn't retrieve your shared production orders." onRetry={() => void refetch()} />
      ) : filteredOrders.length === 0 ? (
        <EmptyState icon={Package} title={searchTerm ? "No matching orders" : view === "history" ? "No order history" : "No active orders"} description={searchTerm ? "Try a different title or seller ID." : "Orders will appear here as sellers place them."} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {filteredOrders.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`} className="flex flex-col gap-3 border-b border-border p-5 transition-colors last:border-0 hover:bg-secondary/30 sm:flex-row sm:items-center sm:justify-between" data-testid={`link-order-${order.id}`}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{order.title}</h2>
                  <span className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">{order.orderType}</span>
                  <span className="rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{order.status.replaceAll("_", " ")}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Seller: {order.sellerId} · {order.quantity} units · ${(order.priceCents / 100).toFixed(2)}</p>
              </div>
              <span className="flex items-center gap-2 text-sm font-medium text-primary">Open tracker <ArrowRight className="h-4 w-4" /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}