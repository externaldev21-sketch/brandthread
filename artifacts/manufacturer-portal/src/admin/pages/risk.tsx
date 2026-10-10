import { useState } from "react";
import { ActionButton, ActionGroup, Badge, DataTable, ErrorLine, PageTitle, StatCards } from "../ui";
import { money, useAdminQuery, when } from "../api";
import { OrderSheet, PayoutHoldDialog, RiskBadge, SuspendDialog, type PayoutTarget } from "../moneyActions";

/**
 * Risk review, modelled on Shopify admin's fraud analysis: each flagged order
 * shows its risk level, opens to the indicators behind it, and the people
 * behind it can be suspended or have their payouts held from the row.
 */
interface Party { clerkId: string; name: string; suspended: boolean; payoutState?: string | null }
interface Risk {
  thresholds: { NEW_SELLER_DAYS: number; FAST_GMV_CENTS: number; FAST_ORDER_COUNT: number; SHARED_DEVICE_MIN_ACCOUNTS: number; SEND_CHAIN_WINDOW_MINUTES: number };
  orders: { id: string; orderNumber: string; totalCents: number; riskLevel: string; riskScore: number | null; status: string; paidAt: string | null; seller: Party; buyer: { clerkId: string | null; name: string } }[];
  newSellers: (Party & { createdAt: string; orders: number; gmvCents: number; riskyOrders: number; disputes: number })[];
  threadCash: {
    sharedDevices: { deviceId: string; accounts: number; earnedCents: number; people: Party[] }[];
    sendChains: (Party & { hops: number; forwardedCents: number; lastAt: string | null })[];
  };
}
type Tab = "orders" | "sellers" | "threadCash";

export default function RiskPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const { data, error, isLoading } = useAdminQuery<Risk>("/risk");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [hold, setHold] = useState<PayoutTarget | null>(null);
  const [suspend, setSuspend] = useState<{ clerkId: string; name: string } | null>(null);

  const holdButton = (p: Party) => p.payoutState === "held"
    ? <ActionButton onClick={(e) => { e.stopPropagation(); setHold({ partyType: "seller", partyId: p.clerkId, name: p.name, action: "release" }); }}>Release</ActionButton>
    : <ActionButton onClick={(e) => { e.stopPropagation(); setHold({ partyType: "seller", partyId: p.clerkId, name: p.name, action: "hold" }); }}>Hold payouts</ActionButton>;
  const suspendButton = (p: Party) => (
    <ActionButton disabled={p.suspended} onClick={(e) => { e.stopPropagation(); setSuspend({ clerkId: p.clerkId, name: p.name }); }}>{p.suspended ? "Suspended" : "Suspend"}</ActionButton>
  );

  return (
    <>
      <PageTitle title="Risk" />
      <ErrorLine error={error} />
      {data && <StatCards items={[
        { label: "Flagged orders", value: String(data.orders.length), active: tab === "orders", onClick: () => setTab("orders") },
        { label: "Fast new sellers", value: String(data.newSellers.length), active: tab === "sellers", onClick: () => setTab("sellers") },
        { label: "Thread Cash patterns", value: String(data.threadCash.sharedDevices.length + data.threadCash.sendChains.length), active: tab === "threadCash", onClick: () => setTab("threadCash") },
      ]} />}

      {tab === "orders" && (
        <DataTable loading={isLoading} rows={data?.orders} rowKey={(o) => o.id} onRowClick={(o) => setOrderId(o.id)} empty="No elevated or highest-risk orders in the last 30 days."
          columns={[
            { header: "Order", primary: true, cell: (o) => <span className="font-medium">#{o.orderNumber}</span> },
            { header: "Risk", cell: (o) => <span className="flex items-center gap-2"><RiskBadge level={o.riskLevel} />{o.riskScore != null && <span className="text-xs text-muted-foreground">{o.riskScore}</span>}</span> },
            { header: "Total", className: "tabular-nums", cell: (o) => money(o.totalCents) },
            { header: "Seller", cell: (o) => o.seller.name },
            { header: "Buyer", cell: (o) => o.buyer.name },
            { header: "Paid", cell: (o) => when(o.paidAt) },
            { header: "Action", cell: (o) => <ActionGroup>{suspendButton({ ...o.seller })}{holdButton(o.seller)}</ActionGroup> },
          ]} />
      )}

      {tab === "sellers" && data && (
        <>
          <p className="mb-3 text-xs text-muted-foreground">Accounts under {data.thresholds.NEW_SELLER_DAYS} days old with {money(data.thresholds.FAST_GMV_CENTS)}+ in sales or {data.thresholds.FAST_ORDER_COUNT}+ orders.</p>
          <DataTable rows={data.newSellers} rowKey={(s) => s.clerkId} empty="No new sellers are moving unusually fast."
            columns={[
              { header: "Seller", primary: true, cell: (s) => <span className="flex items-center gap-2 font-medium">{s.name}{s.payoutState === "held" && <Badge tone="danger">Payouts held</Badge>}</span> },
              { header: "Joined", cell: (s) => when(s.createdAt) },
              { header: "Sales", className: "tabular-nums", cell: (s) => `${money(s.gmvCents)} · ${s.orders}` },
              { header: "Risky orders", className: "tabular-nums", cell: (s) => s.riskyOrders },
              { header: "Disputes", className: "tabular-nums", cell: (s) => s.disputes },
              { header: "Action", cell: (s) => <ActionGroup>{suspendButton(s)}{holdButton(s)}</ActionGroup> },
            ]} />
        </>
      )}

      {tab === "threadCash" && data && (
        <>
          <h2 className="mb-2 text-sm font-medium">Shared devices</h2>
          <DataTable rows={data.threadCash.sharedDevices} rowKey={(d) => d.deviceId} empty={`No device is used by ${data.thresholds.SHARED_DEVICE_MIN_ACCOUNTS}+ accounts.`}
            columns={[
              { header: "Device", primary: true, cell: (d) => <span className="font-mono text-xs">{d.deviceId.slice(0, 12)}…</span> },
              { header: "Accounts", className: "tabular-nums", cell: (d) => d.accounts },
              { header: "Rewards earned", className: "tabular-nums", cell: (d) => money(d.earnedCents) },
              { header: "People", cell: (d) => (
                <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
                  {d.people.map((p) => (
                    <button key={p.clerkId} disabled={p.suspended} onClick={() => setSuspend({ clerkId: p.clerkId, name: p.name })}
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:border-foreground disabled:opacity-50">{p.name}{p.suspended ? " · suspended" : ""}</button>
                  ))}
                </div>) },
            ]} />
          <h2 className="mb-2 mt-6 text-sm font-medium">Rapid send chains</h2>
          <DataTable rows={data.threadCash.sendChains} rowKey={(c) => c.clerkId} empty={`Nobody forwarded Thread Cash within ${data.thresholds.SEND_CHAIN_WINDOW_MINUTES} minutes of receiving it.`}
            columns={[
              { header: "Person", primary: true, cell: (c) => <span className="font-medium">{c.name}</span> },
              { header: "Forwards", className: "tabular-nums", cell: (c) => c.hops },
              { header: "Forwarded", className: "tabular-nums", cell: (c) => money(c.forwardedCents) },
              { header: "Last", cell: (c) => when(c.lastAt) },
              { header: "Action", cell: (c) => <ActionGroup>{suspendButton(c)}</ActionGroup> },
            ]} />
        </>
      )}

      <OrderSheet orderId={orderId} onClose={() => setOrderId(null)} />
      <PayoutHoldDialog target={hold} onClose={() => setHold(null)} />
      <SuspendDialog user={suspend} onClose={() => setSuspend(null)} />
    </>
  );
}
