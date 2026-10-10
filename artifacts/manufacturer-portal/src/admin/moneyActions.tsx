/**
 * Shared admin money actions, modelled on Stripe Dashboard's flows:
 *  - Order sheet: payment breakdown + "Refund" (Stripe "Refunding a payment":
 *    amount, reason, details, then "Refund $X").
 *  - Dispute sheet: evidence list, add text / file evidence as a draft, then
 *    one "Submit evidence" confirm (Stripe allows a single submission).
 *  - Hold / release payouts confirm, used from Risk and Payout review.
 * Every action is audited server-side; money actions are idempotent.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { errorMessage, useApiRequest } from "@/lib/api";
import { Badge, ConfirmAction, ErrorLine } from "./ui";
import { money, useAdminMutation, useAdminQuery, when } from "./api";

const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
const label = (s: string) => { const t = s.replaceAll("_", " "); return t.charAt(0).toUpperCase() + t.slice(1); };

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

// ─── Orders + refunds ────────────────────────────────────────────────────────

interface OrderDetail {
  id: string; orderNumber: string; status: string; totalCents: number; subtotalCents: number; shippingCents: number; taxCents: number;
  platformFeeCents: number; platformFeeRefundedCents: number; refundedCents: number; sellerNetCents: number; threadCashAppliedCents: number;
  refundableCents: number; riskLevel: string | null; riskScore: number | null; riskFlags: { code: string; label: string; severity: string }[];
  seller: { clerkId: string | null; name: string | null }; buyer: { clerkId: string | null; name: string | null };
  paidAt: string | null; createdAt: string; items: { id: string; name: string; quantity: number; priceCents: number }[];
  disputes: { id: string; status: string; reason: string | null; amountCents: number }[];
}

export function RiskBadge({ level }: { level: string | null | undefined }) {
  if (!level || level === "normal") return <Badge tone="outline">Normal</Badge>;
  return <Badge tone={level === "highest" ? "danger" : "neutral"}>{level}</Badge>;
}

export function OrderSheet({ orderId, onClose, onOpenDispute }: { orderId: string | null; onClose: () => void; onOpenDispute?: (id: string) => void }) {
  const { data: o, error } = useAdminQuery<OrderDetail>(`/orders/${orderId}`, !!orderId);
  const [refunding, setRefunding] = useState(false);
  return (
    <Sheet open={!!orderId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-border bg-popover sm:max-w-md">
        <SheetHeader><SheetTitle>{o ? `#${o.orderNumber}` : "Loading…"}</SheetTitle></SheetHeader>
        <div className="px-4 pb-6">
          <ErrorLine error={error} />
          {o && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{label(o.status)}</Badge>
                  {o.refundedCents > 0 && <Badge tone="outline">{o.refundedCents >= o.totalCents ? "Refunded" : "Partial refund"}</Badge>}
                  <RiskBadge level={o.riskLevel} />
                </div>
                <Button variant="outline" className="h-9 px-3" disabled={o.refundableCents <= 0} onClick={() => setRefunding(true)}>Refund</Button>
              </div>
              <div className="text-2xl font-semibold tabular-nums">{money(o.totalCents)}</div>
              <div className="mb-2 text-sm text-muted-foreground">{o.buyer.name ?? "Guest"} · from {o.seller.name ?? "—"}</div>
              <SectionTitle>Payment breakdown</SectionTitle>
              <Row k="Items" v={money(o.subtotalCents)} />
              <Row k="Shipping" v={money(o.shippingCents)} />
              <Row k="Tax" v={money(o.taxCents)} />
              {o.threadCashAppliedCents > 0 && <Row k="Thread Cash" v={`−${money(o.threadCashAppliedCents)}`} />}
              <Row k="Platform fee" v={money(o.platformFeeCents - o.platformFeeRefundedCents)} />
              <Row k="Seller net" v={money(o.sellerNetCents)} />
              {o.refundedCents > 0 && <Row k="Refunded" v={`−${money(o.refundedCents)}`} />}
              <Row k="Paid" v={when(o.paidAt)} />
              {o.riskFlags.length > 0 && (
                <>
                  <SectionTitle>Risk</SectionTitle>
                  {o.riskScore != null && <Row k="Radar score" v={o.riskScore} />}
                  <ul className="mt-1 space-y-1 text-sm">{o.riskFlags.map((f) => <li key={f.code} className="flex gap-2"><span aria-hidden>•</span>{f.label}</li>)}</ul>
                </>
              )}
              <SectionTitle>Items</SectionTitle>
              {o.items.map((i) => <Row key={i.id} k={`${i.quantity} × ${i.name}`} v={money(i.priceCents * i.quantity)} />)}
              {o.disputes.length > 0 && (
                <>
                  <SectionTitle>Disputes</SectionTitle>
                  {o.disputes.map((d) => (
                    <button key={d.id} className="w-full text-left" onClick={() => onOpenDispute?.(d.id)}>
                      <Row k={label(d.reason ?? "dispute")} v={<span className="flex items-center gap-2">{money(d.amountCents)} <Badge>{label(d.status)}</Badge></span>} />
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        {o && <RefundDialog open={refunding} order={o} onClose={() => setRefunding(false)} />}
      </SheetContent>
    </Sheet>
  );
}

const REFUND_REASONS = [
  { id: "requested_by_buyer", label: "Requested by buyer" },
  { id: "not_delivered", label: "Not delivered" },
  { id: "seller_cancelled", label: "Cancelled by seller" },
  { id: "return_approved", label: "Return approved" },
];

function RefundDialog({ open, order, onClose }: { open: boolean; order: OrderDetail; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("requested_by_buyer");
  const [note, setNote] = useState("");
  const [key, setKey] = useState(newKey);
  useEffect(() => {
    if (open) { setAmount((order.refundableCents / 100).toFixed(2)); setReason("requested_by_buyer"); setNote(""); setKey(newKey()); }
  }, [open, order.refundableCents]);
  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(cents) && cents > 0 && cents <= order.refundableCents;
  const refund = useAdminMutation<{ amountCents: number; reason: string; note: string; idempotencyKey: string }>(
    "POST", `/orders/${order.id}/refund`, ["/orders", "/refunds", "/revenue"]);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="border-border bg-popover">
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle>Refund payment</AlertDialogTitle>
          <AlertDialogDescription>Refunds take 5–10 days to appear on the buyer's statement. The seller's share is reversed and any Thread Cash is returned.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid grid-cols-[6rem_1fr] items-center gap-3 text-sm">
          <label htmlFor="refund-amount" className="text-muted-foreground">Refund</label>
          <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="h-9 tabular-nums" />
          <span className="text-muted-foreground">Reason</span>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="admin-theme border-border bg-popover">
              {REFUND_REASONS.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add more details about this refund" maxLength={500} rows={3} />
        {!valid && amount !== "" && <p className="text-sm text-destructive">Enter up to {money(order.refundableCents)}.</p>}
        {refund.error ? <p className="text-sm text-destructive">{errorMessage(refund.error)}</p> : null}
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
          <AlertDialogCancel onClick={onClose} className="mt-0 h-10 w-full px-3">Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!valid || refund.isPending} className="h-10 w-full px-3"
            onClick={(e) => { e.preventDefault(); refund.mutate({ amountCents: cents, reason, note, idempotencyKey: key }, { onSuccess: onClose }); }}>
            {refund.isPending ? "Working…" : `Refund ${valid ? money(cents) : ""}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Disputes + evidence ─────────────────────────────────────────────────────

interface DisputeDetail {
  id: string; orderId: string | null; orderNumber: string | null; amountCents: number; reason: string | null; status: string; customerClaim: string;
  evidenceDueBy: string | null; evidenceSubmittedAt: string | null; canAddEvidence: boolean;
  evidence: { id: string; type: string; description: string; submittedAt: string }[];
  files: { id: string; evidenceType: string; fileName: string }[];
}

const TEXT_TYPES = [
  { id: "written_response", label: "Written response" },
  { id: "policy", label: "Refund policy" },
  { id: "other", label: "Other" },
];
const FILE_TYPES = [
  { id: "receipt", label: "Receipt" },
  { id: "shipping_documentation", label: "Proof of shipping" },
  { id: "customer_communication", label: "Customer messages" },
  { id: "customer_signature", label: "Delivery signature" },
  { id: "refund_policy", label: "Refund policy" },
  { id: "uncategorized_file", label: "Other file" },
];

export function DisputeSheet({ disputeId, onClose }: { disputeId: string | null; onClose: () => void }) {
  const { data: d, error } = useAdminQuery<DisputeDetail>(`/disputes/${disputeId}`, !!disputeId);
  const refresh = ["/disputes"];
  const addText = useAdminMutation<{ type: string; description: string }>("POST", `/disputes/${disputeId}/evidence`, refresh);
  const submit = useAdminMutation<object>("POST", `/disputes/${disputeId}/submit`, refresh);
  const [type, setType] = useState("written_response");
  const [text, setText] = useState("");
  const [fileType, setFileType] = useState("receipt");
  const [confirming, setConfirming] = useState(false);
  const request = useApiRequest();
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: (file: File) => request(`/api/admin/disputes/${disputeId}/evidence/upload?type=${fileType}&filename=${encodeURIComponent(file.name)}`,
      { method: "POST", body: file, headers: { "Content-Type": file.type } }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && String(q.queryKey[1]).startsWith("/disputes") }),
  });
  useEffect(() => { setText(""); }, [disputeId]);
  return (
    <Sheet open={!!disputeId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-border bg-popover sm:max-w-md">
        <SheetHeader><SheetTitle>{d ? `Dispute${d.orderNumber ? ` · #${d.orderNumber}` : ""}` : "Loading…"}</SheetTitle></SheetHeader>
        <div className="px-4 pb-6">
          <ErrorLine error={error} />
          {d && (
            <>
              <div className="mb-4 flex flex-wrap gap-1.5"><Badge>{label(d.status)}</Badge>{d.evidenceSubmittedAt && <Badge tone="outline">Evidence submitted</Badge>}</div>
              <div className="text-2xl font-semibold tabular-nums">{money(d.amountCents)}</div>
              <Row k="Reason" v={label(d.reason ?? "—")} />
              <Row k="Evidence due" v={when(d.evidenceDueBy)} />
              {d.customerClaim && <Row k="Buyer's claim" v={d.customerClaim} />}
              <SectionTitle>Evidence</SectionTitle>
              {d.evidence.length === 0 && d.files.length === 0 && <p className="py-2 text-sm text-muted-foreground">No evidence yet.</p>}
              {d.evidence.map((e) => <Row key={e.id} k={label(e.type)} v={<span className="line-clamp-3 max-w-[16rem] text-left">{e.description}</span>} />)}
              {d.files.map((f) => <Row key={f.id} k={label(f.evidenceType)} v={f.fileName} />)}
              {d.canAddEvidence && (
                <>
                  <SectionTitle>Add evidence</SectionTitle>
                  <div className="space-y-2">
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent className="admin-theme border-border bg-popover">{TEXT_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={5000} placeholder="What happened, with dates and tracking details" />
                    <Button variant="outline" className="h-10 w-full px-3" disabled={!text.trim() || addText.isPending}
                      onClick={() => addText.mutate({ type, description: text.trim() }, { onSuccess: () => setText("") })}>Save evidence</Button>
                    <ErrorLine error={addText.error} />
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={fileType} onValueChange={setFileType}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent className="admin-theme border-border bg-popover">{FILE_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-border px-3 text-sm hover:border-foreground">
                        {upload.isPending ? "Uploading…" : "Upload file"}
                        <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
                      </label>
                    </div>
                    <ErrorLine error={upload.error} />
                  </div>
                  <Button className="mt-4 h-10 w-full px-3" disabled={d.evidence.length + d.files.length === 0} onClick={() => setConfirming(true)}>Submit evidence</Button>
                </>
              )}
            </>
          )}
        </div>
        <ConfirmAction open={confirming} title="Submit evidence to the bank?" confirmLabel="Submit"
          description="Stripe sends everything above to the card issuer. You can only submit once."
          pending={submit.isPending} error={submit.error}
          onCancel={() => setConfirming(false)} onConfirm={() => submit.mutate({}, { onSuccess: () => setConfirming(false) })} />
      </SheetContent>
    </Sheet>
  );
}

// ─── Payout hold / release ───────────────────────────────────────────────────

export type PayoutTarget = { partyType: "seller" | "manufacturer"; partyId: string; name: string; action: "hold" | "release" };

export function PayoutHoldDialog({ target, onClose }: { target: PayoutTarget | null; onClose: () => void }) {
  const path = useMemo(() => (target ? `/payouts/${target.partyType}/${encodeURIComponent(target.partyId)}/${target.action}` : "/payouts/none"), [target]);
  const mutation = useAdminMutation<{ reason: string }>("POST", path, ["/payouts", "/risk", "/moderation-sellers"]);
  const hold = target?.action === "hold";
  return (
    <ConfirmAction open={!!target} destructive={hold}
      title={hold ? `Hold payouts for ${target?.name}?` : `Release payouts for ${target?.name}?`}
      description={hold
        ? "Stripe stops paying out to their bank. Sales keep working and the balance builds up until you release it."
        : "Their previous payout schedule is restored and the held balance pays out on it."}
      confirmLabel={hold ? "Hold payouts" : "Release payouts"}
      reasonLabel={hold ? "Reason (kept in the audit log)" : "Note (optional)"} reasonRequired={hold}
      pending={mutation.isPending} error={mutation.error}
      onCancel={onClose} onConfirm={(reason) => mutation.mutate({ reason }, { onSuccess: onClose })} />
  );
}

/** Suspend from a list row (reuses the existing POST /users/:id/suspend). */
export function SuspendDialog({ user, onClose }: { user: { clerkId: string; name: string } | null; onClose: () => void }) {
  const suspend = useAdminMutation<{ reason: string }>("POST", `/users/${user?.clerkId}/suspend`, ["/users", "/risk", "/moderation-sellers"]);
  return (
    <ConfirmAction open={!!user} destructive title={`Suspend ${user?.name ?? "this account"}?`} confirmLabel="Suspend"
      description="They're signed out everywhere and their content is hidden. Nothing is deleted, and you can reinstate them from Users."
      reasonLabel="Reason (kept in the audit log)" reasonRequired pending={suspend.isPending} error={suspend.error}
      onCancel={onClose} onConfirm={(reason) => suspend.mutate({ reason }, { onSuccess: onClose })} />
  );
}
