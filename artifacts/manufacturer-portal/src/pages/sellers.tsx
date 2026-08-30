import { useMemo, useState } from "react";
import { getGetManufacturerDashboardQueryKey, getListManufacturerSampleOrdersQueryKey, useGetManufacturerDashboard, useListManufacturerSampleOrders } from "@workspace/api-client-react";
import { MessageSquare, Search, Store } from "lucide-react";
import { Link } from "wouter";
import { EmptyState, QueryError } from "@/components/query-state";
import { Input } from "@/components/ui/input";
import { isTerminalOrderStatus } from "@/lib/order-status";

export default function Sellers() {
  const dashboard = useGetManufacturerDashboard({ query: { queryKey: getGetManufacturerDashboardQueryKey(), refetchInterval: 30_000 } });
  const orders = useListManufacturerSampleOrders({ query: { queryKey: getListManufacturerSampleOrdersQueryKey(), refetchInterval: 30_000 } });
  const [search, setSearch] = useState("");
  const sellers = useMemo(() => {
    const sellerMap = new Map<string, { id: string; count: number; active: number; value: number; threadId?: string }>();
    for (const order of orders.data ?? []) {
      const current = sellerMap.get(order.sellerId) ?? { id: order.sellerId, count: 0, active: 0, value: 0 };
      current.count += 1; current.value += order.priceCents;
      if (!isTerminalOrderStatus(order.status)) current.active += 1;
      if (order.threadId) current.threadId = order.threadId;
      sellerMap.set(order.sellerId, current);
    }
    return [...sellerMap.values()].filter((seller) => seller.id.toLowerCase().includes(search.toLowerCase()));
  }, [orders.data, search]);
  const loading = dashboard.isLoading || orders.isLoading;
  const failed = dashboard.isError || orders.isError;
  return <div className="space-y-6 animate-in fade-in duration-500">
    <div><p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Relationships</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Active Sellers</h1><p className="mt-1 text-muted-foreground">{dashboard.data?.activeSellers.length ?? 0} active seller relationships.</p></div>
    <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search seller ID..." className="h-11 bg-card pl-9" data-testid="input-search-sellers" /></div>
    {loading ? <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-lg border border-border bg-card" />)}</div>
      : failed ? <QueryError title="Unable to load sellers" description="We couldn't retrieve your active seller relationships." onRetry={() => { void dashboard.refetch(); void orders.refetch(); }} />
      : sellers.length === 0 ? <EmptyState icon={Store} title={search ? "No matching sellers" : "No active sellers"} description="Seller relationships appear with shared sample and bulk orders." />
      : <div className="grid gap-4 md:grid-cols-2">{sellers.map((seller) => <article key={seller.id} className="rounded-lg border border-border bg-card p-5" data-testid={`card-seller-${seller.id}`}><h2 className="font-mono font-semibold">{seller.id}</h2><p className="mt-1 text-sm text-muted-foreground">{seller.active} active · {seller.count} total orders</p><div className="mt-5 flex items-end justify-between border-t border-border pt-4"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Order value</p><p className="mt-1 font-mono font-semibold">${(seller.value / 100).toFixed(2)}</p></div>{seller.threadId ? <Link href={`/messages/${seller.threadId}`} className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" data-testid={`link-message-seller-${seller.id}`}><MessageSquare className="h-4 w-4" /> Message</Link> : <span className="text-xs text-muted-foreground">No thread yet</span>}</div></article>)}</div>}
  </div>;
}