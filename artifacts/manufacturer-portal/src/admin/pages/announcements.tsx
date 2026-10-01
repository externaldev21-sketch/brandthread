import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge, Chips, ConfirmAction, DataTable, ErrorLine, PageTitle } from "../ui";
import { useAdminMutation, useAdminQuery, when } from "../api";

interface Announcement {
  id: string; title: string; body: string; audience: string; sendPush: boolean; sendInApp: boolean; status: string;
  recipientCount: number; deliveredCount: number; createdAt: string;
}
type Audience = "all" | "sellers" | "buyers";

export default function AnnouncementsPage() {
  const [audience, setAudience] = useState<Audience>("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [push, setPush] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const { data: reach } = useAdminQuery<{ recipients: number }>(`/announcements/audience?audience=${audience}`);
  const { data: history, error } = useAdminQuery<{ items: Announcement[] }>("/announcements");
  const send = useAdminMutation<object>("POST", "/announcements", ["/announcements"]);
  const valid = title.trim() && body.trim() && (push || inApp);

  return (
    <>
      <PageTitle title="Announcements" />
      <div className="mb-6 space-y-3 rounded-lg border border-border bg-card p-4">
        <Chips value={audience} onChange={setAudience} options={[{ id: "all", label: "Everyone" }, { id: "sellers", label: "Sellers" }, { id: "buyers", label: "Buyers" }]} />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={80} />
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" maxLength={240} rows={3} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><Switch checked={push} onCheckedChange={setPush} /> Push notification</label>
          <label className="flex items-center gap-2"><Switch checked={inApp} onCheckedChange={setInApp} /> In-app Activity</label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{reach ? `Reaches ${reach.recipients.toLocaleString()} people` : ""}</span>
          <Button className="h-10 px-5" disabled={!valid} onClick={() => setConfirming(true)}>Send…</Button>
        </div>
      </div>
      <ErrorLine error={error} />
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sent</h2>
      <DataTable rows={history?.items} rowKey={(a) => a.id} empty="No announcements sent yet."
        columns={[
          { header: "Announcement", primary: true, cell: (a) => (<div><div className="font-medium">{a.title}</div><div className="text-xs text-muted-foreground">{a.body}</div></div>) },
          { header: "Audience", cell: (a) => <Badge tone="outline">{a.audience}</Badge> },
          { header: "Channels", cell: (a) => [a.sendPush && "Push", a.sendInApp && "In-app"].filter(Boolean).join(" + ") },
          { header: "Status", cell: (a) => <Badge tone={a.status === "failed" ? "danger" : a.status === "sent" ? "neutral" : "outline"}>{a.status}</Badge> },
          { header: "Reached", className: "tabular-nums", cell: (a) => a.recipientCount.toLocaleString() },
          { header: "Sent", cell: (a) => when(a.createdAt) },
        ]} />
      <ConfirmAction open={confirming} title="Send this announcement?" confirmLabel="Send now" pending={send.isPending} error={send.error}
        description={`"${title.trim()}" goes to ${audience === "all" ? "everyone" : audience} ${reach ? `(${reach.recipients.toLocaleString()} people) ` : ""}right away. It can't be recalled.`}
        onCancel={() => setConfirming(false)}
        onConfirm={() => send.mutate({ title, body, audience, sendPush: push, sendInApp: inApp }, { onSuccess: () => { setConfirming(false); setTitle(""); setBody(""); } })} />
    </>
  );
}
