import { useMemo, useState } from "react";
import {
  getListManufacturerSampleOrdersQueryKey, getListManufacturerThreadsQueryKey, useListManufacturerSampleOrders, useListManufacturerThreads,
} from "@workspace/api-client-react";
import { MessageSquare, Search, Store } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { formatMoney, isTerminalStatus } from "@workspace/manufacturer-flow";
import { EmptyState, QueryError } from "@/components/query-state";
import { Input } from "@/components/ui/input";

type SellerSummary = { id: string; name: string; threadId?: string; lastActive?: string; total: number; active: number; paidValue: number };

export default function Sellers() {
  const threads = useListManufacturerThreads({ query: { queryKey: getListManufacturerThreadsQueryKey(), refetchInterval: 30_000 } });
  const orders = useListManufacturerSampleOrders({ query: { queryKey: getListManufacturerSampleOrdersQueryKey(), refetchInterval: 30_000 } });
  const [search, setSearch] = useState("");

  const sellers = useMemo(() => {
    const map = new Map<string, SellerSummary>();
    for (const thread of threads.data ?? []) {
      map.set(thread.sellerId, { id: thread.sellerId, name: thread.buyerName, threadId: thread.id, lastActive: thread.lastMessageAt, total: 0, active: 0, paidValue: 0 });
    }
    for (const order of orders.data ?? []) {
      const current = map.get(order.sellerId) ?? { id: order.sellerId, name: order.sellerName ?? "Seller", total: 0, active: 0, paidValue: 0 };
      current.total += 1;
      if (!isTerminalStatus(order.status)) current.active += 1;
      if (order.status !== "pending_payment" && order.status !== "cancelled") current.paidValue += order.priceCents;
      if (!current.threadId && order.threadId) current.threadId = order.threadId;
      map.set(order.sellerId, current);
    }
    const term = search.trim().toLowerCase();
    return [...map.values()]
      .filter((seller) => seller.name.toLowerCase().includes(term))
      .sort((a, b) => b.active - a.active || (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  }, [threads.data, orders.data, search]);

  const loading = threads.isLoading || orders.isLoading;
  const failed = threads.isError || orders.isError;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Relationships</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Sellers</h1>
        <p className="mt-1 text-muted-foreground">Brands you're talking to or producing for.</p>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sellers…" className="h-11 bg-card pl-9" data-testid="input-search-sellers" />
      </div>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-lg border border-border bg-card" />)}</div>
      ) : failed ? (
        <QueryError title="Unable to load sellers" description="We couldn't retrieve your seller relationships." onRetry={() => { void threads.refetch(); void orders.refetch(); }} />
      ) : sellers.length === 0 ? (
        <EmptyState icon={Store} title={search ? "No matching sellers" : "No sellers yet"} description={search ? "Try a different name." : "Sellers appear here when they message you or invite you to work with them."} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sellers.map((seller) => (
            <article key={seller.id} className="flex flex-col rounded-lg border border-border bg-card p-5" data-testid={`card-seller-${seller.id}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-secondary font-bold text-muted-foreground">{seller.name.substring(0, 2).toUpperCase()}</div>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{seller.name}</h2>
                  <p className="text-xs text-muted-foreground">{seller.lastActive ? `Last message ${formatDistanceToNow(new Date(seller.lastActive), { addSuffix: true })}` : "No messages yet"}</p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
                <div><dt className="text-xs text-muted-foreground">Active</dt><dd className="mt-0.5 font-mono font-semibold">{seller.active}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Orders</dt><dd className="mt-0.5 font-mono font-semibold">{seller.total}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Paid value</dt><dd className="mt-0.5 font-mono font-semibold">{formatMoney(seller.paidValue)}</dd></div>
              </dl>
              {seller.threadId && (
                <Link href={`/messages/${seller.threadId}`} className="mt-4 flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" data-testid={`link-message-seller-${seller.id}`}>
                  <MessageSquare className="h-4 w-4" /> Open conversation
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
