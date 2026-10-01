import { PageTitle, StatCards } from "../ui";
import { money, useAdminQuery } from "../api";
import { Link } from "wouter";

interface Overview {
  users: number; sellers: number; suspended: number; joinedLast30Days: number; orders30d: number;
  gmv30dCents: number; platformFees30dCents: number; openReports: number; openDisputes: number; boostsAwaitingReview: number;
}

export default function OverviewPage() {
  const { data, isLoading, error } = useAdminQuery<Overview>("/overview");
  if (error) return <p className="text-sm text-destructive">Could not load the overview.</p>;
  if (isLoading || !data) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  const attention = [
    { label: "Reports to review", n: data.openReports, href: "/admin/moderation" },
    { label: "Open disputes", n: data.openDisputes, href: "/admin/orders" },
    { label: "Promotions awaiting approval", n: data.boostsAwaitingReview, href: "/admin/promotions" },
  ];
  return (
    <>
      <PageTitle title="Overview" />
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Last 30 days</h2>
      <StatCards items={[
        { label: "Gross sales", value: money(data.gmv30dCents) },
        { label: "Platform fees", value: money(data.platformFees30dCents) },
        { label: "Orders", value: data.orders30d.toLocaleString() },
        { label: "New members", value: data.joinedLast30Days.toLocaleString() },
      ]} />
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Community</h2>
      <StatCards items={[
        { label: "Members", value: data.users.toLocaleString() },
        { label: "Sellers", value: data.sellers.toLocaleString() },
        { label: "Suspended", value: data.suspended.toLocaleString() },
      ]} />
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Needs attention</h2>
      <div className="divide-y divide-border rounded-lg border border-border">
        {attention.map((a) => (
          <Link key={a.label} href={a.href} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary/60">
            <span>{a.label}</span>
            <span className="font-semibold tabular-nums">{a.n}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
