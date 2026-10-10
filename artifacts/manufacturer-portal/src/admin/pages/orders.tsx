import { useState } from "react";
import { Badge, Chips, DataTable, ErrorLine, PageTitle, Pager, SearchBox, StatCards } from "../ui";
import { money, useAdminQuery, useQs, when } from "../api";
import { DisputeSheet, OrderSheet, RiskBadge } from "../moneyActions";

interface Party { clerkId: string | null; name: string | null }
interface OrderRow {
  id: string; orderNumber: string; status: string; totalCents: number; platformFeeCents: number; refundedCents: number;
  seller: Party; buyer: Party; paidAt: string | null; createdAt: string; full?: boolean; autoRefunded?: boolean; refundedAt?: string;
}
interface DisputeRow {
  id: string; orderNumber: string | null; seller: Party; amountCents: number; reason: string | null; status: string; evidenceDueBy: string | null; createdAt: string;
}
type Tab = "orders" | "refunds" | "disputes";
const LIMIT = 25;
const label = (s: string) => s.replaceAll("_", " ");

export default function OrdersPage() {
  const [tab, setTab] = useState<Tab>(() => (initialParam("tab") as Tab) || "orders");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  return (
    <>
      <PageTitle title="Orders" />
      <div className="mb-4"><Chips value={tab} onChange={setTab} options={[{ id: "orders", label: "All orders" }, { id: "refunds", label: "Refunds" }, { id: "disputes", label: "Disputes" }]} /></div>
      {tab === "orders" && <OrderList onOpen={setOrderId} />}
      {tab === "refunds" && <RefundList onOpen={setOrderId} />}
      {tab === "disputes" && <DisputeList onOpen={setDisputeId} />}
      <OrderSheet orderId={orderId} onClose={() => setOrderId(null)} onOpenDispute={(id) => { setOrderId(null); setDisputeId(id); }} />
      <DisputeSheet disputeId={disputeId} onClose={() => setDisputeId(null)} />
    </>
  );
}

/** Deep links from other admin pages, e.g. /admin/orders?risk=elevated or ?tab=disputes. */
function initialParam(key: string): string {
  try { return new URLSearchParams(window.location.search).get(key) ?? ""; } catch { return ""; }
}

const names = (o: OrderRow) => ({ seller: o.seller.name ?? "—", buyer: o.buyer.name ?? "Guest" });

function OrderList({ onOpen }: { onOpen: (id: string) => void }) {
  const qs = useQs();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState(() => { const r = initialParam("risk"); return r === "elevated" || r === "highest" ? r : ""; });
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = useAdminQuery<{ items: OrderRow[]; hasMore: boolean; total: number }>(`/orders${qs({ q, status, risk, limit: LIMIT, offset })}`);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SearchBox value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Order number or email" />
        <Chips value={status} onChange={(s) => { setStatus(s); setOffset(0); }} options={[
          { id: "", label: "All" }, { id: "pending", label: "Pending" }, { id: "processing", label: "Processing" },
          { id: "shipped", label: "Shipped" }, { id: "fulfilled", label: "Fulfilled" }, { id: "cancelled", label: "Cancelled" },
        ]} />
      </div>
      {risk && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <RiskBadge level={risk} /> risk and above
          <button className="underline hover:text-foreground" onClick={() => { setRisk(""); setOffset(0); }}>Clear</button>
        </div>
      )}
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(o) => o.id} onRowClick={(o) => onOpen(o.id)} empty="No orders found."
        columns={[
          { header: "Order", primary: true, cell: (o) => <span className="font-medium">#{o.orderNumber}</span> },
          { header: "Status", cell: (o) => <Badge>{o.status}</Badge> },
          { header: "Total", className: "tabular-nums", cell: (o) => money(o.totalCents) },
          { header: "Platform fee", className: "tabular-nums", cell: (o) => money(o.platformFeeCents) },
          { header: "Seller", cell: (o) => names(o).seller },
          { header: "Buyer", cell: (o) => names(o).buyer },
          { header: "Placed", cell: (o) => when(o.createdAt) },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} total={data?.total} onChange={setOffset} />
    </>
  );
}

function RefundList({ onOpen }: { onOpen: (id: string) => void }) {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = useAdminQuery<{ items: OrderRow[]; hasMore: boolean; summary: { orders: number; refundedCents: number } }>(`/refunds?limit=${LIMIT}&offset=${offset}`);
  return (
    <>
      {data && <StatCards items={[{ label: "Refunded orders", value: data.summary.orders.toLocaleString() }, { label: "Total refunded", value: money(data.summary.refundedCents) }]} />}
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(o) => o.id} onRowClick={(o) => onOpen(o.id)} empty="No refunds yet."
        columns={[
          { header: "Order", primary: true, cell: (o) => <span className="font-medium">#{o.orderNumber}</span> },
          { header: "Refunded", className: "tabular-nums", cell: (o) => money(o.refundedCents) },
          { header: "Type", cell: (o) => <Badge tone="outline">{o.autoRefunded ? "Auto (late delivery)" : o.full ? "Full" : "Partial"}</Badge> },
          { header: "Order total", className: "tabular-nums", cell: (o) => money(o.totalCents) },
          { header: "Seller", cell: (o) => names(o).seller },
          { header: "Buyer", cell: (o) => names(o).buyer },
          { header: "Refunded", cell: (o) => when(o.refundedAt ?? o.createdAt) },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} onChange={setOffset} />
    </>
  );
}

function DisputeList({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = useAdminQuery<{ items: DisputeRow[]; hasMore: boolean; summary: { disputes: number; amountCents: number } }>(`/disputes?status=${status}&limit=${LIMIT}&offset=${offset}`);
  return (
    <>
      <div className="mb-4"><Chips value={status} onChange={(s) => { setStatus(s); setOffset(0); }} options={[{ id: "open", label: "Open" }, { id: "closed", label: "Closed" }, { id: "all", label: "All" }]} /></div>
      {data && <StatCards items={[{ label: "Disputes", value: data.summary.disputes.toLocaleString() }, { label: "Amount in dispute", value: money(data.summary.amountCents) }]} />}
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(d) => d.id} onRowClick={(d) => onOpen(d.id)} empty="No disputes."
        columns={[
          { header: "Order", primary: true, cell: (d) => <span className="font-medium">{d.orderNumber ? `#${d.orderNumber}` : "—"}</span> },
          { header: "Amount", className: "tabular-nums", cell: (d) => money(d.amountCents) },
          { header: "Status", cell: (d) => <Badge>{label(d.status)}</Badge> },
          { header: "Reason", cell: (d) => label(d.reason ?? "—") },
          { header: "Seller", cell: (d) => d.seller.name ?? "—" },
          { header: "Evidence due", cell: (d) => when(d.evidenceDueBy) },
          { header: "Opened", cell: (d) => when(d.createdAt) },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} onChange={setOffset} />
    </>
  );
}
