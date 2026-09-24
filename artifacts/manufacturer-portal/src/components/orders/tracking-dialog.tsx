import { useState } from "react";
import { Truck } from "lucide-react";
import { CARRIERS } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TrackingDialog({
  open, onOpenChange, onSubmit, pending, error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (details: { carrier: string; trackingNumber: string }) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [carrierId, setCarrierId] = useState("");
  const [otherCarrier, setOtherCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const carrier = carrierId === "other" ? otherCarrier.trim() : CARRIERS.find((item) => item.id === carrierId)?.name ?? "";
  const valid = !!carrier && trackingNumber.trim().length >= 4;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" /> Add shipping details</DialogTitle>
          <DialogDescription>The seller gets a live tracking link as soon as you mark this order shipped.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onSubmit({ carrier, trackingNumber: trackingNumber.trim() });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="carrier">Carrier</Label>
            <Select value={carrierId} onValueChange={setCarrierId}>
              <SelectTrigger id="carrier" data-testid="select-carrier"><SelectValue placeholder="Choose a carrier" /></SelectTrigger>
              <SelectContent>
                {CARRIERS.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {carrierId === "other" && (
            <div className="space-y-2">
              <Label htmlFor="other-carrier">Carrier name</Label>
              <Input id="other-carrier" value={otherCarrier} onChange={(event) => setOtherCarrier(event.target.value)} placeholder="e.g. Kerry Express" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tracking-number">Tracking number</Label>
            <Input id="tracking-number" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="e.g. 1Z999AA10123456784" className="font-mono" data-testid="input-tracking-number" />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || pending} data-testid="button-confirm-shipped">{pending ? "Saving…" : "Mark shipped"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
