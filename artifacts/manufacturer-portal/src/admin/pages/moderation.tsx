import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionButton, ActionGroup, Badge, Chips, ConfirmAction, DataTable, ErrorLine, PageTitle, Pager, StatCards } from "../ui";
import { useModerationPost, useModerationQuery, useModerationResolve, when } from "../api";

/**
 * Talks to the trust & safety API (/api/moderation) exactly as documented in
 * docs/admin-dashboard.md — this page owns no moderation logic of its own.
 * The queue follows Reddit's mod queue: oldest first, a content-type filter,
 * and each item opens a side panel with the content, the person behind it
 * and every action (each asks for a reason, kept in the audit log).
 */
interface Person { name?: string | null; displayName?: string | null; username?: string | null }
interface Report {
  id: string; status: string; source: string; targetType: string; targetLabel: string | null; contentExcerpt: string | null; reason: string;
  note: string | null; createdAt: string; dueBy?: string; overdue?: boolean; owner: Person | null; reporter?: Person | null;
  openReportsOnTarget: number; ownerPriorActions: number; resolution: { action: string | null } | null;
}
interface Queue { items: Report[]; hasMore: boolean; summary: { open: number; heldByFilter: number; resolvedToday: number; overdue?: number } }
interface Context { messages: { id: string; reported: boolean; sender: string; isOwner: boolean; body: string; createdAt: string }[] | null }
const LIMIT = 25;
const who = (p: Person | null | undefined) => (p ? p.displayName || p.name || (p.username ? `@${p.username}` : "Unknown") : "Unknown");
const ACTIONS = [
  { id: "dismiss", label: "Dismiss", title: "Dismiss this report?", body: "The content stays up (or is released if the filter held it).", destructive: false },
  { id: "remove_content", label: "Remove", title: "Remove this content?", body: "It's taken down for everyone. The owner's account is untouched.", destructive: true },
  { id: "suspend_user", label: "Suspend", title: "Suspend the content owner?", body: "They're signed out everywhere and their content is hidden. Reinstate them any time from Users.", destructive: true },
] as const;
const TYPES = [
  { id: "all", label: "All types" }, { id: "post", label: "Posts" }, { id: "comment", label: "Comments" }, { id: "profile", label: "Users" },
  { id: "message", label: "DMs" }, { id: "product", label: "Products" }, { id: "live", label: "Lives" }, { id: "story", label: "Stories" },
  { id: "review", label: "Reviews" }, { id: "community", label: "Communities" },
];
const typeLabel = (t: string) => (t === "message" ? "DM" : t === "profile" ? "user" : t.replaceAll("_", " "));

function hoursLeft(dueBy?: string) {
  if (!dueBy) return null;
  return Math.round((new Date(dueBy).getTime() - Date.now()) / 3_600_000);
}
function SlaBadge({ r }: { r: Report }) {
  if (r.status !== "pending") return <span className="text-muted-foreground">—</span>;
  const h = hoursLeft(r.dueBy);
  if (r.overdue || (h != null && h < 0)) return <Badge tone="danger">Overdue</Badge>;
  return <Badge tone="outline">{h == null ? "Open" : `${Math.max(h, 0)}h`}</Badge>;
}

export default function ModerationPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [type, setType] = useState("all");
  const [offset, setOffset] = useState(0);
  const typeQs = type === "all" ? "" : `&type=${type}`;
  const { data, error, isLoading } = useModerationQuery<Queue>(`/reports?status=${status}${typeQs}&limit=${LIMIT}&offset=${offset}`);
  const resolve = useModerationResolve();
  const bulk = useModerationPost<{ ids: string[]; note: string }>();
  const [pending, setPending] = useState<{ report: Report; action: typeof ACTIONS[number] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [openReport, setOpenReport] = useState<Report | null>(null);
  useEffect(() => setSelected(new Set()), [status, type, offset]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPage = (data?.items ?? []).filter((r) => r.status === "pending").map((r) => r.id);

  return (
    <>
      <PageTitle title="Moderation" />
      {data && <StatCards items={[
        { label: "Open reports", value: String(data.summary.open) },
        { label: "Over 24 hours", value: String(data.summary.overdue ?? 0) },
        { label: "Held by filter", value: String(data.summary.heldByFilter) },
        { label: "Resolved today", value: String(data.summary.resolvedToday) },
      ]} />}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Chips value={status} onChange={(s) => { setStatus(s); setOffset(0); }} options={[{ id: "open", label: "Open" }, { id: "resolved", label: "Resolved" }]} />
        <Select value={type} onValueChange={(t) => { setType(t); setOffset(0); }}>
          <SelectTrigger className="h-9 w-full md:w-44" aria-label="Content type"><SelectValue /></SelectTrigger>
          <SelectContent className="admin-theme border-border bg-popover">{TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {status === "open" && selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm">
          <span>{selected.size} selected</span>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button className="h-8 px-3 text-xs" onClick={() => setBulkOpen(true)}>Dismiss selected</Button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(r) => r.id} onRowClick={setOpenReport} empty={status === "open" ? "The queue is clear." : "Nothing resolved yet."}
        columns={[
          ...(status === "open" ? [{
            header: "", className: "w-8 pr-0", cell: (r: Report) => (
              <input type="checkbox" aria-label="Select report" className="h-4 w-4 accent-foreground" checked={selected.has(r.id)}
                onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} />) }] : []),
          { header: "Reported", primary: true, cell: (r) => (
            <div className="max-w-md">
              <div className="font-medium capitalize">{typeLabel(r.targetType)}{r.targetLabel ? ` · ${r.targetLabel}` : ""}</div>
              {r.contentExcerpt && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.contentExcerpt}</div>}
            </div>) },
          { header: "Reason", cell: (r) => <span className="capitalize">{r.reason.replaceAll("_", " ")}{r.source === "auto_filter" ? " · filter" : ""}</span> },
          { header: "Owner", cell: (r) => who(r.owner) },
          { header: "Signals", cell: (r) => <span className="text-xs text-muted-foreground">{r.openReportsOnTarget} open · {r.ownerPriorActions} prior actions</span> },
          { header: "Reported at", cell: (r) => when(r.createdAt) },
          { header: "Due", className: "whitespace-nowrap", cell: (r) => <SlaBadge r={r} /> },
          { header: status === "open" ? "Action" : "Outcome", className: status === "open" ? "md:min-w-[16.5rem]" : undefined, cell: (r) => r.resolution
            ? <Badge>{(r.resolution.action ?? r.status).replaceAll("_", " ")}</Badge>
            : <ActionGroup>
                {ACTIONS.map((a) => (
                  <ActionButton key={a.id} onClick={(e) => { e.stopPropagation(); setPending({ report: r, action: a }); }}>{a.label}</ActionButton>
                ))}
              </ActionGroup> },
        ]} />
      {status === "open" && allOnPage.length > 0 && (
        <button className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          onClick={() => setSelected(selected.size === allOnPage.length ? new Set() : new Set(allOnPage))}>
          {selected.size === allOnPage.length ? "Clear selection" : "Select all on this page"}
        </button>
      )}
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} onChange={setOffset} />
      <ConfirmAction open={!!pending} title={pending?.action.title ?? ""} description={pending?.action.body ?? ""} confirmLabel={pending?.action.id === "suspend_user" ? "Suspend owner" : pending?.action.id === "remove_content" ? "Remove content" : "Dismiss"}
        destructive={pending?.action.destructive} reasonLabel="Note (optional)" pending={resolve.isPending} error={resolve.error}
        onCancel={() => setPending(null)}
        onConfirm={(note) => pending && resolve.mutate({ id: pending.report.id, action: pending.action.id, note }, { onSuccess: () => setPending(null) })} />
      <ConfirmAction open={bulkOpen} title={`Dismiss ${selected.size} report${selected.size === 1 ? "" : "s"}?`}
        description="The content stays up (or is released if the filter held it). Every other open report on the same items closes too."
        confirmLabel="Dismiss" reasonLabel="Note (optional)" pending={bulk.isPending} error={bulk.error}
        onCancel={() => setBulkOpen(false)}
        onConfirm={(note) => bulk.mutate({ path: "/reports/bulk-dismiss", body: { ids: [...selected], note } }, { onSuccess: () => { setBulkOpen(false); setSelected(new Set()); } })} />
      <ReportSheet report={openReport} onClose={() => setOpenReport(null)} />
    </>
  );
}

const SHEET_ACTIONS = [
  { id: "dismiss", label: "Dismiss", title: "Dismiss this report?", body: "The content stays up (or is released if the filter held it).", reason: "Note (optional)", required: false, destructive: false },
  { id: "remove_content", label: "Remove content", title: "Remove this content?", body: "It's taken down for everyone. The owner's account is untouched.", reason: "Removal reason (kept in the audit log)", required: true, destructive: true },
  { id: "warn", label: "Warn", title: "Warn the owner?", body: "They get an in-app and push warning. Their content and account stay as they are.", reason: "Message to the user", required: true, destructive: false },
  { id: "suspend_user", label: "Suspend", title: "Suspend the owner?", body: "They're signed out everywhere and their content is hidden until the suspension ends or you reinstate them.", reason: "Reason (kept in the audit log)", required: true, destructive: true },
  { id: "ban", label: "Ban", title: "Ban the owner permanently?", body: "Their account is closed to them for good and their content is hidden. Nothing is deleted.", reason: "Reason (kept in the audit log)", required: true, destructive: true },
] as const;
const DURATIONS = [{ id: "1", label: "1 day" }, { id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "permanent", label: "No end date" }];

function ReportSheet({ report, onClose }: { report: Report | null; onClose: () => void }) {
  const isDm = report?.targetType === "message";
  const { data: ctx } = useModerationQuery<Context>(`/reports/${report?.id}/context`, !!report && isDm);
  const act = useModerationPost<{ action: string; note: string; durationDays?: number }>();
  const [pending, setPending] = useState<typeof SHEET_ACTIONS[number] | null>(null);
  const [days, setDays] = useState("7");
  const row = (k: string, v: string) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{k}</span><span className="text-right">{v}</span>
    </div>
  );
  const open = report?.status === "pending";
  return (
    <Sheet open={!!report} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-border bg-popover sm:max-w-md">
        <SheetHeader><SheetTitle className="capitalize">{report ? `${typeLabel(report.targetType)} report` : ""}</SheetTitle></SheetHeader>
        {report && (
          <div className="px-4 pb-6">
            <div className="mb-4 flex flex-wrap gap-1.5">
              <SlaBadge r={report} />
              <Badge>{report.reason.replaceAll("_", " ")}</Badge>
              {report.source === "auto_filter" && <Badge tone="outline">Held by filter</Badge>}
            </div>
            {isDm && ctx?.messages ? (
              <div className="mb-4 space-y-1.5 rounded-lg border border-border bg-card p-3">
                {ctx.messages.map((m) => (
                  <div key={m.id} className={m.reported ? "rounded-md border border-foreground/60 px-2.5 py-2" : "px-2.5 py-1"}>
                    <div className="text-[11px] text-muted-foreground">{m.sender} · {when(m.createdAt)}{m.reported ? " · reported" : ""}</div>
                    <div className={m.reported ? "text-sm" : "text-sm text-muted-foreground"}>{m.body}</div>
                  </div>
                ))}
              </div>
            ) : report.contentExcerpt ? (
              <p className="mb-4 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm">{report.contentExcerpt}</p>
            ) : null}
            {report.targetLabel && row("Item", report.targetLabel)}
            {row("Owner", who(report.owner))}
            {report.reporter !== undefined && row("Reported by", report.reporter ? who(report.reporter) : "Content filter")}
            {report.note && row("Reporter's note", report.note)}
            {row("Reported", when(report.createdAt))}
            {row("Open reports on this item", String(report.openReportsOnTarget))}
            {row("Owner's prior actions", String(report.ownerPriorActions))}
            {open ? (
              <div className="mt-5 grid grid-cols-2 gap-2">
                {SHEET_ACTIONS.map((a) => (
                  <Button key={a.id} variant={a.id === "ban" ? "destructive" : "outline"} className={a.id === "ban" ? "col-span-2 h-10 px-3" : "h-10 px-3"}
                    onClick={() => setPending(a)}>{a.label}</Button>
                ))}
              </div>
            ) : (
              <div className="mt-4">{row("Outcome", (report.resolution?.action ?? report.status).replaceAll("_", " "))}</div>
            )}
          </div>
        )}
        <ConfirmAction open={!!pending} title={pending?.title ?? ""} confirmLabel={pending?.label ?? ""}
          description={pending?.body ?? ""}
          destructive={pending?.destructive} reasonLabel={pending?.reason} reasonRequired={pending?.required}
          pending={act.isPending} error={act.error}
          onCancel={() => setPending(null)}
          onConfirm={(note) => report && pending && act.mutate(
            { path: `/reports/${report.id}/resolve`, body: { action: pending.id, note, ...(pending.id === "suspend_user" && days !== "permanent" ? { durationDays: Number(days) } : {}) } },
            { onSuccess: () => { setPending(null); onClose(); } })}>
          {pending?.id === "suspend_user" && <SuspendLength value={days} onChange={setDays} />}
        </ConfirmAction>
      </SheetContent>
    </Sheet>
  );
}

/** Suspension length (Reddit's ban-length step), inside the confirm dialog. */
function SuspendLength({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">Suspend for</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DURATIONS.map((d) => (
          <button key={d.id} onClick={() => onChange(d.id)}
            className={value === d.id ? "h-9 rounded-full border border-foreground bg-foreground px-2 text-xs font-medium text-background" : "h-9 rounded-full border border-border px-2 text-xs text-muted-foreground"}>
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}
