import { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight, Banknote, CheckCircle2, CircleDashed, Clock, Eye, EyeOff, ImagePlus, Inbox, Loader2, Package, ShieldAlert, Truck,
} from "lucide-react";
import {
  getGetManufacturerDashboardQueryKey, getGetMyManufacturerProfileQueryKey, useGetManufacturerDashboard, useGetMyManufacturerProfile,
} from "@workspace/api-client-react";
import { formatMoney, isTerminalStatus, localClock, orderStatusLabel, orderTypeLabel, stageIndex, timeZoneOffsetLabel } from "@workspace/manufacturer-flow";
import { EmptyState, QueryError } from "@/components/query-state";
import { useConnectStatus } from "@/hooks/use-connect-status";
import { cn } from "@/lib/utils";

function greeting(timeZone: string | null | undefined) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timeZone ?? undefined }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const dashboard = useGetManufacturerDashboard({ query: { queryKey: getGetManufacturerDashboardQueryKey(), refetchInterval: 30_000 } });
  const profile = useGetMyManufacturerProfile({ query: { queryKey: getGetMyManufacturerProfileQueryKey(), staleTime: 30_000 } });
  const connect = useConnectStatus();
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((tick) => tick + 1), 60_000); return () => clearInterval(id); }, []);

  if (dashboard.isLoading || profile.isLoading) {
    return (
      <div className="space-y-6" data-testid="status-dashboard-loading">
        <div className="h-9 w-72 animate-pulse rounded bg-secondary" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg border border-border bg-card" />)}</div>
        <div className="grid gap-4 lg:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-72 animate-pulse rounded-lg border border-border bg-card" />)}</div>
      </div>
    );
  }
  if (dashboard.isError || !dashboard.data) {
    return <QueryError title="Unable to load your hub" description="Your latest orders and messages could not be retrieved." onRetry={() => void dashboard.refetch()} />;
  }

  const data = dashboard.data;
  const me = profile.data;
  const timeZone = me?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const allOrders = [...data.sampleOrders.active, ...data.bulkOrders.active, ...data.orderHistory];
  const active = allOrders.filter((order) => !isTerminalStatus(order.status));
  const awaiting = active.filter((order) => order.status === "pending_payment");
  const inProduction = active.filter((order) => stageIndex(order.status) >= 0 && stageIndex(order.status) <= 3);
  const shipped = active.filter((order) => order.status === "shipped");
  const unreadThreads = data.messages.filter((thread) => thread.unreadCount > 0);
  const photos = me?.photos?.length ?? 0;
  const payoutReady = connect.data?.ready === true;
  const paymentsOff = connect.error?.status === 503;

  const stats = [
    { label: "Unread conversations", value: unreadThreads.length, icon: Inbox, href: "/messages" },
    { label: "Awaiting payment", value: awaiting.length, detail: awaiting.length ? formatMoney(awaiting.reduce((sum, order) => sum + order.priceCents, 0)) : null, icon: Clock, href: "/orders" },
    { label: "In production", value: inProduction.length, icon: Package, href: "/orders" },
    { label: "Shipped", value: shipped.length, icon: Truck, href: "/orders" },
  ];

  const checklist = [
    { done: true, label: me?.isPublicDirectory ? "Listed in the public directory" : "Private profile for invited sellers", href: "/profile" },
    { done: photos >= 3, label: photos >= 3 ? `${photos} factory photos` : `Add factory photos (${photos}/3 minimum)`, href: "/profile" },
    { done: payoutReady, label: payoutReady ? "Payouts verified" : "Verify your payout account", href: "/payment" },
  ];
  const setupComplete = checklist.every((item) => item.done);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Manufacturer hub</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight" data-testid="text-dashboard-greeting">{greeting(timeZone)}, {me?.businessName ?? "there"}</h1>
          <p className="mt-1 text-muted-foreground">
            It's {localClock(timeZone)} your time ({timeZoneOffsetLabel(timeZone)}). Here's what needs you today.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground" data-testid="status-directory-visibility">
          {me?.isPublicDirectory ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5" />}
          {me?.isPublicDirectory ? "Live in the directory" : "Private listing"}
        </div>
      </div>

      {!setupComplete && (
        <section className="rounded-lg border border-primary/30 bg-primary/5 p-5" data-testid="panel-setup-checklist">
          <h2 className="font-semibold">Finish setting up to get paid</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sellers can pay your order cards once your payout account is verified.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-3">
            {checklist.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className={cn("flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition-colors", item.done ? "border-border text-muted-foreground" : "border-primary/40 bg-card hover:bg-secondary")}>
                  {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : item.label.startsWith("Add") ? <ImagePlus className="h-4 w-4 shrink-0 text-primary" /> : <CircleDashed className="h-4 w-4 shrink-0 text-primary" />}
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-muted-foreground/40" data-testid={`stat-${stat.label.toLowerCase().replaceAll(" ", "-")}`}>
            <div className="flex items-start justify-between"><p className="text-sm text-muted-foreground">{stat.label}</p><stat.icon className="h-4 w-4 text-muted-foreground" /></div>
            <div className="flex items-baseline gap-2"><p className="text-3xl font-bold">{stat.value}</p>{stat.detail && <p className="font-mono text-xs text-muted-foreground">{stat.detail}</p>}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Inbox</h2>
            <Link href="/messages" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">All <ArrowUpRight className="h-3 w-3" /></Link>
          </header>
          {data.messages.length === 0 ? (
            <div className="p-5"><EmptyState icon={Inbox} title="No conversations yet" description="Sellers who find you in the directory or invite you will appear here." /></div>
          ) : (
            <ul className="divide-y divide-border">
              {data.messages.slice(0, 5).map((thread) => (
                <li key={thread.id}>
                  <Link href={`/messages/${thread.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-secondary/30" data-testid={`link-dashboard-thread-${thread.id}`}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-bold text-muted-foreground">{thread.buyerName.substring(0, 2).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn("truncate text-sm", thread.unreadCount ? "font-semibold" : "font-medium text-muted-foreground")}>{thread.buyerName}</p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{thread.lastMessage || thread.subject}</p>
                    </div>
                    {thread.unreadCount > 0 && <span className="mt-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{thread.unreadCount}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Active orders</h2>
            <Link href="/orders" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">All <ArrowUpRight className="h-3 w-3" /></Link>
          </header>
          {active.length === 0 ? (
            <div className="p-5"><EmptyState icon={Package} title="No active orders" description="Send a sample card from a seller conversation to start one." /></div>
          ) : (
            <ul className="divide-y divide-border">
              {active.slice(0, 5).map((order) => {
                const reached = stageIndex(order.status) + 1;
                return (
                  <li key={order.id}>
                    <Link href={`/orders/${order.id}`} className="block px-5 py-3.5 hover:bg-secondary/30" data-testid={`link-dashboard-order-${order.id}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium">{order.title}</p>
                        <p className="shrink-0 font-mono text-xs">{formatMoney(order.priceCents)}</p>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{orderTypeLabel(order.orderType)} · {order.sellerName ?? "Seller"} · <span className={order.status === "pending_payment" ? "text-amber-300" : ""}>{orderStatusLabel(order.status)}</span></p>
                      <div className="mt-2 grid grid-cols-6 gap-1">{Array.from({ length: 6 }, (_, index) => <span key={index} className={cn("h-1 rounded-full", index < reached ? "bg-primary" : "bg-secondary")} />)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col rounded-lg border border-border bg-card" data-testid="panel-payouts">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Payouts</h2>
            <Link href="/payment" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">Details <ArrowUpRight className="h-3 w-3" /></Link>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-5">
            {connect.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking payout status…</div>
            ) : paymentsOff ? (
              <div className="flex gap-3"><Banknote className="h-5 w-5 shrink-0 text-muted-foreground" /><p className="text-sm text-muted-foreground">Payments aren't switched on for this workspace yet. You can still chat and send cards.</p></div>
            ) : connect.isError ? (
              <p className="text-sm text-destructive">Payout status couldn't be loaded. <button className="underline" onClick={() => void connect.refetch()}>Retry</button></p>
            ) : (
              <div className="flex gap-3">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", payoutReady ? "bg-primary/15 text-primary" : "bg-amber-500/15 text-amber-400")}>
                  {payoutReady ? <CheckCircle2 className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                </div>
                <div>
                  <p className="font-medium" data-testid="text-payout-status">{payoutReady ? "Ready to receive payments" : connect.data?.connected ? "Verification in progress" : "Not set up"}</p>
                  <p className="text-sm text-muted-foreground">
                    {payoutReady
                      ? `Paid out${connect.data?.payoutCurrency ? ` in ${connect.data.payoutCurrency}` : ""} to your bank through Stripe.`
                      : "Sellers can't pay your cards until Stripe verifies your account."}
                  </p>
                </div>
              </div>
            )}
            <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div><p className="text-xs text-muted-foreground">Paid orders</p><p className="font-mono text-lg font-semibold">{allOrders.filter((order) => order.status !== "pending_payment" && order.status !== "cancelled").length}</p></div>
              <div><p className="text-xs text-muted-foreground">Completed value</p><p className="font-mono text-lg font-semibold">{formatMoney(data.totalRevenueCents)}</p></div>
            </div>
            {!payoutReady && !paymentsOff && (
              <Link href="/payment" className="rounded-md bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground" data-testid="link-setup-payouts">
                {connect.data?.connected ? "Continue payout setup" : "Set up payouts"}
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
