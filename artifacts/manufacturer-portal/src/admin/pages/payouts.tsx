import { useState } from "react";
import { ActionButton, ActionGroup, Badge, Chips, DataTable, ErrorLine, PageTitle, StatCards } from "../ui";
import { money, useAdminQuery, when } from "../api";
import { PayoutHoldDialog, type PayoutTarget } from "../moneyActions";

/**
 * New and held connected accounts (sellers and manufacturers). New accounts
 * pay out on a 7-day delay for their first 30 days; holds stop payouts until
 * released. Balances come from Stripe (cached for a minute).
 */
interface Item {
  id: string; partyType: "seller" | "manufacturer"; partyId: string; name: string; suspended: boolean; accountCreatedAt: string;
  state: "new_account_delay" | "held" | "released"; delayDays: number | null; delayUntil: string | null; reason: string | null; heldAt: string | null;
  sales: { gmvCents: number; orders: number }; balance: { availableCents: number; pendingCents: number } | null;
}
type Filter = "review" | "held" | "all";

const stateBadge = (i: Item) =>
  i.state === "held" ? <Badge tone="danger">Held</Badge>
    : i.state === "new_account_delay" ? <Badge>{i.delayDays ? `${i.delayDays}-day delay` : "New"}</Badge>
      : <Badge tone="outline">Released</Badge>;

export default function PayoutsPage() {
  const [filter, setFilter] = useState<Filter>("review");
  const { data, error, isLoading } = useAdminQuery<{ items: Item[] }>(`/payouts/review?state=${filter}`);
  const [target, setTarget] = useState<PayoutTarget | null>(null);
  const items = data?.items;
  const withBalance = (items ?? []).filter((i) => i.balance);
  const sum = (pick: (i: Item) => number) => (withBalance.length ? money(withBalance.reduce((s, i) => s + pick(i), 0)) : "—");
  return (
    <>
      <PageTitle title="Payout review" />
      {items && <StatCards items={[
        { label: "Accounts", value: items.length.toLocaleString() },
        { label: "Held", value: items.filter((i) => i.state === "held").length.toLocaleString() },
        { label: "Pending balance", value: sum((i) => i.balance!.pendingCents) },
        { label: "Available balance", value: sum((i) => i.balance!.availableCents) },
      ]} />}
      <div className="mb-4"><Chips value={filter} onChange={setFilter} options={[{ id: "review", label: "In review" }, { id: "held", label: "Held" }, { id: "all", label: "All" }]} /></div>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={items} rowKey={(i) => i.id} empty={filter === "held" ? "No payouts are on hold." : "No accounts to review."}
        columns={[
          { header: "Account", primary: true, cell: (i) => <span className="flex items-center gap-2 font-medium">{i.name}{i.suspended && <Badge tone="danger">Suspended</Badge>}</span> },
          { header: "Type", cell: (i) => <Badge tone="outline">{i.partyType}</Badge> },
          { header: "Status", cell: stateBadge },
          { header: "Joined", cell: (i) => when(i.accountCreatedAt) },
          { header: "Sales", className: "tabular-nums", cell: (i) => (i.partyType === "seller" ? `${money(i.sales.gmvCents)} · ${i.sales.orders}` : "—") },
          { header: "Pending", className: "tabular-nums", cell: (i) => (i.balance ? money(i.balance.pendingCents) : "—") },
          { header: "Available", className: "tabular-nums", cell: (i) => (i.balance ? money(i.balance.availableCents) : "—") },
          { header: "Action", cell: (i) => (
            <ActionGroup>
              {i.state !== "held" && <ActionButton onClick={() => setTarget({ partyType: i.partyType, partyId: i.partyId, name: i.name, action: "hold" })}>Hold</ActionButton>}
              {i.state !== "released" && <ActionButton onClick={() => setTarget({ partyType: i.partyType, partyId: i.partyId, name: i.name, action: "release" })}>Release</ActionButton>}
            </ActionGroup>) },
        ]} />
      <PayoutHoldDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
