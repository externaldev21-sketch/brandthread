import { useState } from "react";
import { Chips, DataTable, ErrorLine, PageTitle, StatCards } from "../ui";
import { money, useAdminQuery } from "../api";

interface Revenue {
  days: number; orders: number; gmvCents: number; platformFeesCents: number; refundedCents: number; boostRevenueCents: number; boostsSold: number;
  series: { day: string; orders: number; gmvCents: number; platformFeesCents: number }[];
  lines: Line[]; grossPlatformRevenueCents: number; deductions: Line[]; netTakeCents: number;
  subscriptions: {
    mrrCents: number; activeSubscribers: number; trialing: number; trialConversions: number; churned: number;
    byTier: { planId: string; name: string; priceCents: number; active: number; trialing: number; mrrCents: number }[];
    byProvider: Record<"stripe" | "native", { active: number; trialing: number; mrrCents: number }>;
  };
}
interface Line { id: string; label: string; cents: number; count?: number; estimate?: boolean }

export default function RevenuePage() {
  const [days, setDays] = useState("30");
  const { data, error, isLoading } = useAdminQuery<Revenue>(`/revenue?days=${days}`);
  const max = Math.max(1, ...(data?.series.map((s) => s.platformFeesCents) ?? [1]));
  return (
    <>
      <PageTitle title="Revenue" />
      <div className="mb-4"><Chips value={days} onChange={setDays} options={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }, { id: "365", label: "1 year" }]} /></div>
      <ErrorLine error={error} />
      {isLoading && !data ? <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div> : data && (
        <>
          <StatCards items={[
            { label: "Platform fees earned", value: money(data.platformFeesCents) },
            { label: "Promotion revenue", value: money(data.boostRevenueCents) },
            { label: "Gross sales", value: money(data.gmvCents) },
            { label: "Refunded", value: money(data.refundedCents) },
            { label: "Orders", value: data.orders.toLocaleString() },
          ]} />
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-sm font-medium">Platform fees per day</div>
            {data.series.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No paid orders in this period.</p> : (
              <div className="flex h-40 items-end gap-[3px]" role="img" aria-label="Platform fees per day">
                {data.series.map((s) => (
                  <div key={s.day} title={`${s.day}: ${money(s.platformFeesCents)} from ${s.orders} orders`} className="group relative flex h-full min-w-0 flex-1 items-end">
                    <div className="w-full rounded-t-sm bg-foreground/80 group-hover:bg-foreground" style={{ height: `${Math.max(2, (s.platformFeesCents / max) * 100)}%` }} />
                  </div>
                ))}
              </div>
            )}
            {data.series.length > 0 && (
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{data.series[0]!.day}</span><span>{data.series[data.series.length - 1]!.day}</span></div>
            )}
          </div>
          <h2 className="mb-2 mt-6 text-sm font-medium">Net take</h2>
          <StatCards items={[
            { label: "Net take", value: money(data.netTakeCents) },
            { label: "Platform revenue", value: money(data.grossPlatformRevenueCents) },
            { label: "Costs", value: money(data.deductions.reduce((s, d) => s + d.cents, 0)) },
            { label: "Subscription MRR", value: money(data.subscriptions.mrrCents) },
          ]} />
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-baseline justify-between text-sm font-medium"><span>Platform revenue</span><span className="tabular-nums">{money(data.grossPlatformRevenueCents)}</span></div>
              <DataTable rows={data.lines} rowKey={(l) => l.id} empty="No revenue in this period."
                columns={[
                  { header: "Line", primary: true, cell: (l) => <span>{l.label}{l.estimate ? " (est.)" : ""}</span> },
                  { header: "Count", className: "tabular-nums text-muted-foreground", cell: (l) => (l.count ?? "—").toLocaleString() },
                  { header: "Amount", className: "whitespace-nowrap text-right tabular-nums", cell: (l) => money(l.cents) },
                ]} />
            </div>
            <div>
              <div className="mb-2 flex items-baseline justify-between text-sm font-medium"><span>Costs</span><span className="tabular-nums">−{money(data.deductions.reduce((s, d) => s + d.cents, 0))}</span></div>
              <DataTable rows={data.deductions} rowKey={(l) => l.id} empty="No costs in this period."
                columns={[
                  { header: "Cost", primary: true, cell: (l) => <span>{l.label}{l.estimate ? " (est.)" : ""}</span> },
                  { header: "Count", className: "tabular-nums text-muted-foreground", cell: (l) => (l.count ?? "—").toLocaleString() },
                  { header: "Amount", className: "whitespace-nowrap text-right tabular-nums", cell: (l) => `−${money(l.cents)}` },
                ]} />
            </div>
          </div>
          <h2 className="mb-2 mt-6 text-sm font-medium">Subscriptions</h2>
          <StatCards items={[
            { label: "Paying sellers", value: data.subscriptions.activeSubscribers.toLocaleString() },
            { label: "In free trial", value: data.subscriptions.trialing.toLocaleString() },
            { label: "Trials converted", value: data.subscriptions.trialConversions.toLocaleString() },
            { label: "Churned", value: data.subscriptions.churned.toLocaleString() },
          ]} />
          <DataTable rows={data.subscriptions.byTier} rowKey={(t) => t.planId} empty="No subscribers yet."
            columns={[
              { header: "Plan", primary: true, cell: (t) => <span>{t.planId.charAt(0).toUpperCase() + t.planId.slice(1)} · {money(t.priceCents)}/mo</span> },
              { header: "Paying", className: "tabular-nums", cell: (t) => t.active.toLocaleString() },
              { header: "In trial", className: "tabular-nums", cell: (t) => t.trialing.toLocaleString() },
              { header: "MRR", className: "text-right tabular-nums", cell: (t) => money(t.mrrCents) },
            ]} />
          <p className="mt-3 text-xs text-muted-foreground">
            Web {money(data.subscriptions.byProvider.stripe.mrrCents)} · App Store and Google Play {money(data.subscriptions.byProvider.native.mrrCents)} MRR.
            Fees are net of refunded fees. (est.) lines use Stripe's 2.9% + 30¢ card rate and a 15% store commission.
          </p>
        </>
      )}
    </>
  );
}
