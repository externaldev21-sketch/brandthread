import { useState } from "react";
import { Badge, DataTable, ErrorLine, PageTitle, Pager, SearchBox } from "../ui";
import { useAdminQuery, useQs, when } from "../api";

interface Entry { id: string; actor: { clerkId: string; email: string | null }; action: string; targetType: string | null; targetId: string | null; summary: string; createdAt: string }
const LIMIT = 50;

export default function AuditPage() {
  const qs = useQs();
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useAdminQuery<{ items: Entry[]; hasMore: boolean; total: number }>(`/audit${qs({ action, limit: LIMIT, offset })}`);
  return (
    <>
      <PageTitle title="Audit log" />
      <div className="mb-4"><SearchBox value={action} onChange={(v) => { setAction(v); setOffset(0); }} placeholder="Filter by action" /></div>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(e) => e.id} empty="No admin actions recorded yet."
        columns={[
          { header: "What happened", primary: true, cell: (e) => <span className="font-medium">{e.summary}</span> },
          { header: "Action", cell: (e) => <Badge tone="outline">{e.action}</Badge> },
          { header: "Admin", cell: (e) => <span className="text-muted-foreground">{e.actor.email ?? e.actor.clerkId}</span> },
          { header: "Target", cell: (e) => <span className="break-all font-mono text-xs text-muted-foreground">{e.targetType ? `${e.targetType}:${(e.targetId ?? "").slice(0, 14)}` : "—"}</span> },
          { header: "When", cell: (e) => when(e.createdAt) },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} total={data?.total} onChange={setOffset} />
    </>
  );
}
