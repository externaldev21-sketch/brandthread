import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, DataTable, ErrorLine, PageTitle } from "../ui";
import { useAdminMutation, useAdminQuery, when } from "../api";

interface Invite { id: string; code: string; label: string | null; maxUses: number | null; uses: number; expiresAt: string | null; status: string; createdAt: string }

export default function InvitesPage() {
  const { data, error, isLoading } = useAdminQuery<{ items: Invite[] }>("/invites");
  const create = useAdminMutation<{ label?: string; maxUses?: number; count: number; expiresAt?: string }, { codes: string[] }>("POST", "/invites", ["/invites"]);
  const disable = useAdminMutation<{ id: string }>("POST", (b) => `/invites/${b.id}/disable`, ["/invites"]);
  const enable = useAdminMutation<{ id: string }>("POST", (b) => `/invites/${b.id}/enable`, ["/invites"]);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [count, setCount] = useState("1");
  const [expires, setExpires] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);
  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <>
      <PageTitle title="Invite codes" />
      <form className="mb-6 space-y-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ label: label.trim() || undefined, maxUses: maxUses ? Number(maxUses) : undefined, count: Number(count) || 1, expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : undefined },
            { onSuccess: (r) => setFresh(r.codes) });
        }}>
        <div className="grid gap-2 md:grid-cols-4">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Press)" maxLength={80} />
          <Input value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} placeholder="Max uses (blank = unlimited)" inputMode="numeric" />
          <Input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} placeholder="How many codes" inputMode="numeric" aria-label="How many codes" />
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expires" min={new Date().toISOString().slice(0, 10)} />
        </div>
        <ErrorLine error={create.error} />
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Generating…" : "Generate"}</Button>
        {fresh.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {fresh.map((c) => (
              <button type="button" key={c} onClick={() => copy(c)} className="flex items-center gap-1.5 rounded border border-foreground px-2.5 py-1 font-mono text-sm tracking-wider">
                {c}<Copy className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </form>
      <ErrorLine error={error || disable.error || enable.error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(c) => c.id} empty="No invite codes yet."
        columns={[
          { header: "Code", primary: true, cell: (c) => <span className="font-mono tracking-wider">{c.code}</span> },
          { header: "Label", cell: (c) => c.label ?? "—" },
          { header: "Used", className: "tabular-nums", cell: (c) => `${c.uses}${c.maxUses ? ` / ${c.maxUses}` : ""}` },
          { header: "Expires", cell: (c) => (c.expiresAt ? when(c.expiresAt) : "Never") },
          { header: "Status", cell: (c) => <Badge tone={c.status === "active" ? "solid" : "neutral"}>{c.status}</Badge> },
          { header: "", className: "text-right", cell: (c) => (
            <button className="rounded border border-border px-2 py-1 text-xs hover:border-foreground"
              onClick={() => (c.status === "disabled" ? enable : disable).mutate({ id: c.id })}>{c.status === "disabled" ? "Enable" : "Disable"}</button>) },
        ]} />
    </>
  );
}
