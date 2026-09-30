import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Chips, ConfirmAction, DataTable, ErrorLine, PageTitle } from "../ui";
import { useAdminMutation, useAdminQuery } from "../api";

interface Featured {
  id: string; kind: "brand" | "thread"; targetId: string; label: string | null; position: number; active: boolean;
  target: { title: string; subtitle: string | null; missing: boolean };
}

export default function FeaturedPage() {
  const { data, error, isLoading } = useAdminQuery<{ items: Featured[] }>("/featured");
  const add = useAdminMutation<{ kind: string; targetId: string; label?: string; position?: number }>("POST", "/featured", ["/featured"]);
  const patch = useAdminMutation<{ id: string; active: boolean }>("PATCH", (b) => `/featured/${b.id}`, ["/featured"]);
  const remove = useAdminMutation<{ id: string }>("DELETE", (b) => `/featured/${b.id}`, ["/featured"]);
  const [kind, setKind] = useState<"brand" | "thread">("brand");
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState<Featured | null>(null);

  return (
    <>
      <PageTitle title="Featured on Discover" />
      <form className="mb-6 space-y-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => { e.preventDefault(); add.mutate({ kind, targetId: targetId.trim(), label: label.trim() || undefined }, { onSuccess: () => { setTargetId(""); setLabel(""); } }); }}>
        <Chips value={kind} onChange={setKind} options={[{ id: "brand", label: "Brand" }, { id: "thread", label: "Thread" }]} />
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder={kind === "brand" ? "Brand's user ID (from Users)" : "Thread ID"} required />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" maxLength={120} />
          <Button type="submit" disabled={add.isPending || !targetId.trim()}>{add.isPending ? "Adding…" : "Feature"}</Button>
        </div>
        <ErrorLine error={add.error} />
      </form>
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(f) => f.id} empty="Nothing is featured yet."
        columns={[
          { header: "Item", primary: true, cell: (f) => (<div><div className="font-medium">{f.target.title}</div>{f.target.subtitle && <div className="text-xs text-muted-foreground">{f.target.subtitle}</div>}</div>) },
          { header: "Type", cell: (f) => <Badge tone="outline">{f.kind}</Badge> },
          { header: "Label", cell: (f) => f.label ?? "—" },
          { header: "Status", cell: (f) => f.target.missing ? <Badge tone="danger">Unavailable</Badge> : f.active ? <Badge tone="solid">Live</Badge> : <Badge>Hidden</Badge> },
          { header: "", className: "text-right", cell: (f) => (
            <div className="flex justify-end gap-1.5">
              <button className="rounded border border-border px-2 py-1 text-xs hover:border-foreground" onClick={() => patch.mutate({ id: f.id, active: !f.active })}>{f.active ? "Hide" : "Show"}</button>
              <button className="rounded border border-border px-2 py-1 text-xs hover:border-foreground" onClick={() => setRemoving(f)}>Remove</button>
            </div>) },
        ]} />
      <ConfirmAction open={!!removing} title="Remove from Discover?" description="It stops being featured. The brand or thread itself isn't affected." confirmLabel="Remove"
        pending={remove.isPending} error={remove.error} onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate({ id: removing.id }, { onSuccess: () => setRemoving(null) })} />
    </>
  );
}
