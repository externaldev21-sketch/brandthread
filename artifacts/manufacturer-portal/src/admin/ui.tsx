import { useEffect, useState, type ReactNode } from "react";
import type React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";

export function PageTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}

/** Stripe-style summary cards that double as filters when `onSelect` is given. */
export function StatCards({ items }: { items: { label: string; value: string; active?: boolean; onClick?: () => void }[] }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
      {items.map((s) => {
        const Tag = s.onClick ? "button" : "div";
        return (
          <Tag key={s.label} onClick={s.onClick}
            className={cn("rounded-lg border bg-card px-3.5 py-3 text-left", s.onClick && "hover:border-foreground/30", s.active ? "border-foreground" : "border-border")}>
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-1 truncate text-lg font-semibold tabular-nums">{s.value}</div>
          </Tag>
        );
      })}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => local !== value && onChange(local), 300);
    return () => clearTimeout(t);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative w-full md:max-w-xs">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} className="h-9 pl-9 pr-8" />
      {local && <button aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setLocal(""); onChange(""); }}><X className="h-4 w-4" /></button>}
    </div>
  );
}

const MOBILE_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 6: "grid-cols-3" };

/** Filter chips: equal-width cells on one grid (3 per row on phones when there are more than 4). */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  // Always a full grid (never a ragged last row): 4 short labels fit in one row, 4 long ones go 2x2.
  const cols = options.length === 4 ? (options.some((o) => o.label.length > 8) ? "grid-cols-2" : "grid-cols-4") : MOBILE_COLS[options.length] ?? "grid-cols-2";
  return (
    <div className={cn("grid gap-2 md:inline-grid md:auto-cols-fr md:grid-flow-col md:grid-cols-none", cols)}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cn("inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border px-3 text-xs font-medium",
            value === o.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small outlined row action. Always used inside ActionGroup so siblings match in size. */
export function ActionButton({ children, solid, ...props }: { solid?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={cn("inline-flex h-8 min-w-[5rem] items-center justify-center whitespace-nowrap rounded-md border px-3 text-xs font-medium",
        solid ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground")}>
      {children}
    </button>
  );
}

/** Equal-width, equal-height button row. */
export function ActionGroup({ children }: { children: ReactNode }) {
  return <div className="grid auto-cols-fr grid-flow-col gap-2">{children}</div>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "solid" | "outline" | "danger" }) {
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium capitalize",
      tone === "neutral" && "bg-secondary text-secondary-foreground",
      tone === "solid" && "bg-foreground text-background",
      tone === "outline" && "border border-border text-muted-foreground",
      tone === "danger" && "bg-destructive/15 text-destructive")}>
      {children}
    </span>
  );
}

export interface Column<R> { header: string; cell: (row: R) => ReactNode; className?: string; primary?: boolean }

/** Dense table on desktop; each row becomes a labelled card on phones. */
export function DataTable<R>({ columns, rows, rowKey, onRowClick, empty, loading }: {
  columns: Column<R>[]; rows: R[] | undefined; rowKey: (r: R) => string; onRowClick?: (r: R) => void; empty: string; loading?: boolean;
}) {
  if (loading && !rows) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!rows || rows.length === 0) return <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">{empty}</div>;
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              {columns.map((c) => <th key={c.header} className={cn("px-3 py-2.5 font-medium", c.className)}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn("border-b border-border last:border-0", onRowClick && "cursor-pointer hover:bg-secondary/60")}>
                {columns.map((c) => <td key={c.header} className={cn("px-3 py-2.5 align-middle", c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={cn("rounded-lg border border-border bg-card p-3.5", onRowClick && "active:bg-secondary")}>
            <div className="mb-2 text-sm font-medium">{primary.cell(r)}</div>
            <dl className="space-y-1.5">
              {columns.filter((c) => c !== primary).map((c) => (
                <div key={c.header} className="flex items-baseline justify-between gap-4 text-[13px]">
                  <dt className="shrink-0 whitespace-nowrap text-muted-foreground">{c.header}</dt>
                  <dd className="min-w-0 break-words text-right">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

export function Pager({ offset, limit, hasMore, total, onChange }: { offset: number; limit: number; hasMore: boolean; total?: number; onChange: (o: number) => void }) {
  if (offset === 0 && !hasMore) return total != null ? <div className="mt-3 text-xs text-muted-foreground">{total} result{total === 1 ? "" : "s"}</div> : null;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
      <span>{total != null ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : `Showing ${offset + 1}+`}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-8 w-24 px-3" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button size="sm" variant="outline" className="h-8 w-24 px-3" disabled={!hasMore} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

/** Confirmation with an optional required reason — used by every destructive-feeling admin action. */
export function ConfirmAction({ open, title, description, confirmLabel, reasonLabel, reasonRequired, destructive, pending, error, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; reasonLabel?: string; reasonRequired?: boolean;
  destructive?: boolean; pending?: boolean; error?: unknown; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="border-border bg-popover">
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {reasonLabel && <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonLabel} maxLength={500} rows={3} />}
        {error ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : null}
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
          <AlertDialogCancel onClick={onCancel} className="mt-0 h-10 w-full px-3">Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending || (!!reasonRequired && !reason.trim())} onClick={(e) => { e.preventDefault(); onConfirm(reason.trim()); }}
            className={cn("h-10 w-full px-3", destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}>
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  return error ? <p className="mb-3 text-sm text-destructive">{errorMessage(error)}</p> : null;
}
