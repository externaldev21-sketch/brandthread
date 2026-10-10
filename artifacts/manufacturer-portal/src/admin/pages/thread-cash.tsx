import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Chips, ConfirmAction, DataTable, ErrorLine, PageTitle, StatCards } from "../ui";
import { money, useAdminMutation, useAdminQuery, when } from "../api";

type Kind = "rewards" | "checkout";
interface Summary {
  days: number; outstandingCents: number; issuedCents: number; redeemedCents: number; expiredCents: number;
  rewardsTodayCents: number; rewardsMonthCents: number; earnersToday: number;
  series: { day: string; issuedCents: number; redeemedCents: number; expiredCents: number }[];
  topEarners: { clerkId: string; name: string; email: string | null; earnedCents: number; entries: number; balanceCents: number }[];
  pause: Record<Kind, { paused: boolean; updatedAt: string | null }>;
}

const SWITCHES: { kind: Kind; title: string; on: string; off: string }[] = [
  { kind: "rewards", title: "Pause daily rewards",
    on: "Nobody earns daily or streak Thread Cash until you turn this off. Balances stay as they are.",
    off: "Daily and streak rewards start paying out again." },
  { kind: "checkout", title: "Pause Thread Cash at checkout",
    on: "Buyers can't apply Thread Cash to new orders. Anything already reserved can still be released.",
    off: "Buyers can apply Thread Cash at checkout again." },
];

export default function ThreadCashPage() {
  const [days, setDays] = useState("30");
  const { data, error, isLoading } = useAdminQuery<Summary>(`/thread-cash/summary?days=${days}`);
  const toggle = useAdminMutation<{ kind: Kind; paused: boolean }>("POST", "/thread-cash/pause", ["/thread-cash"]);
  const [pending, setPending] = useState<{ kind: Kind; paused: boolean } | null>(null);
  const max = Math.max(1, ...(data?.series.map((s) => s.issuedCents) ?? [1]));
  const sw = pending ? SWITCHES.find((s) => s.kind === pending.kind)! : null;

  return (
    <>
      <PageTitle title="Thread Cash" />
      <div className="mb-4"><Chips value={days} onChange={setDays} options={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }, { id: "365", label: "1 year" }]} /></div>
      <ErrorLine error={error} />
      {isLoading && !data ? <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div> : data && (
        <>
          <StatCards items={[
            { label: "Outstanding liability", value: money(data.outstandingCents) },
            { label: "Issued", value: money(data.issuedCents) },
            { label: "Redeemed", value: money(data.redeemedCents) },
            { label: "Expired", value: money(data.expiredCents) },
          ]} />
          <StatCards items={[
            { label: "Rewards today", value: money(data.rewardsTodayCents) },
            { label: "Rewards this month", value: money(data.rewardsMonthCents) },
            { label: "Earned today", value: `${data.earnersToday.toLocaleString()} people` },
            { label: "Redeemed vs issued", value: data.issuedCents ? `${Math.round((data.redeemedCents / data.issuedCents) * 100)}%` : "—" },
          ]} />

          <div className="mb-5 divide-y divide-border rounded-lg border border-border bg-card">
            {SWITCHES.map((s) => (
              <div key={s.kind} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{data.pause[s.kind].paused ? `Paused ${when(data.pause[s.kind].updatedAt)}` : "Running"}</div>
                </div>
                <Switch checked={data.pause[s.kind].paused} aria-label={s.title}
                  onCheckedChange={(paused) => setPending({ kind: s.kind, paused })} />
              </div>
            ))}
          </div>

          <div className="mb-5 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-sm font-medium">Issued per day</div>
            {data.series.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No Thread Cash activity in this period.</p> : (
              <div className="flex h-40 items-end gap-[3px]" role="img" aria-label="Thread Cash issued per day">
                {data.series.map((s) => (
                  <div key={s.day} title={`${s.day}: ${money(s.issuedCents)} issued · ${money(s.redeemedCents)} redeemed · ${money(s.expiredCents)} expired`} className="group relative flex h-full min-w-0 flex-1 items-end">
                    <div className="w-full rounded-t-sm bg-foreground/80 group-hover:bg-foreground" style={{ height: `${Math.max(2, (s.issuedCents / max) * 100)}%` }} />
                  </div>
                ))}
              </div>
            )}
            {data.series.length > 0 && (
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{data.series[0]!.day}</span><span>{data.series[data.series.length - 1]!.day}</span></div>
            )}
          </div>

          <h2 className="mb-2 text-sm font-medium">Top earners</h2>
          <DataTable rows={data.topEarners} rowKey={(t) => t.clerkId} empty="Nobody earned rewards in this period."
            columns={[
              { header: "Person", primary: true, cell: (t) => <span className="font-medium">{t.name}</span> },
              { header: "Email", cell: (t) => <span className="text-muted-foreground">{t.email ?? "—"}</span> },
              { header: "Rewards", className: "tabular-nums", cell: (t) => money(t.earnedCents) },
              { header: "Times", className: "tabular-nums", cell: (t) => t.entries.toLocaleString() },
              { header: "Balance", className: "text-right tabular-nums", cell: (t) => money(t.balanceCents) },
            ]} />
        </>
      )}
      <ConfirmAction open={!!pending} destructive={pending?.paused}
        title={pending ? (pending.paused ? `${sw!.title}?` : `Turn ${sw!.title.replace("Pause ", "").toLowerCase()} back on?`) : ""}
        description={pending ? (pending.paused ? sw!.on : sw!.off) : ""}
        confirmLabel={pending?.paused ? "Pause" : "Turn on"} pending={toggle.isPending} error={toggle.error}
        onCancel={() => setPending(null)} onConfirm={() => pending && toggle.mutate(pending, { onSuccess: () => setPending(null) })} />
    </>
  );
}
