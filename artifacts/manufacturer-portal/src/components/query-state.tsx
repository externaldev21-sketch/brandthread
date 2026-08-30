import type { LucideIcon } from "lucide-react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QueryError({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-destructive/40 bg-destructive/10 p-8 text-center"
      data-testid="status-query-error"
    >
      <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      <Button
        variant="outline"
        className="mt-5 gap-2"
        onClick={onRetry}
        data-testid="button-retry-query"
      >
        <RefreshCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div
      className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-10 text-center"
      data-testid="status-empty"
    >
      <div className="mb-4 rounded-full border border-border bg-secondary p-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}