import { useState } from "react";
import { Link } from "wouter";
import { ActionButton, ActionGroup, Badge, Chips, DataTable, ErrorLine, PageTitle, Pager } from "../ui";
import { money, useAdminQuery } from "../api";
import { PayoutHoldDialog, SuspendDialog, type PayoutTarget } from "../moneyActions";

/**
 * Sellers ranked by trouble signals. Disputes and refunds open the existing
 * Orders tabs (which carry the refund / evidence actions); payouts and
 * suspension reuse the same audited actions as Risk and Payout review.
 */
interface Seller {
  clerkId: string; name: string; score: number; reports: { total: number; open: number }; filterHits: number;
  disputes: number; disputedCents: number; orders: number; refundedOrders: number; refundRate: number; lateShipments: number;
  suspended: boolean; payoutState: string | null;
}
const LIMIT = 25;

export default function ProblemSellersPage() {
  const [days, setDays] = useState("90");
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useAdminQuery<{ items: Seller[]; hasMore: boolean }>(`/problem-sellers?days=${days}&limit=${LIMIT}&offset=${offset}`);
  const [hold, setHold] = useState<PayoutTarget | null>(null);
  const [suspend, setSuspend] = useState<{ clerkId: string; name: string } | null>(null);
  return (
    <>
      <PageTitle title="Problem sellers" />
      <div className="mb-4"><Chips value={days} onChange={(d) => { setDays(d); setOffset(0); }} options={[{ id: "30", label: "30 days" }, { id: "90", label: "90 days" }, { id: "365", label: "1 year" }]} /></div>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(s) => s.clerkId} empty="No seller has reports, disputes, refunds or late shipments in this period."
        columns={[
          { header: "Seller", primary: true, cell: (s) => (
            <span className="flex flex-wrap items-center gap-2 font-medium">{s.name}
              {s.suspended && <Badge tone="danger">Suspended</Badge>}
              {s.payoutState === "held" && <Badge tone="danger">Payouts held</Badge>}
            </span>) },
          { header: "Reports", className: "tabular-nums", cell: (s) => <Link href="/admin/moderation" className="hover:underline">{s.reports.open} open · {s.reports.total}</Link> },
          { header: "Filter hits", className: "tabular-nums", cell: (s) => s.filterHits },
          { header: "Disputes", className: "tabular-nums", cell: (s) => <Link href="/admin/orders?tab=disputes" className="hover:underline">{s.disputes}{s.disputedCents ? ` · ${money(s.disputedCents)}` : ""}</Link> },
          { header: "Refund rate", className: "tabular-nums", cell: (s) => <Link href="/admin/orders?tab=refunds" className="hover:underline">{s.orders ? `${Math.round(s.refundRate * 100)}% of ${s.orders}` : "—"}</Link> },
          { header: "Late", className: "tabular-nums", cell: (s) => s.lateShipments },
          { header: "Action", cell: (s) => (
            <ActionGroup>
              <ActionButton disabled={s.suspended} onClick={() => setSuspend({ clerkId: s.clerkId, name: s.name })}>{s.suspended ? "Suspended" : "Suspend"}</ActionButton>
              {s.payoutState === "held"
                ? <ActionButton onClick={() => setHold({ partyType: "seller", partyId: s.clerkId, name: s.name, action: "release" })}>Release</ActionButton>
                : <ActionButton onClick={() => setHold({ partyType: "seller", partyId: s.clerkId, name: s.name, action: "hold" })}>Hold payouts</ActionButton>}
            </ActionGroup>) },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} onChange={setOffset} />
      <PayoutHoldDialog target={hold} onClose={() => setHold(null)} />
      <SuspendDialog user={suspend} onClose={() => setSuspend(null)} />
    </>
  );
}
