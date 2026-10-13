import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ConfirmAction, ErrorLine, PageTitle } from "../ui";
import { useAdminMutation, useAdminQuery, when } from "../api";

/**
 * Live / Payments / AI kill switches. Layout follows DoorDash Merchant's
 * settings toggles: one row per switch (title, what it pauses, switch on the
 * right); turning one off asks first ("Turn off" dialog), turning it back on
 * doesn't.
 */

type Key = "liveEnabled" | "paymentsEnabled" | "aiEnabled";
interface SwitchRow { key: Key; label: string; enabled: boolean; updatedAt: string | null }

const DETAIL: Record<Key, { pauses: string; keeps: string }> = {
  liveEnabled: {
    pauses: "Going live, joining a live and live tips.",
    keeps: "Lives already running can still end, and replays stay up.",
  },
  paymentsEnabled: {
    pauses: "New checkouts in the app, guest checkout and gift card purchases.",
    keeps: "Webhooks, refunds, shipping and payouts keep working, so orders already paid settle normally.",
  },
  aiEnabled: {
    pauses: "Every AI tool: chat, captions, logos, mockups, photo shoots, background removal and the store builder.",
    keeps: "Buying AI credits and everything already made stay available.",
  },
};

export default function KillSwitchesPage() {
  const { data, error, isLoading } = useAdminQuery<{ switches: SwitchRow[] }>("/kill-switches");
  const [confirm, setConfirm] = useState<SwitchRow | null>(null);
  const toggle = useAdminMutation<{ key: Key; enabled: boolean; reason?: string }>(
    "POST", (b) => `/kill-switches/${b.key}`, ["/kill-switches", "/audit"],
  );
  const set = (row: SwitchRow, enabled: boolean, reason?: string) =>
    toggle.mutate({ key: row.key, enabled, reason }, { onSuccess: () => setConfirm(null) });

  return (
    <>
      <PageTitle title="Kill switches" />
      <ErrorLine error={error ?? (!confirm ? toggle.error : null)} />
      {isLoading && !data ? <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div> : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {data?.switches.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-4 px-4 py-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{row.label}{!row.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">Paused</span>}</div>
                <p className="mt-1 text-[13px] text-muted-foreground">{DETAIL[row.key].pauses}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{DETAIL[row.key].keeps}</p>
                {row.updatedAt && <p className="mt-1.5 text-xs text-muted-foreground">Changed {when(row.updatedAt)}</p>}
              </div>
              <Switch
                aria-label={`${row.label} ${row.enabled ? "on" : "paused"}`}
                checked={row.enabled}
                disabled={toggle.isPending}
                onCheckedChange={(on) => (on ? set(row, true) : setConfirm(row))}
                className="mt-0.5 shrink-0"
              />
            </div>
          ))}
        </div>
      )}
      <ConfirmAction
        open={!!confirm}
        title={confirm ? `Turn off ${confirm.label}?` : ""}
        description={confirm ? `This pauses it for everyone within a few seconds. ${DETAIL[confirm.key].keeps}` : ""}
        confirmLabel="Turn off"
        reasonLabel="Reason (shown in the audit log)"
        reasonRequired
        pending={toggle.isPending}
        error={confirm ? toggle.error : null}
        onCancel={() => { setConfirm(null); toggle.reset(); }}
        onConfirm={(reason) => confirm && set(confirm, false, reason)}
      />
    </>
  );
}
