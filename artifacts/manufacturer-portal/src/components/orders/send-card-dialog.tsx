import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Package, Shirt } from "lucide-react";
import { getGetThreadMessagesQueryKey, getListManufacturerSampleOrdersQueryKey, getListManufacturerThreadsQueryKey } from "@workspace/api-client-react";
import { CARD_LIMITS, formatMoney, parseAmountToCents, validateCardInput, type CardFieldErrors } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ApiRequestError, useApiRequest } from "@/lib/api";
import { useConnectStatus } from "@/hooks/use-connect-status";

type OrderType = "sample" | "bulk";

export function SendCardDialog({
  open, onOpenChange, threadId, sellerName, initialType = "sample",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  sellerName: string;
  initialType?: OrderType;
}) {
  const request = useApiRequest();
  const queryClient = useQueryClient();
  const connect = useConnectStatus();
  const [orderType, setOrderType] = useState<OrderType>(initialType);
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState(initialType === "sample" ? "1" : "");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<CardFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  const reset = () => {
    setTitle(""); setQuantity(orderType === "sample" ? "1" : ""); setPrice(""); setDescription("");
    setErrors({}); setFormError(null); requestId.current = null;
  };

  const send = useMutation<unknown, ApiRequestError, Record<string, unknown>>({
    mutationFn: (body) => request(`/api/manufacturers/me/threads/${threadId}/order-cards`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetThreadMessagesQueryKey(threadId) });
      void queryClient.invalidateQueries({ queryKey: getListManufacturerThreadsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListManufacturerSampleOrdersQueryKey() });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      setFormError(error.message);
      if (error.fieldErrors) setErrors(error.fieldErrors as CardFieldErrors);
    },
  });

  const clearError = (key: keyof CardFieldErrors) => setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  const priceCents = parseAmountToCents(price);
  const qty = Number(quantity);
  const perUnit = priceCents && orderType === "bulk" && Number.isInteger(qty) && qty > 0 ? Math.round(priceCents / qty) : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const input = { orderType, title: title.trim(), description: description.trim() || null, quantity: qty, priceCents: priceCents ?? NaN };
    const check = validateCardInput(input);
    if (!check.ok) { setErrors(check.errors); return; }
    setErrors({});
    requestId.current ??= crypto.randomUUID();
    send.mutate({ ...input, clientRequestId: requestId.current });
  };

  const payoutBlocked = connect.data ? !connect.data.ready : false;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!send.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send an order card</DialogTitle>
          <DialogDescription>
            {sellerName} sees the price in this conversation and can pay by card, Apple Pay or Google Pay. Production starts once payment arrives.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Order type">
            {([["sample", "Sample", Shirt, "A few pieces to approve fit and quality"], ["bulk", "Bulk order", Package, "The production run"]] as const).map(([value, label, Icon, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={orderType === value}
                onClick={() => { setOrderType(value); if (value === "sample" && !quantity) setQuantity("1"); }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  orderType === value ? "border-primary bg-primary/10" : "border-border bg-secondary/40 hover:border-muted-foreground/40",
                )}
                data-testid={`button-card-type-${value}`}
              >
                <Icon className={cn("mb-2 h-4 w-4", orderType === value ? "text-primary" : "text-muted-foreground")} />
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="card-title">What are you making?</Label>
            <Input id="card-title" value={title} maxLength={CARD_LIMITS.titleMax} onChange={(event) => { setTitle(event.target.value); clearError("title"); }} placeholder="e.g. Heavyweight hoodie, washed black" data-testid="input-card-title" />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="card-quantity">Quantity (pieces)</Label>
              <Input id="card-quantity" inputMode="numeric" value={quantity} onChange={(event) => { setQuantity(event.target.value.replace(/[^\d]/g, "")); clearError("quantity"); }} placeholder={orderType === "bulk" ? "e.g. 500" : "1"} data-testid="input-card-quantity" />
              {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-price">Total price</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">US$</span>
                <Input id="card-price" inputMode="decimal" value={price} onChange={(event) => { setPrice(event.target.value); clearError("priceCents"); }} placeholder="0.00" className="pl-11 font-mono" data-testid="input-card-price" />
              </div>
              {errors.priceCents
                ? <p className="text-xs text-destructive">{errors.priceCents}</p>
                : perUnit ? <p className="text-xs text-muted-foreground">≈ {formatMoney(perUnit)} per piece</p> : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="card-description">Details <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="card-description" value={description} maxLength={CARD_LIMITS.descriptionMax} onChange={(event) => setDescription(event.target.value)} placeholder="Fabric, sizes, colors, what's included, shipping method…" className="min-h-[88px] resize-y" />
          </div>

          <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            Prices are in US dollars. Stripe converts your payout to your bank's currency. Brandthread's platform fee and Stripe processing fees are deducted before payout.
          </p>

          {payoutBlocked && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>You can send this card now, but the seller can't pay until your payout account is verified. <Link href="/payment" className="font-medium underline">Finish payout setup</Link></p>
            </div>
          )}
          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={send.isPending}>Cancel</Button>
            <Button type="submit" disabled={send.isPending} data-testid="button-send-card">
              {send.isPending ? "Sending…" : priceCents ? `Send card · ${formatMoney(priceCents)}` : "Send card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
