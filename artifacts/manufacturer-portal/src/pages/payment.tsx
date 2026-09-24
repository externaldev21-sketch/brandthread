import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Banknote, CheckCircle2, Clock3, ExternalLink, Globe2, RefreshCw, RotateCcw, ShieldAlert, Wallet } from "lucide-react";
import { COUNTRIES, formatMoney, formatTimestamp } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import { ApiRequestError, errorMessage, useApiRequest } from "@/lib/api";
import { CONNECT_STATUS_KEY, useConnectStatus } from "@/hooks/use-connect-status";
import { QueryError } from "@/components/query-state";
import { cn } from "@/lib/utils";

type PaymentActivity = {
  id: string;
  type: string;
  amountCents: number | null;
  orderTitle: string | null;
  orderType: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

const ACTIVITY_LABEL: Record<string, string> = {
  payment_received: "Payment received",
  transfer_paid: "Transfer paid",
  payment_reversed: "Payment reversed",
  payouts_ready: "Payout account verified",
  payouts_restricted: "Payout account needs attention",
};

function requirementLabel(item: string) {
  const key = item.split(".").at(-1) ?? item;
  const known: Record<string, string> = {
    external_account: "bank account",
    tos_acceptance: "accept Stripe's terms",
    url: "business website",
    mcc: "business category",
    first_name: "representative's first name",
    last_name: "representative's last name",
    dob: "date of birth",
    id_number: "government ID number",
    document: "ID document",
    phone: "phone number",
    email: "email",
    line1: "address",
  };
  return known[key] ?? key.replaceAll("_", " ");
}

export default function Payment() {
  const request = useApiRequest();
  const queryClient = useQueryClient();
  const status = useConnectStatus();
  const activity = useQuery<PaymentActivity[], ApiRequestError>({
    queryKey: ["manufacturer-payment-activity"],
    queryFn: () => request<PaymentActivity[]>("/api/manufacturers/connect/payments"),
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

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
      setError(errorMessage(err, "Stripe onboarding could not be opened."));
      setStarting(false);
    }
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: CONNECT_STATUS_KEY });
    void activity.refetch();
  };

  if (status.isLoading) {
    return <div className="mx-auto max-w-5xl space-y-6" data-testid="status-payouts-loading"><div className="h-10 w-48 animate-pulse rounded bg-secondary" /><div className="h-64 animate-pulse rounded border border-border bg-card" /><div className="h-40 animate-pulse rounded border border-border bg-card" /></div>;
  }

  const header = (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Get paid</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Payouts</h1>
        <p className="mt-1 text-muted-foreground">Verify your business with Stripe once, then every paid order card goes to your bank.</p>
      </div>
      <Button variant="outline" onClick={refresh} className="gap-2" data-testid="button-refresh-payouts"><RefreshCw className="h-4 w-4" /> Refresh status</Button>
    </div>
  );

  if (status.error?.status === 503) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 pb-12">
        {header}
        <section className="rounded-lg border border-border bg-card p-8 text-center" data-testid="status-payments-not-configured">
          <Banknote className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Payouts are being switched on</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Card payments aren't enabled for this workspace yet. You can keep chatting with sellers and sending order cards — they become payable as soon as payments go live.</p>
        </section>
      </div>
    );
  }
  if (status.isError || !status.data) {
    return <div className="mx-auto max-w-5xl space-y-8">{header}<QueryError title="Payout status unavailable" description={status.error?.message ?? "We couldn't reach Stripe."} onRetry={refresh} /></div>;
  }

  const s = status.data;
  const country = COUNTRIES.find((item) => item.code === s.country);
  const events = activity.data ?? [];
  const totalReceived = events.reduce((sum, item) => {
    if (item.type === "payment_received" || item.type === "transfer_paid") return sum + (item.amountCents ?? 0);
    if (item.type === "payment_reversed") return sum - (item.amountCents ?? 0);
    return sum;
  }, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12 animate-in fade-in duration-500">
      {header}

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div>}

      <section className={cn("rounded-lg border p-6", s.ready ? "border-primary/30 bg-primary/5" : "border-amber-500/30 bg-amber-500/5")} data-testid="panel-connect-status">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", s.ready ? "bg-primary/15 text-primary" : "bg-amber-500/15 text-amber-400")}>
              {s.ready ? <CheckCircle2 className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
            </div>
            <div>
              <h2 className="text-xl font-bold">{s.ready ? "Ready to receive payments" : s.connected ? "Finish payout setup" : "Connect your payout account"}</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {s.ready
                  ? "Stripe has verified your business. Sellers can pay your order cards and the money is paid out to your bank."
                  : s.countryProblem ?? (s.connected
                    ? "Stripe needs a few more details before sellers can pay you. It usually takes a few minutes."
                    : "Stripe verifies your business and bank account. It takes about 10 minutes and you'll need your business registration and bank details.")}
              </p>
              {!s.ready && s.requirementsDue.length > 0 && (
                <p className="mt-3 text-sm text-amber-300">Still needed: {[...new Set(s.requirementsDue.map(requirementLabel))].join(", ")}</p>
              )}
              {s.countryProblem && <Link href="/profile" className="mt-3 inline-block text-sm font-medium text-primary underline">Update your country</Link>}
            </div>
          </div>
          {!s.ready && !s.countryProblem && (
            <Button onClick={() => void startOnboarding()} disabled={starting} className="shrink-0 gap-2" data-testid="button-start-connect">
              <ExternalLink className="h-4 w-4" /> {starting ? "Opening Stripe…" : s.connected ? "Continue with Stripe" : "Set up with Stripe"}
            </Button>
          )}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 border-t border-border/60 pt-5 sm:grid-cols-3">
          {([
            ["Business details", s.detailsSubmitted],
            [s.accountType === "recipient" ? "Receiving transfers" : "Payments enabled", s.accountType === "recipient" ? s.ready || (s.detailsSubmitted && s.payoutsEnabled) : s.chargesEnabled],
            ["Bank payouts", s.payoutsEnabled],
          ] as const).map(([label, complete]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              {complete ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />}
              <span className={complete ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Received from sellers</p>
          <p className="mt-2 font-mono text-3xl font-bold" data-testid="text-total-received">{formatMoney(totalReceived)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Gross, before platform and Stripe fees</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Globe2 className="h-4 w-4" /> Payout country</p>
          <p className="mt-2 text-lg font-semibold">{country?.name ?? s.country ?? "Not set"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{s.accountType === "recipient" ? "International payout account" : "Standard payout account"}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Banknote className="h-4 w-4" /> Currency</p>
          <p className="mt-2 text-lg font-semibold">Sellers pay in USD</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {s.payoutCurrency && s.payoutCurrency !== "USD"
              ? `Stripe converts to ${s.payoutCurrency} when paying your bank.`
              : country && country.currency !== "USD"
                ? `Stripe converts to ${country.currency} (or your bank's currency) at payout.`
                : "Paid out to your bank in USD."}
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Payment activity</h2>
          <p className="text-sm text-muted-foreground">Every payment, reversal and payout-account change, newest first.</p>
        </div>
        {activity.isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg border border-border bg-card" />)}</div>
        ) : activity.isError ? (
          <QueryError title="Activity unavailable" description={activity.error.message} onRetry={() => void activity.refetch()} />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center" data-testid="status-empty-activity">
            <Wallet className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No payments yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">When a seller pays one of your sample or bulk order cards, it shows up here.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {events.map((item) => {
              const reversal = item.type === "payment_reversed";
              const Icon = reversal ? RotateCcw : item.amountCents == null ? ArrowUpRight : ArrowDownLeft;
              return (
                <div key={item.id} className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={cn("rounded-full p-2", reversal ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}><Icon className="h-4 w-4" /></div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.orderTitle ?? ACTIVITY_LABEL[item.type] ?? item.type.replaceAll("_", " ")}</p>
                      <p className="text-xs text-muted-foreground">{item.orderTitle ? `${ACTIVITY_LABEL[item.type] ?? item.type} · ` : ""}{item.orderType === "bulk" ? "Bulk order · " : item.orderType === "sample" ? "Sample · " : ""}{formatTimestamp(item.createdAt)}</p>
                    </div>
                  </div>
                  <span className={cn("shrink-0 font-mono font-semibold", reversal && "text-destructive")}>{item.amountCents == null ? "—" : `${reversal ? "−" : ""}${formatMoney(item.amountCents)}`}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
