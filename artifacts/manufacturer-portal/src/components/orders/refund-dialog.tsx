/**
 * Refund a paid sample/bulk order (full or partial). Mirrors Shopify's
 * "Refund" page: manual refund amount prefilled with what's available,
 * "$X available for refund", a reason, and one "Refund $X" button.
 */
import { useEffect, useRef, useState } from "react";
import { formatMoney, parseAmountToCents } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RefundDialog({
  open, onOpenChange, availableCents, sellerName, pending, error, onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCents: number;
  sellerName: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (input: { amountCents: number; reason: string | null; idempotencyKey: string }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const key = useRef<string | null>(null);
  useEffect(() => {
    if (open) {
      setAmount((availableCents / 100).toFixed(2));
      setReason("");
      key.current = null;
    }
  }, [open, availableCents]);
  const cents = parseAmountToCents(amount);
  const valid = cents != null && cents >= 1 && cents <= availableCents;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund</DialogTitle>
          <DialogDescription>The money goes back to {sellerName}'s original payment method.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            key.current ??= crypto.randomUUID();
            onSubmit({ amountCents: cents!, reason: reason.trim() || null, idempotencyKey: key.current });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Refund amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">US$</span>
              <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="pl-11 font-mono" data-testid="input-refund-amount" />
            </div>
            <p className={cents != null && cents > availableCents ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{formatMoney(availableCents)} available for refund</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Reason for refund</Label>
            <Input id="refund-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} data-testid="input-refund-reason" />
            <p className="text-xs text-muted-foreground">{sellerName} sees this reason in your conversation.</p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={!valid || pending} data-testid="button-confirm-refund">
              {pending ? "Refunding…" : `Refund ${formatMoney(valid ? cents! : 0)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
