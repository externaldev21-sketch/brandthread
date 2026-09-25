import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Inbox,
  MessageCircleQuestion,
  RefreshCw,
  Search,
  Send,
  Split,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type QuoteStatus =
  | "submitted"
  | "viewed"
  | "questions_asked"
  | "quoted"
  | "counteroffer_sent"
  | "accepted"
  | "declined"
  | "cancelled";

type Counteroffer = {
  desiredUnitPriceCents?: number;
  desiredMoq?: number;
  desiredProductionDays?: number;
  desiredPaymentTerms?: string;
  notes?: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
};

type QuoteRequest = {
  id: string;
  sellerId: string;
  manufacturerId: string;
  type: string;
  productName: string;
  productType: string;
  quantity: number | null;
  colorways: string | null;
  details: string | null;
  status: QuoteStatus;
  quotedPriceCents: number | null;
  quotedTurnaround: string | null;
  quoteValidUntil: string | null;
  counteroffer: Counteroffer | null;
  notes: string | null;
  rfqId: string | null;
  createdAt: string;
  updatedAt: string;
};

type RequestError = Error & { status?: number };

const statusLabels: Record<QuoteStatus, string> = {
  submitted: "Needs review",
  viewed: "In review",
  questions_asked: "Questions asked",
  quoted: "Quoted",
  counteroffer_sent: "Counteroffer",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

const filterOptions = [
  { value: "all", label: "All" },
  { value: "needs_review", label: "Needs review" },
  { value: "quoted", label: "Quoted" },
  { value: "counteroffer_sent", label: "Counteroffers" },
  { value: "closed", label: "Closed" },
] as const;

type Filter = (typeof filterOptions)[number]["value"];

const money = (cents: number | null | undefined) =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);

const formatDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value))
    : "—";

const formatDateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const humanize = (value: string) => value.replaceAll("_", " ");

function isClosed(status: QuoteStatus) {
  return status === "accepted" || status === "declined" || status === "cancelled";
}

function isReviewable(status: QuoteStatus) {
  return status === "submitted" || status === "viewed" || status === "questions_asked";
}

function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

function DetailValue({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{children || "—"}</dd>
    </div>
  );
}

function RfqBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-primary/40 text-primary", className)}
      title="This seller sent the same request to several manufacturers at once."
      data-testid="badge-rfq"
    >
      <Split className="h-3 w-3" /> Multi-supplier RFQ
    </Badge>
  );
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const variant = status === "declined" || status === "cancelled"
    ? "destructive"
    : status === "quoted" || status === "accepted"
      ? "default"
      : "secondary";
  return <Badge variant={variant} className="capitalize">{statusLabels[status] ?? humanize(status)}</Badge>;
}

export default function QuoteRequests() {
  const { getToken } = useAuth();
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [price, setPrice] = useState("");
  const [turnaround, setTurnaround] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(body?.error || "Quote request action failed") as RequestError;
      requestError.status = response.status;
      throw requestError;
    }
    return body as T;
  }, [getToken]);

  const load = useCallback(async () => {
    setError("");
    try {
      const nextRequests = await request<QuoteRequest[]>("/api/manufacturers/me/quote-requests");
      setRequests(nextRequests);
      setSelectedId((current) => current && nextRequests.some((item) => item.id === current)
        ? current
        : nextRequests[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const filteredRequests = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return requests.filter((item) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "needs_review" && isReviewable(item.status)) ||
        (filter === "quoted" && item.status === "quoted") ||
        (filter === "counteroffer_sent" && item.status === "counteroffer_sent") ||
        (filter === "closed" && isClosed(item.status));
      const matchesSearch = !normalizedSearch ||
        `${item.productName} ${item.productType} ${item.sellerId} ${item.id}`.toLowerCase().includes(normalizedSearch);
      return matchesFilter && matchesSearch;
    });
  }, [filter, requests, search]);

  const selected = requests.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setPrice(selected.quotedPriceCents == null ? "" : (selected.quotedPriceCents / 100).toFixed(2));
    setTurnaround(selected.quotedTurnaround ?? "");
    setValidUntil(selected.quoteValidUntil ? selected.quoteValidUntil.slice(0, 10) : "");
    setNotes("");
    setMutationError("");
  }, [selectedId]); // Reinitialize only when the manufacturer changes selection, not after each refresh.

  const updateSelected = (updated: QuoteRequest) => {
    setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const changeStatus = async (
    status: QuoteStatus,
    extra: Record<string, unknown> = {},
    successMessage: string,
  ) => {
    if (!selected) return;
    setIsMutating(true);
    setMutationError("");
    try {
      const updated = await request<QuoteRequest>(`/api/manufacturers/me/quote-requests/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...extra }),
      });
      updateSelected(updated);
      toast.success(successMessage);
      if (status === "quoted" || status === "declined") {
        setPrice(updated.quotedPriceCents == null ? "" : (updated.quotedPriceCents / 100).toFixed(2));
        setTurnaround(updated.quotedTurnaround ?? "");
        setValidUntil(updated.quoteValidUntil ? updated.quoteValidUntil.slice(0, 10) : "");
      }
    } catch (err) {
      const requestError = err as RequestError;
      setMutationError(requestError.message || "The quote request could not be updated.");
      if (requestError.status === 409) await load();
    } finally {
      setIsMutating(false);
    }
  };

  const sendQuote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const trimmedPrice = price.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmedPrice) || Number(trimmedPrice) <= 0) {
      setMutationError("Enter a positive price with up to two decimal places.");
      return;
    }
    if (!validUntil) {
      setMutationError("Choose a quote validity date.");
      return;
    }
    const validDate = new Date(`${validUntil}T23:59:59.999Z`);
    if (Number.isNaN(validDate.getTime()) || validDate.getTime() <= Date.now()) {
      setMutationError("Valid until must be a future date.");
      return;
    }
    const quotedPriceCents = Math.round(Number(trimmedPrice) * 100);
    await changeStatus(
      "quoted",
      {
        quotedPriceCents,
        quotedTurnaround: turnaround.trim() || undefined,
        validUntil: validDate.toISOString(),
        notes: notes.trim() || undefined,
      },
      "Quote sent to seller",
    );
  };

  const resolveCounteroffer = (counterofferStatus: "accepted" | "declined") => {
    if (!selected) return;
    void changeStatus(
      counterofferStatus === "accepted" ? "quoted" : "declined",
      {
        counterofferStatus,
        ...(counterofferStatus === "accepted" &&
        (selected.counteroffer?.desiredUnitPriceCents ?? selected.quotedPriceCents)
          ? { quotedPriceCents: selected.counteroffer?.desiredUnitPriceCents ?? selected.quotedPriceCents }
          : {}),
      },
      counterofferStatus === "accepted" ? "Counteroffer accepted" : "Counteroffer declined",
    );
  };

  const canDecline = selected && isReviewable(selected.status);
  const canQuote = selected && (selected.status === "viewed" || selected.status === "questions_asked");

  if (loading) {
    return (
      <div className="space-y-6" data-testid="status-loading-quotes">
        <div className="h-10 w-56 animate-pulse rounded bg-secondary" />
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.5fr)]">
          <div className="h-[560px] animate-pulse rounded-lg border border-border bg-card" />
          <div className="h-[560px] animate-pulse rounded-lg border border-border bg-card" />
        </div>
      </div>
    );
  }

  if (error) {
    return <QueryError title="Unable to load quote requests" description={error} onRetry={() => { setLoading(true); void load(); }} />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Commercial inbox</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Quote requests</h1>
          <p className="mt-1 text-muted-foreground">Review production details and send terms back to sellers.</p>
        </div>
        <Button variant="outline" className="gap-2 self-start" onClick={() => { setLoading(true); void load(); }} disabled={isMutating}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product or seller ID..."
            className="h-11 bg-card pl-9"
            data-testid="input-search-quote-requests"
          />
        </div>
        <div className="flex flex-wrap rounded-md border border-border bg-card p-1" role="tablist" aria-label="Quote request status">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                "rounded px-3 py-2 text-sm transition-colors",
                filter === option.value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`tab-quotes-${option.value}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.5fr)]">
        <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label="Quote request list">
          {filteredRequests.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={search || filter !== "all" ? "No matching requests" : "Your quote inbox is clear"}
              description={search || filter !== "all" ? "Try another search or status filter." : "New seller quote requests will appear here."}
            />
          ) : (
            <div className="divide-y divide-border">
              {filteredRequests.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-secondary/40",
                    selectedId === item.id && "bg-primary/10",
                    item.status === "submitted" && "border-l-2 border-l-primary bg-primary/5",
                  )}
                  data-testid={`quote-request-row-${item.id}`}
                >
                  <div className="mt-0.5 rounded border border-border bg-secondary p-2 text-primary">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold">{item.productName}</p>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.sellerId} · {item.quantity ?? "—"} units</p>
                    {item.rfqId && <RfqBadge className="mt-2" />}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Badge variant="outline" className="capitalize">{item.type}</Badge>
                      <span className="text-[11px] text-muted-foreground">{formatDate(item.createdAt)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-lg border border-border bg-card">
          {!selected ? (
            <div className="flex h-full min-h-[560px] flex-col items-center justify-center p-10 text-center">
              <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Select a quote request</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">Incoming terms and response actions will appear here.</p>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Request detail</p>
                  <h2 className="mt-2 truncate text-2xl font-bold">{selected.productName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">From seller {selected.sellerId} · Received {formatDateTime(selected.createdAt)}</p>
                  {selected.rfqId && <RfqBadge className="mt-3" />}
                </div>
                <StatusBadge status={selected.status} />
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto p-5">
                {mutationError && (
                  <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert" aria-live="polite">
                    <X className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{mutationError}</span>
                  </div>
                )}

                {selected.rfqId && (
                  <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
                    <Split className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <p>
                      Part of a multi-supplier RFQ — this seller sent the same request to several manufacturers.
                      Your quote is independent; there's no guarantee of exclusivity.
                    </p>
                  </div>
                )}

                <div>
                  <h3 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-primary" /> Incoming terms</h3>
                  <dl className="grid gap-x-6 gap-y-4 rounded-md border border-border bg-secondary/20 p-4 sm:grid-cols-2">
                    <DetailValue label="Product type">{selected.productType}</DetailValue>
                    <DetailValue label="Request type"><span className="capitalize">{selected.type}</span></DetailValue>
                    <DetailValue label="Quantity">{selected.quantity ? `${selected.quantity.toLocaleString()} units` : "Not specified"}</DetailValue>
                    <DetailValue label="Colorways">{selected.colorways}</DetailValue>
                    <DetailValue label="Production details" wide>{selected.details}</DetailValue>
                    <DetailValue label="Request ID" wide><span className="break-all font-mono text-xs">{selected.id}</span></DetailValue>
                  </dl>
                </div>

                {selected.counteroffer && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="flex items-center gap-2 font-semibold text-amber-300"><MessageCircleQuestion className="h-4 w-4" /> Seller counteroffer</h3>
                        <p className="mt-1 text-xs text-muted-foreground">Sent {formatDateTime(selected.counteroffer.createdAt)}</p>
                      </div>
                      <Badge variant="outline" className="w-fit capitalize text-amber-200">{selected.counteroffer.status}</Badge>
                    </div>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                      <DetailValue label="Desired unit price">{money(selected.counteroffer.desiredUnitPriceCents)}</DetailValue>
                      <DetailValue label="Desired MOQ">{selected.counteroffer.desiredMoq ? `${selected.counteroffer.desiredMoq.toLocaleString()} units` : "—"}</DetailValue>
                      <DetailValue label="Desired production time">{selected.counteroffer.desiredProductionDays ? `${selected.counteroffer.desiredProductionDays} days` : "—"}</DetailValue>
                      <DetailValue label="Payment terms">{selected.counteroffer.desiredPaymentTerms}</DetailValue>
                      <DetailValue label="Seller notes" wide>{selected.counteroffer.notes}</DetailValue>
                    </dl>
                    {selected.status === "counteroffer_sent" && (
                      <div className="mt-4 flex flex-col gap-2 border-t border-amber-500/20 pt-4 sm:flex-row">
                        <Button onClick={() => resolveCounteroffer("accepted")} disabled={isMutating} className="gap-2">
                          <Check className="h-4 w-4" /> Accept counteroffer
                        </Button>
                        <Button variant="outline" onClick={() => resolveCounteroffer("declined")} disabled={isMutating} className="gap-2">
                          <X className="h-4 w-4" /> Decline counteroffer
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {selected.notes && (
                  <div className="rounded-md border border-border bg-secondary/20 p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Previous notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{selected.notes}</p>
                  </div>
                )}

                {selected.status === "submitted" && (
                  <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">This request is waiting for your review.</p>
                      <p className="mt-1 text-sm text-muted-foreground">Mark it viewed to open the response form.</p>
                    </div>
                    <Button onClick={() => void changeStatus("viewed", {}, "Request marked as viewed")} disabled={isMutating} className="shrink-0 gap-2">
                      <CheckCircle2 className="h-4 w-4" /> Mark viewed
                    </Button>
                  </div>
                )}

                {canQuote && (
                  <form onSubmit={sendQuote} className="space-y-4 rounded-md border border-primary/30 bg-primary/5 p-4">
                    <div>
                      <h3 className="font-semibold">Send your quote</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Set the terms the seller will review. Price is sent as exact cents to the server.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2 text-sm font-medium">
                        <span>Quoted price (USD) <span className="text-primary">*</span></span>
                        <Input
                          value={price}
                          onChange={(event) => setPrice(event.target.value)}
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          required
                          className="bg-card"
                          data-testid="input-quoted-price"
                        />
                      </label>
                      <label className="space-y-2 text-sm font-medium">
                        <span>Turnaround</span>
                        <Input
                          value={turnaround}
                          onChange={(event) => setTurnaround(event.target.value)}
                          placeholder="e.g. 30–45 days"
                          className="bg-card"
                          data-testid="input-quoted-turnaround"
                        />
                      </label>
                      <label className="space-y-2 text-sm font-medium sm:col-span-2">
                        <span>Valid until <span className="text-primary">*</span></span>
                        <Input
                          value={validUntil}
                          onChange={(event) => setValidUntil(event.target.value)}
                          type="date"
                          min={getTomorrowDate()}
                          required
                          className="bg-card"
                          data-testid="input-quote-valid-until"
                        />
                      </label>
                    </div>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>Notes for seller</span>
                      <Textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Add inclusions, assumptions, or next steps..."
                        className="min-h-24 resize-y bg-card"
                        data-testid="textarea-quote-notes"
                      />
                    </label>
                    <Button type="submit" disabled={isMutating} className="gap-2" data-testid="button-send-quote">
                      <Send className="h-4 w-4" /> {isMutating ? "Sending…" : "Send quote"}
                    </Button>
                  </form>
                )}

                {canDecline && (
                  <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">Not a fit for this request?</p>
                      <p className="mt-1 text-xs text-muted-foreground">Declining is a final decision and will notify the seller.</p>
                    </div>
                    <Button variant="outline" onClick={() => void changeStatus("declined", {}, "Quote request declined")} disabled={isMutating} className="gap-2 text-destructive hover:text-destructive">
                      <X className="h-4 w-4" /> Decline request
                    </Button>
                  </div>
                )}

                {selected.status === "quoted" && (
                  <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
                    <Send className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium">Quote sent {formatDateTime(selected.updatedAt)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{money(selected.quotedPriceCents)} per unit{selected.quotedTurnaround ? ` · ${selected.quotedTurnaround}` : ""} · valid until {formatDate(selected.quoteValidUntil)}</p>
                    </div>
                  </div>
                )}

                {isClosed(selected.status) && (
                  <div className="flex items-start gap-3 rounded-md border border-border bg-secondary/20 p-4">
                    <Clock3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium capitalize">Request {humanize(selected.status)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">This request no longer accepts manufacturer responses.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}