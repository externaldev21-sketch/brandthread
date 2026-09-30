import { useState } from "react";
import { Badge, Chips, ConfirmAction, DataTable, ErrorLine, PageTitle, Pager, StatCards } from "../ui";
import { useModerationQuery, useModerationResolve, when } from "../api";

/**
 * Talks to the trust & safety API (/api/moderation) exactly as documented in
 * docs/admin-dashboard.md — this page owns no moderation logic of its own.
 */
interface Person { name?: string | null; displayName?: string | null; username?: string | null }
interface Report {
  id: string; status: string; source: string; targetType: string; targetLabel: string | null; contentExcerpt: string | null; reason: string;
  note: string | null; createdAt: string; owner: Person | null; openReportsOnTarget: number; ownerPriorActions: number;
  resolution: { action: string | null } | null;
}
interface Queue { items: Report[]; hasMore: boolean; summary: { open: number; heldByFilter: number; resolvedToday: number } }
const LIMIT = 25;
const who = (p: Person | null) => (p ? p.displayName || p.name || (p.username ? `@${p.username}` : "Unknown") : "Unknown");
const ACTIONS = [
  { id: "dismiss", label: "Dismiss", title: "Dismiss this report?", body: "The content stays up (or is released if the filter held it).", destructive: false },
  { id: "remove_content", label: "Remove content", title: "Remove this content?", body: "It's taken down for everyone. The owner's account is untouched.", destructive: true },
  { id: "suspend_user", label: "Suspend owner", title: "Suspend the content owner?", body: "They're signed out everywhere and their content is hidden. Reinstate them any time from Users.", destructive: true },
] as const;

export default function ModerationPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useModerationQuery<Queue>(`/reports?status=${status}&limit=${LIMIT}&offset=${offset}`);
  const resolve = useModerationResolve();
  const [pending, setPending] = useState<{ report: Report; action: typeof ACTIONS[number] } | null>(null);

  return (
    <>
      <PageTitle title="Moderation" />
      {data && <StatCards items={[
        { label: "Open reports", value: String(data.summary.open) },
        { label: "Held by filter", value: String(data.summary.heldByFilter) },
        { label: "Resolved today", value: String(data.summary.resolvedToday) },
      ]} />}
      <div className="mb-4"><Chips value={status} onChange={(s) => { setStatus(s); setOffset(0); }} options={[{ id: "open", label: "Open" }, { id: "resolved", label: "Resolved" }]} /></div>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(r) => r.id} empty={status === "open" ? "The queue is clear." : "Nothing resolved yet."}
        columns={[
          { header: "Reported", primary: true, cell: (r) => (
            <div className="max-w-md">
              <div className="font-medium capitalize">{r.targetType}{r.targetLabel ? ` · ${r.targetLabel}` : ""}</div>
              {r.contentExcerpt && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.contentExcerpt}</div>}
            </div>) },
          { header: "Reason", cell: (r) => <span className="capitalize">{r.reason.replaceAll("_", " ")}{r.source === "auto_filter" ? " · filter" : ""}</span> },
          { header: "Owner", cell: (r) => who(r.owner) },
          { header: "Signals", cell: (r) => <span className="text-xs text-muted-foreground">{r.openReportsOnTarget} open · {r.ownerPriorActions} prior actions</span> },
          { header: "Reported at", cell: (r) => when(r.createdAt) },
          { header: status === "open" ? "Action" : "Outcome", cell: (r) => r.resolution
            ? <Badge>{(r.resolution.action ?? r.status).replaceAll("_", " ")}</Badge>
            : <div className="flex flex-wrap justify-end gap-1.5">
                {ACTIONS.map((a) => (
                  <button key={a.id} onClick={(e) => { e.stopPropagation(); setPending({ report: r, action: a }); }}
                    className="rounded border border-border px-2 py-1 text-xs hover:border-foreground">{a.label}</button>
                ))}
              </div> },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} onChange={setOffset} />
      <ConfirmAction open={!!pending} title={pending?.action.title ?? ""} description={pending?.action.body ?? ""} confirmLabel={pending?.action.label ?? ""}
        destructive={pending?.action.destructive} reasonLabel="Note (optional)" pending={resolve.isPending} error={resolve.error}
        onCancel={() => setPending(null)}
        onConfirm={(note) => pending && resolve.mutate({ id: pending.report.id, action: pending.action.id, note }, { onSuccess: () => setPending(null) })} />
    </>
  );
}
