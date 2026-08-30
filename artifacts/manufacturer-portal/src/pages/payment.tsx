import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { ArrowDownLeft, CheckCircle2, Clock3, ExternalLink, RefreshCw, ShieldAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

type ConnectStatus = {
  connected: boolean;
  ready: boolean;
  status: "not_started" | "pending" | "restricted" | "active";
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
  recovery: string | null;
};

type PaymentActivity = {
  id: string;
  type: string;
  amountCents: number | null;
  orderTitle: string | null;
  orderType: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function Payment() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [activity, setActivity] = useState<PaymentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body as T;
  }, [getToken]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [nextStatus, nextActivity] = await Promise.all([
        request<ConnectStatus>("/api/manufacturers/connect/status"),
        request<PaymentActivity[]>("/api/manufacturers/connect/payments"),
      ]);
      setStatus(nextStatus);
      setActivity(nextActivity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payout information could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const startOnboarding = async () => {
    setStarting(true);
    setError("");
    try {
      const returnUrl = `${window.location.origin}${import.meta.env.BASE_URL}payment`;
      const result = await request<{ url: string }>("/api/manufacturers/connect/onboard", {
        method: "POST",
        body: JSON.stringify({ returnUrl, refreshUrl: returnUrl }),
      });
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stripe onboarding could not be opened.");
      setStarting(false);
    }
  };

  if (loading) {
    return <div className="space-y-6"><div className="h-10 w-48 animate-pulse rounded bg-secondary" /><div className="h-64 animate-pulse rounded border border-border bg-card" /></div>;
  }

  const totalReceived = activity.reduce((sum, item) => {
    if (item.type === "payment_received" || item.type === "transfer_paid") {
      return sum + (item.amountCents ?? 0);
    }
    if (item.type === "payment_reversed") {
      return sum - (item.amountCents ?? 0);
    }
    return sum;
  }, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
          <p className="mt-1 text-muted-foreground">Connect a verified bank account and review payment activity.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh status
        </Button>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

      <section className={`rounded-lg border p-6 ${status?.ready ? "border-primary/30 bg-primary/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${status?.ready ? "bg-primary/15 text-primary" : "bg-amber-500/15 text-amber-400"}`}>
              {status?.ready ? <CheckCircle2 className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
            </div>
            <div>
              <h2 className="text-xl font-bold">{status?.ready ? "Ready to receive payments" : status?.connected ? "Finish payout setup" : "Connect your payout account"}</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {status?.ready
                  ? "Stripe has verified your account. Seller payments can be routed to your connected bank account."
                  : status?.recovery ?? "Complete secure Stripe onboarding before accepting paid orders."}
              </p>
              {status?.requirementsDue?.length ? (
                <p className="mt-3 text-xs text-amber-300">Stripe still requires: {status.requirementsDue.map((item) => item.replaceAll("_", " ")).join(", ")}</p>
              ) : null}
            </div>
          </div>
          {!status?.ready && (
            <Button onClick={() => void startOnboarding()} disabled={starting} className="shrink-0 gap-2">
              <ExternalLink className="h-4 w-4" /> {starting ? "Opening Stripe…" : status?.connected ? "Continue setup" : "Connect with Stripe"}
            </Button>
          )}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 border-t border-border/60 pt-5 sm:grid-cols-3">
          {[
            ["Identity details", status?.detailsSubmitted],
            ["Payments enabled", status?.chargesEnabled],
            ["Bank payouts enabled", status?.payoutsEnabled],
          ].map(([label, complete]) => (
            <div key={String(label)} className="flex items-center gap-2 text-sm">
              {complete ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />}
              <span className={complete ? "text-foreground" : "text-muted-foreground"}>{String(label)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Recorded payments</p>
          <p className="mt-2 text-3xl font-bold">{money(totalReceived)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Payout account</p>
          <p className="mt-2 text-lg font-semibold capitalize">{status?.status.replaceAll("_", " ") ?? "Not started"}</p>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Payment activity</h2>
          <p className="text-sm text-muted-foreground">Order payments and payout changes are recorded here.</p>
        </div>
        {activity.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center">
            <Wallet className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No payment activity yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Paid sample and bulk orders will appear here.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {activity.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary"><ArrowDownLeft className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.orderTitle ?? item.type.replaceAll("_", " ")}</p>
                    <p className="text-xs capitalize text-muted-foreground">{item.orderType ?? "Payout"} · {new Date(item.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <span className="shrink-0 font-mono font-semibold">{item.amountCents == null ? "—" : money(item.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}