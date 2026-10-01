import { useState } from "react";
import { Chips, ErrorLine, PageTitle, StatCards } from "../ui";
import { money, useAdminQuery } from "../api";

interface Revenue {
  days: number; orders: number; gmvCents: number; platformFeesCents: number; refundedCents: number; boostRevenueCents: number; boostsSold: number;
  series: { day: string; orders: number; gmvCents: number; platformFeesCents: number }[];
}

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
          <p className="mt-3 text-xs text-muted-foreground">Fees are net of refunded fees. Subscription revenue is billed and reported in Stripe.</p>
        </>
      )}
    </>
  );
}
