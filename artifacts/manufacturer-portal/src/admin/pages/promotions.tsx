import { useState } from "react";
import { Badge, Chips, ConfirmAction, DataTable, ErrorLine, PageTitle, Pager } from "../ui";
import { money, useAdminMutation, useAdminQuery, when } from "../api";

interface Boost {
  id: string; seller: { name: string | null }; thread: { id: string; caption: string | null; thumbnailUrl: string | null };
  objective: string; budgetCents: number; durationDays: number; boostStatus: string; paidAt: string | null;
  review: { status: string; reason: string | null } | null;
}
const LIMIT = 25;

export default function PromotionsPage() {
  const [status, setStatus] = useState<"pending" | "reviewed">("pending");
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useAdminQuery<{ items: Boost[]; hasMore: boolean; total: number }>(`/boosts?status=${status}&limit=${LIMIT}&offset=${offset}`);
  const review = useAdminMutation<{ id: string; decision: string; reason?: string }>("POST", (b) => `/boosts/${b.id}/review`, ["/boosts", "/overview"]);
  const [target, setTarget] = useState<{ boost: Boost; decision: "approve" | "reject" } | null>(null);

  return (
    <>
      <PageTitle title="Promoted threads" />
      <div className="mb-4"><Chips value={status} onChange={(s) => { setStatus(s); setOffset(0); }} options={[{ id: "pending", label: "Awaiting approval" }, { id: "reviewed", label: "Reviewed" }]} /></div>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(b) => b.id} empty={status === "pending" ? "Nothing is waiting for approval." : "No reviewed promotions yet."}
        columns={[
          { header: "Thread", primary: true, cell: (b) => (
            <div className="flex items-center gap-3">
              {b.thread.thumbnailUrl && <img src={b.thread.thumbnailUrl} alt="" className="h-12 w-9 rounded object-cover" />}
              <div className="min-w-0"><div className="line-clamp-2 max-w-xs font-medium">{b.thread.caption || "Untitled thread"}</div></div>
            </div>) },
          { header: "Seller", cell: (b) => b.seller.name ?? "—" },
          { header: "Goal", cell: (b) => <span className="capitalize">{b.objective.replaceAll("_", " ")}</span> },
          { header: "Budget", className: "tabular-nums", cell: (b) => `${money(b.budgetCents)} · ${b.durationDays}d` },
          { header: "Paid", cell: (b) => when(b.paidAt) },
          { header: status === "pending" ? "Decision" : "Outcome", cell: (b) => b.review
            ? <Badge tone={b.review.status === "approved" ? "solid" : "danger"}>{b.review.status}</Badge>
            : <div className="flex justify-end gap-1.5">
                <button className="rounded border border-foreground bg-foreground px-2.5 py-1 text-xs font-medium text-background" onClick={() => setTarget({ boost: b, decision: "approve" })}>Approve</button>
                <button className="rounded border border-border px-2.5 py-1 text-xs hover:border-foreground" onClick={() => setTarget({ boost: b, decision: "reject" })}>Reject</button>
              </div> },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} total={data?.total} onChange={setOffset} />
      <ConfirmAction open={!!target} confirmLabel={target?.decision === "approve" ? "Approve" : "Reject promotion"} destructive={target?.decision === "reject"}
        title={target?.decision === "approve" ? "Approve this promotion?" : "Reject this promotion?"}
        description={target?.decision === "approve" ? "It keeps running as paid." : "It stops running and the seller is told why. This does not refund the payment — refund it in Stripe."}
        reasonLabel={target?.decision === "reject" ? "Reason shown to the seller" : undefined} reasonRequired={target?.decision === "reject"}
        pending={review.isPending} error={review.error} onCancel={() => setTarget(null)}
        onConfirm={(reason) => target && review.mutate({ id: target.boost.id, decision: target.decision, reason }, { onSuccess: () => setTarget(null) })} />
    </>
  );
}
