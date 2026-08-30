import { getGetManufacturerDashboardQueryKey, useGetManufacturerDashboard } from "@workspace/api-client-react";
import { ArrowUpRight, Package, MessageSquare, CheckCircle2, Users } from "lucide-react";
import { Link } from "wouter";
import { EmptyState, QueryError } from "@/components/query-state";
import { isTerminalOrderStatus } from "@/lib/order-status";

export default function Dashboard() {
  const { data, isLoading, isError, refetch } = useGetManufacturerDashboard({ query: { queryKey: getGetManufacturerDashboardQueryKey(), refetchInterval: 30_000 } });
  if (isLoading) return <div className="space-y-6"><div className="h-8 w-48 animate-pulse rounded bg-secondary" /><div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded border border-border bg-card" />)}</div></div>;
  if (isError || !data) return <QueryError title="Unable to load dashboard" description="Your latest workspace metrics could not be retrieved." onRetry={() => void refetch()} />;
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const inProgressOrders = [...data.sampleOrders.active, ...data.bulkOrders.active].filter((order) => !isTerminalOrderStatus(order.status)).length;
  const historyOrders = data.orderHistory.filter((order) => isTerminalOrderStatus(order.status)).length;
  const stats = [
    ["In progress", inProgressOrders, Package],
    ["Inbox updates", data.pendingMessages, MessageSquare],
    ["Order history", historyOrders, CheckCircle2],
    ["Active sellers", data.activeSellers.length, Users],
  ] as const;
  return <div className="space-y-8 animate-in fade-in duration-500">
    <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end"><div><h1 className="text-3xl font-bold tracking-tight">Overview</h1><p className="mt-1 text-muted-foreground">Live sample and bulk production metrics.</p></div><div className="flex gap-3"><Link href="/orders" className="rounded border border-border bg-secondary px-4 py-2 text-sm font-medium" data-testid="link-dashboard-orders">Orders</Link><Link href="/messages" className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" data-testid="link-dashboard-inbox">Inbox</Link></div></div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">{stats.map(([label, value, Icon]) => <div key={label} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"><div className="flex items-start justify-between"><p className="text-sm font-medium text-muted-foreground">{label}</p><div className="rounded bg-secondary p-2"><Icon className="h-4 w-4" /></div></div><h2 className="text-3xl font-bold" data-testid={`text-dashboard-${label.replace(" ", "-")}`}>{value}</h2></div>)}</div>
    <section className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Recent orders</h2><Link href="/orders" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-recent-orders">See all <ArrowUpRight className="h-3 w-3" /></Link></div>{data.recentOrders.length === 0 ? <EmptyState icon={Package} title="No orders yet" description="New sample and bulk orders will appear here." /> : <div className="overflow-hidden rounded-lg border border-border bg-card">{data.recentOrders.map((order) => <Link key={order.id} href={`/orders/${order.id}`} className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-0 hover:bg-secondary/30" data-testid={`link-recent-order-${order.id}`}><div><p className="font-medium">{order.title}</p><p className="text-sm text-muted-foreground">{order.orderType} · {order.quantity} units · {order.status.replaceAll("_", " ")}</p></div><span className="font-mono text-sm">{money(order.priceCents)}</span></Link>)}</div>}</section>
  </div>;
}