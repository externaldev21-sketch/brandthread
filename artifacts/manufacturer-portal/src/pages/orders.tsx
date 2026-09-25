import { useMemo, useState } from "react";
import { getListManufacturerSampleOrdersQueryKey, useListManufacturerSampleOrders } from "@workspace/api-client-react";
import { ArrowRight, Package, Search, Shirt } from "lucide-react";
import { Link } from "wouter";
import { formatMoney, isTerminalStatus, orderStatusLabel, orderTypeLabel, stageIndex } from "@workspace/manufacturer-flow";
import { Input } from "@/components/ui/input";
import { EmptyState, QueryError } from "@/components/query-state";
import { cn } from "@/lib/utils";

type Filter = "all" | "awaiting_payment" | "in_production" | "shipped";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All active" },
  { id: "awaiting_payment", label: "Awaiting payment" },
  { id: "in_production", label: "In production" },
  { id: "shipped", label: "Shipped" },
];

function matches(status: string, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "awaiting_payment") return status === "pending_payment";
  if (filter === "shipped") return status === "shipped";
  return ["payment_received", "processing", "cut_and_sew", "packing"].includes(status);
}

export default function Orders({ view }: { view: "active" | "history" }) {
  const { data: orders, isLoading, isError, refetch } = useListManufacturerSampleOrders({
    query: { queryKey: getListManufacturerSampleOrdersQueryKey(), refetchInterval: 30_000 },
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const scoped = useMemo(() => (orders ?? []).filter((order) => (view === "history") === isTerminalStatus(order.status)), [orders, view]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((item) => [item.id, scoped.filter((order) => matches(order.status, item.id)).length])), [scoped]);
  const filteredOrders = scoped.filter((order) =>
    (view === "history" || matches(order.status, filter))
    && `${order.title} ${order.sellerName ?? ""}`.toLowerCase().includes(searchTerm.trim().toLowerCase()));

  return (
    <div className="flex h-full flex-col space-y-6 animate-in fade-in duration-500">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Production</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{view === "history" ? "Completed orders" : "Active orders"}</h1>
        <p className="mt-1 text-muted-foreground">{view === "history" ? "Delivered, approved and closed work." : "Every sample and bulk order you're working on, from payment to delivery."}</p>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by product or seller…" className="h-11 bg-card pl-9" data-testid="input-search-orders" />
        </div>
        <div className="flex rounded-md border border-border bg-card p-1">
          <Link href="/orders" className={`rounded px-3 py-2 text-sm ${view === "active" ? "bg-secondary text-foreground" : "text-muted-foreground"}`} data-testid="link-active-orders">Active</Link>
          <Link href="/orders/history" className={`rounded px-3 py-2 text-sm ${view === "history" ? "bg-secondary text-foreground" : "text-muted-foreground"}`} data-testid="link-order-history">Completed</Link>
        </div>
      </div>
      {view === "active" && !isLoading && !isError && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter orders">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", filter === item.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
              data-testid={`filter-orders-${item.id}`}
            >
              {item.label} <span className="ml-1 font-mono text-xs opacity-70">{counts[item.id]}</span>
            </button>
          ))}
        </div>
      )}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg border border-border bg-card" />)}</div>
      ) : isError ? (
        <QueryError title="Unable to load orders" description="We couldn't retrieve your production orders." onRetry={() => void refetch()} />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={Package}
          title={searchTerm ? "No matching orders" : view === "history" ? "No completed orders yet" : filter === "all" ? "No active orders" : `Nothing ${FILTERS.find((item) => item.id === filter)?.label.toLowerCase()}`}
          description={searchTerm ? "Try a different product or seller name." : view === "history" ? "Delivered orders move here automatically." : "Send a sample or bulk order card from any seller conversation to get started."}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {filteredOrders.map((order) => {
            const reached = stageIndex(order.status) + 1;
            const Icon = order.orderType === "bulk" ? Package : Shirt;
            return (
              <Link key={order.id} href={`/orders/${order.id}`} className="flex flex-col gap-3 border-b border-border p-5 transition-colors last:border-0 hover:bg-secondary/30 sm:flex-row sm:items-center" data-testid={`link-order-${order.id}`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary"><Icon className="h-5 w-5 text-primary" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-semibold">{order.title}</h2>
                    <span className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">{orderTypeLabel(order.orderType)}</span>
                    <span className={cn("rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider", order.status === "pending_payment" ? "border-amber-500/40 text-amber-300" : "border-border text-muted-foreground")}>{orderStatusLabel(order.status)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{order.sellerName ?? "Seller"} · {order.quantity.toLocaleString("en-US")} pcs · {formatMoney(order.priceCents)}</p>
                  {reached > 0 && (
                    <div className="mt-2 grid max-w-xs grid-cols-6 gap-1">
                      {Array.from({ length: 6 }, (_, index) => <span key={index} className={cn("h-1 rounded-full", index < reached ? "bg-primary" : "bg-secondary")} />)}
                    </div>
                  )}
                </div>
                <span className="flex items-center gap-2 text-sm font-medium text-primary">Open tracker <ArrowRight className="h-4 w-4" /></span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
