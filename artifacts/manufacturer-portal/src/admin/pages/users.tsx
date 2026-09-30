import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge, Chips, ConfirmAction, DataTable, ErrorLine, PageTitle, Pager, SearchBox } from "../ui";
import { dollarsFromMicros, money, useAdminMutation, useAdminQuery, useQs, when } from "../api";

interface AdminUser {
  clerkId: string; name: string; email: string; username: string | null; role: string; accountType: string | null; brandName: string | null;
  plan: string | null; subscriptionStatus: string | null; verified: boolean; suspended: boolean; suspensionReason: string | null; createdAt: string;
}
interface UserDetail extends AdminUser {
  stripeAccountStatus: string | null;
  sales: { orders: number; grossCents: number; platformFeeCents: number };
  purchases: { orders: number; spentCents: number };
  reports: { total: number; open: number };
  aiSpend: { costMicros: number; calls: number };
}
type Kind = "all" | "sellers" | "buyers" | "suspended";
const LIMIT = 25;

export default function UsersPage() {
  const qs = useQs();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useAdminQuery<{ items: AdminUser[]; hasMore: boolean; total: number }>(`/users${qs({ q, kind, limit: LIMIT, offset })}`);

  return (
    <>
      <PageTitle title="Users & sellers" />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SearchBox value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Name, email or brand" />
        <Chips value={kind} onChange={(k) => { setKind(k); setOffset(0); }} options={[
          { id: "all", label: "All" }, { id: "sellers", label: "Sellers" }, { id: "buyers", label: "Buyers" },
          { id: "suspended", label: "Suspended" },
        ]} />
      </div>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(u) => u.clerkId} onRowClick={(u) => setOpenId(u.clerkId)} empty="No one matches that search."
        columns={[
          { header: "Name", primary: true, cell: (u) => (
            <span className="flex items-center gap-1.5">
              <span className="font-medium">{u.brandName || u.name}</span>
              {u.verified && <BadgeCheck className="h-3.5 w-3.5" aria-label="Verified" />}
            </span>) },
          { header: "Email", cell: (u) => <span className="text-muted-foreground">{u.email}</span> },
          { header: "Type", cell: (u) => <Badge tone="outline">{u.role === "admin" ? "admin" : u.accountType ?? "buyer"}</Badge> },
          { header: "Plan", cell: (u) => u.plan ?? "—" },
          { header: "Status", cell: (u) => u.suspended ? <Badge tone="danger">Suspended</Badge> : <Badge>Active</Badge> },
          { header: "Joined", cell: (u) => when(u.createdAt) },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} total={data?.total} onChange={setOffset} />
      <UserSheet clerkId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function UserSheet({ clerkId, onClose }: { clerkId: string | null; onClose: () => void }) {
  const { data: u } = useAdminQuery<UserDetail>(`/users/${clerkId}`, !!clerkId);
  const [confirm, setConfirm] = useState<"suspend" | "reinstate" | null>(null);
  const refresh = ["/users"];
  const suspend = useAdminMutation<{ reason: string }>("POST", `/users/${clerkId}/suspend`, refresh);
  const reinstate = useAdminMutation<object>("POST", `/users/${clerkId}/reinstate`, refresh);
  const verify = useAdminMutation<{ verified: boolean }>("POST", `/users/${clerkId}/verify`, refresh);
  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span>
    </div>
  );
  const isAdmin = u?.role === "admin";

  return (
    <Sheet open={!!clerkId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-border bg-popover sm:max-w-md">
        <SheetHeader><SheetTitle>{u ? u.brandName || u.name : "Loading…"}</SheetTitle></SheetHeader>
        {u && (
          <div className="px-4 pb-6">
            <div className="mb-4 flex flex-wrap gap-1.5">
              {u.suspended ? <Badge tone="danger">Suspended</Badge> : <Badge>Active</Badge>}
              {u.verified && <Badge tone="solid">Verified</Badge>}
              <Badge tone="outline">{isAdmin ? "admin" : u.accountType ?? "buyer"}</Badge>
            </div>
            {row("Email", u.email)}
            {u.username && row("Handle", `@${u.username}`)}
            {row("Joined", when(u.createdAt))}
            {u.accountType !== "buyer" && row("Plan", `${u.plan ?? "starter"} · ${u.subscriptionStatus ?? "none"}`)}
            {u.accountType !== "buyer" && row("Payouts", u.stripeAccountStatus ?? "Not connected")}
            {row("Sales", `${u.sales.orders} orders · ${money(u.sales.grossCents)}`)}
            {row("Fees paid to Brandthread", money(u.sales.platformFeeCents))}
            {row("Purchases", `${u.purchases.orders} orders · ${money(u.purchases.spentCents)}`)}
            {row("Reports against", `${u.reports.total} (${u.reports.open} open)`)}
            {row("AI spend", `${dollarsFromMicros(u.aiSpend.costMicros)} · ${u.aiSpend.calls} calls`)}
            {u.suspended && u.suspensionReason && row("Suspension reason", u.suspensionReason)}
            <ErrorLine error={verify.error} />
            {!isAdmin && (
              <div className="mt-5 flex flex-col gap-2">
                <Button variant="outline" className="h-10 w-full px-3" disabled={verify.isPending} onClick={() => verify.mutate({ verified: !u.verified })}>
                  {u.verified ? "Remove verified badge" : "Give verified badge"}
                </Button>
                {u.suspended
                  ? <Button variant="outline" className="h-10 w-full px-3" onClick={() => setConfirm("reinstate")}>Reinstate account</Button>
                  : <Button variant="destructive" className="h-10 w-full px-3" onClick={() => setConfirm("suspend")}>Suspend account</Button>}
              </div>
            )}
          </div>
        )}
        <ConfirmAction open={confirm === "suspend"} title="Suspend this account?" destructive confirmLabel="Suspend"
          description="They're signed out everywhere and their content is hidden. Nothing is deleted, and you can reinstate them at any time."
          reasonLabel="Reason (kept in the audit log)" reasonRequired pending={suspend.isPending} error={suspend.error}
          onCancel={() => setConfirm(null)} onConfirm={(reason) => suspend.mutate({ reason }, { onSuccess: () => setConfirm(null) })} />
        <ConfirmAction open={confirm === "reinstate"} title="Reinstate this account?" confirmLabel="Reinstate"
          description="They can sign in again and their content becomes visible."
          pending={reinstate.isPending} error={reinstate.error}
          onCancel={() => setConfirm(null)} onConfirm={() => reinstate.mutate({}, { onSuccess: () => setConfirm(null) })} />
      </SheetContent>
    </Sheet>
  );
}
