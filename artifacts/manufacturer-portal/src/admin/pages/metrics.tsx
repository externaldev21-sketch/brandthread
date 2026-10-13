import { useState, type ReactNode } from "react";
import { Badge, Chips, DataTable, ErrorLine, PageTitle } from "../ui";
import { money, useAdminQuery, when } from "../api";

/**
 * Internal marketplace numbers. Layout follows Stripe's Dashboard: a "Today"
 * row compared with yesterday, then "Retention by cohort", then one table with
 * filter tabs (Stripe's Customers tabs: Top customers / High refunds / …).
 */

interface DayTotals { gmvCents: number; feesCents: number; orders: number; newBuyers: number; signups: number; activeSellers: number }
interface Today { timeZone: string; asOf: string; today: DayTotals; yesterday: DayTotals }
interface Cohorts { windowDays: number; cohorts: { month: string; buyers: number; repeatBuyers: number; repeatRate: number | null; maturing: boolean }[] }
interface Funnel { days: number; installs: { installs: number; signedUp: number; purchased: number }; signups: { signups: number; purchased: number } }
interface Top {
  days: number;
  sellers: { clerkId: string; name: string | null; username: string | null; orders: number; gmvCents: number; feesCents: number }[];
  products: { productId: string; name: string; seller: string | null; units: number; revenueCents: number; orders: number }[];
}
interface SellerRisk {
  days: number; threshold: number;
  sellers: { clerkId: string; name: string | null; username: string | null; orders: number; refundedOrders: number; chargebacks: number; refundRate: number; chargebackRate: number; flagged: boolean }[];
}
interface Inactive { days: number; sellers: { clerkId: string; name: string | null; username: string | null; lastActiveAt: string; daysInactive: number; activeProducts: number }[] }

const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`);
const rate = (num: number, den: number) => (den > 0 ? num / den : null);
const sellerName = (s: { name: string | null; username: string | null }) => (
  <span>{s.name ?? "Unnamed seller"}{s.username && <span className="ml-1.5 text-muted-foreground">@{s.username}</span>}</span>
);
const Loading = () => <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
const SectionTitle = ({ children, action }: { children: string; action?: ReactNode }) => (
  <div className="mb-3 mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
    {action}
  </div>
);

const RANGE = [{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }];

function TodaySection() {
  const { data, error, isLoading } = useAdminQuery<Today>("/metrics/today");
  if (error) return <ErrorLine error={error} />;
  if (isLoading || !data) return <Loading />;
  const cards: { label: string; value: (d: DayTotals) => string }[] = [
    { label: "Gross sales", value: (d) => money(d.gmvCents) },
    { label: "Platform fees", value: (d) => money(d.feesCents) },
    { label: "Orders", value: (d) => d.orders.toLocaleString() },
    { label: "New buyers", value: (d) => d.newBuyers.toLocaleString() },
    { label: "Sign-ups", value: (d) => d.signups.toLocaleString() },
    { label: "Active sellers", value: (d) => d.activeSellers.toLocaleString() },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border bg-card px-3.5 py-3">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="mt-1 truncate text-lg font-semibold tabular-nums">{c.value(data.today)}</div>
          <div className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">Yesterday {c.value(data.yesterday)}</div>
        </div>
      ))}
    </div>
  );
}

function FunnelSection() {
  const [days, setDays] = useState("30");
  const { data, error, isLoading } = useAdminQuery<Funnel>(`/metrics/funnel?days=${days}`);
  const steps = data ? [
    { step: "Installs", people: data.installs.installs, conv: null as number | null },
    { step: "Signed up", people: data.installs.signedUp, conv: rate(data.installs.signedUp, data.installs.installs) },
    { step: "First purchase", people: data.installs.purchased, conv: rate(data.installs.purchased, data.installs.signedUp) },
  ] : undefined;
  return (
    <>
      <SectionTitle action={<Chips value={days} onChange={setDays} options={RANGE} />}>Install to first purchase</SectionTitle>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={steps} rowKey={(r) => r.step} empty="No installs in this period."
        columns={[
          { header: "Step", cell: (r) => r.step, primary: true },
          { header: "People", cell: (r) => r.people.toLocaleString(), className: "text-right tabular-nums" },
          { header: "From previous step", cell: (r) => pct(r.conv), className: "text-right tabular-nums" },
        ]} />
      {data && (
        <p className="mt-2 text-xs text-muted-foreground">
          Accounts created in this period: {data.signups.signups.toLocaleString()}, of which {data.signups.purchased.toLocaleString()} made a purchase ({pct(rate(data.signups.purchased, data.signups.signups))}).
        </p>
      )}
    </>
  );
}

function CohortSection() {
  const { data, error, isLoading } = useAdminQuery<Cohorts>("/metrics/cohorts?months=6");
  return (
    <>
      <SectionTitle>Retention by cohort</SectionTitle>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.cohorts} rowKey={(r) => r.month} empty="No purchases in the last 6 months."
        columns={[
          { header: "First purchase", cell: (r) => r.month, primary: true },
          { header: "Buyers", cell: (r) => r.buyers.toLocaleString(), className: "text-right tabular-nums" },
          { header: "Bought again within 30 days", cell: (r) => r.repeatBuyers.toLocaleString(), className: "text-right tabular-nums" },
          { header: "Repeat rate", cell: (r) => <span>{pct(r.repeatRate)}{r.maturing && <span className="ml-2"><Badge tone="outline">In progress</Badge></span>}</span>, className: "text-right tabular-nums" },
        ]} />
    </>
  );
}

type Tab = "sellers" | "products" | "risk" | "inactive";

function SellerTables() {
  const [tab, setTab] = useState<Tab>("sellers");
  const [days, setDays] = useState("30");
  const top = useAdminQuery<Top>(`/metrics/top?days=${days}`, tab === "sellers" || tab === "products");
  const risk = useAdminQuery<SellerRisk>("/metrics/seller-risk?days=90", tab === "risk");
  const inactive = useAdminQuery<Inactive>("/metrics/inactive-sellers", tab === "inactive");
  return (
    <>
      <SectionTitle action={(tab === "sellers" || tab === "products") ? <Chips value={days} onChange={setDays} options={RANGE} /> : undefined}>Sellers and products</SectionTitle>
      <div className="mb-3">
        <Chips<Tab> value={tab} onChange={setTab} options={[
          { id: "sellers", label: "Top sellers" }, { id: "products", label: "Top products" },
          { id: "risk", label: "High refunds & disputes" }, { id: "inactive", label: "Inactive 14+ days" },
        ]} />
      </div>
      {tab === "sellers" && (
        <><ErrorLine error={top.error} />
        <DataTable loading={top.isLoading} rows={top.data?.sellers} rowKey={(r) => r.clerkId} empty="No sales in this period."
          columns={[
            { header: "Seller", cell: sellerName, primary: true },
            { header: "Gross sales", cell: (r) => money(r.gmvCents), className: "text-right tabular-nums" },
            { header: "Orders", cell: (r) => r.orders.toLocaleString(), className: "text-right tabular-nums" },
            { header: "Platform fees", cell: (r) => money(r.feesCents), className: "text-right tabular-nums" },
          ]} /></>
      )}
      {tab === "products" && (
        <><ErrorLine error={top.error} />
        <DataTable loading={top.isLoading} rows={top.data?.products} rowKey={(r) => r.productId} empty="No sales in this period."
          columns={[
            { header: "Product", cell: (r) => r.name, primary: true },
            { header: "Seller", cell: (r) => r.seller ?? "—" },
            { header: "Sales", cell: (r) => money(r.revenueCents), className: "text-right tabular-nums" },
            { header: "Units", cell: (r) => r.units.toLocaleString(), className: "text-right tabular-nums" },
            { header: "Orders", cell: (r) => r.orders.toLocaleString(), className: "text-right tabular-nums" },
          ]} /></>
      )}
      {tab === "risk" && (
        <><ErrorLine error={risk.error} />
        <DataTable loading={risk.isLoading} rows={risk.data?.sellers} rowKey={(r) => r.clerkId} empty="No refunds or disputes in the last 90 days."
          columns={[
            { header: "Seller", cell: (r) => <span>{sellerName(r)}{r.flagged && <span className="ml-2"><Badge tone="solid">Over 2%</Badge></span>}</span>, primary: true },
            { header: "Orders (90 days)", cell: (r) => r.orders.toLocaleString(), className: "text-right tabular-nums" },
            { header: "Refund rate", cell: (r) => `${pct(r.refundRate)} (${r.refundedOrders})`, className: "text-right tabular-nums" },
            { header: "Chargeback rate", cell: (r) => `${pct(r.chargebackRate)} (${r.chargebacks})`, className: "text-right tabular-nums" },
          ]} /></>
      )}
      {tab === "inactive" && (
        <><ErrorLine error={inactive.error} />
        <DataTable loading={inactive.isLoading} rows={inactive.data?.sellers} rowKey={(r) => r.clerkId} empty="Every seller has been active in the last 14 days."
          columns={[
            { header: "Seller", cell: sellerName, primary: true },
            { header: "Last active", cell: (r) => when(r.lastActiveAt) },
            { header: "Days inactive", cell: (r) => r.daysInactive.toLocaleString(), className: "text-right tabular-nums" },
            { header: "Live products", cell: (r) => r.activeProducts.toLocaleString(), className: "text-right tabular-nums" },
          ]} /></>
      )}
    </>
  );
}

export default function MetricsPage() {
  return (
    <>
      <PageTitle title="Metrics" />
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Today</h2>
      <TodaySection />
      <FunnelSection />
      <CohortSection />
      <SellerTables />
    </>
  );
}
