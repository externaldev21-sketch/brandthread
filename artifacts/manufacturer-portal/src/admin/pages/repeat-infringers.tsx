import { useState } from "react";
import { Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ActionButton, ActionGroup, Badge, ConfirmAction, DataTable, ErrorLine, PageTitle, StatCards } from "../ui";
import { useAdminMutation, useAdminQuery, when } from "../api";

/**
 * Sellers with IP takedown strikes (one per taken-down case) and the
 * repeat-infringer flag set once they reach the threshold. Clearing the flag
 * (optionally resetting strikes) is the only action the server supports;
 * suspending goes through Users. Backed by /api/admin/repeat-infringers.
 */
interface IpCase {
  id: string; reference: string; status: string; rightsType: string; listingName: string | null; createdAt: string;
  takedownAt: string | null; strike: boolean; counterNoticeStatus: string;
}
interface Seller {
  userId: string; name: string; brandName: string | null; username: string | null; ipStrikeCount: number; ipRepeatInfringer: boolean;
  ipRepeatInfringerFlaggedAt: string | null; suspendedAt: string | null; cases: IpCase[];
}
interface Data { threshold: number; sellers: Seller[] }
type Pending = { seller: Seller; resetStrikes: boolean };
const label = (s: Seller) => s.brandName || s.name || s.userId;

export default function RepeatInfringersPage() {
  const { data, error, isLoading } = useAdminQuery<Data>("/repeat-infringers");
  const clear = useAdminMutation<Pending>("POST", (b) => `/repeat-infringers/${encodeURIComponent(b.seller.userId)}/clear`, ["/repeat-infringers"]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState<Seller | null>(null);
  const flagged = data?.sellers.filter((s) => s.ipRepeatInfringer).length ?? 0;

  return (
    <>
      <PageTitle title="Repeat infringers" action={<Link href="/moderation/ip-cases" className="text-sm underline">IP case queue</Link>} />
      {data && <StatCards items={[
        { label: "Flagged", value: String(flagged) },
        { label: "Sellers with strikes", value: String(data.sellers.length) },
        { label: "Strikes to flag", value: String(data.threshold) },
      ]} />}
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.sellers} rowKey={(s) => s.userId} onRowClick={setOpen} empty="No seller has an IP strike."
        columns={[
          { header: "Seller", primary: true, cell: (s) => (
            <div><div className="font-medium">{label(s)}</div>{s.username && <div className="text-xs text-muted-foreground">@{s.username}</div>}</div>) },
          { header: "Strikes", cell: (s) => <span className="tabular-nums">{s.ipStrikeCount} / {data?.threshold ?? "—"}</span> },
          { header: "Status", cell: (s) => (
            <span className="inline-flex gap-1">
              {s.ipRepeatInfringer ? <Badge tone="danger">repeat infringer</Badge> : <Badge>strikes only</Badge>}
              {s.suspendedAt && <Badge tone="solid">suspended</Badge>}
            </span>) },
          { header: "Flagged", cell: (s) => when(s.ipRepeatInfringerFlaggedAt) },
          { header: "Cases", cell: (s) => <span className="text-xs text-muted-foreground">{s.cases.length} case{s.cases.length === 1 ? "" : "s"}</span> },
          { header: "Action", cell: (s) => (
            <ActionGroup>
              <ActionButton disabled={!s.ipRepeatInfringer} onClick={(e) => { e.stopPropagation(); clear.reset(); setPending({ seller: s, resetStrikes: false }); }}>Clear flag</ActionButton>
              <ActionButton disabled={s.ipStrikeCount === 0} onClick={(e) => { e.stopPropagation(); clear.reset(); setPending({ seller: s, resetStrikes: true }); }}>Reset strikes</ActionButton>
            </ActionGroup>) },
        ]} />
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="admin-theme w-full overflow-y-auto border-border bg-background sm:max-w-lg">
          <SheetHeader className="mb-4 text-left"><SheetTitle>{open ? label(open) : ""}</SheetTitle></SheetHeader>
          {open && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{open.ipStrikeCount} strike{open.ipStrikeCount === 1 ? "" : "s"} · {open.cases.length} IP case{open.cases.length === 1 ? "" : "s"}</p>
              {open.cases.length === 0 && <p className="text-sm text-muted-foreground">No linked cases.</p>}
              {open.cases.map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.reference}</span>
                    <Badge tone={c.status === "actioned" ? "solid" : "outline"}>{c.status.replaceAll("_", " ")}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {c.rightsType}{c.listingName ? ` · ${c.listingName}` : ""} · opened {when(c.createdAt)}
                    {c.takedownAt ? ` · taken down ${when(c.takedownAt)}` : ""}
                  </div>
                  <div className="mt-1 flex gap-1">
                    {c.strike && <Badge tone="danger">strike</Badge>}
                    {c.counterNoticeStatus !== "none" && <Badge>counter-notice {c.counterNoticeStatus}</Badge>}
                  </div>
                </div>
              ))}
            </div>)}
        </SheetContent>
      </Sheet>
      <ConfirmAction open={!!pending}
        title={pending?.resetStrikes ? `Reset strikes for ${label(pending.seller)}?` : `Clear the repeat-infringer flag for ${pending ? label(pending.seller) : ""}?`}
        description={pending?.resetStrikes
          ? "Their strike count goes back to 0 and the flag is cleared. Cases stay on record. A new takedown starts counting again."
          : "The flag is cleared but strikes are kept, so the next takedown can flag them again."}
        confirmLabel={pending?.resetStrikes ? "Reset strikes" : "Clear flag"}
        pending={clear.isPending} error={clear.error} onCancel={() => setPending(null)}
        onConfirm={() => pending && clear.mutate(pending, { onSuccess: () => { setPending(null); setOpen(null); } })} />
    </>
  );
}
