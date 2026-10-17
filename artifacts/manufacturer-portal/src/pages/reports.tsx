/**
 * Simple moderation / reports review page for platform staff.
 * Lists all user-submitted content reports and lets staff update their status.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useApiRequest } from "@/lib/api";
import { QueryError } from "@/components/query-state";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-800",
  reviewed:  "bg-blue-100 text-blue-800",
  actioned:  "bg-red-100 text-red-800",
  dismissed: "bg-gray-100 text-gray-600",
};

const STATUSES = ["pending", "reviewed", "actioned", "dismissed"] as const;

type Report = {
  id: string;
  status: string;
  targetType: string;
  targetId: string;
  targetLabel?: string | null;
  reason: string;
  description?: string | null;
  createdAt: string;
};

export default function Reports() {
  const request = useApiRequest();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("pending");

  // The API is mounted at the site root (/api), not under the portal's
  // /manufacturers/ base path — same as every other portal page.
  const { data: rows = [], isLoading, error, refetch } = useQuery({
    queryKey: ["reports", filter],
    queryFn: () => request<Report[]>(`/api/reports?status=${encodeURIComponent(filter)}&limit=100`),
    refetchInterval: 30_000,
  });

  const dismiss = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      request<Report>(`/api/reports/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    // Optimistically drop the report from the current list; restore it if the
    // server rejects the change.
    onMutate: async ({ id }) => {
      const key = ["reports", filter];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Report[]>(key);
      qc.setQueryData<Report[]>(key, (old) => old?.filter((r) => r.id !== id));
      return { key, previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.previous);
      toast({
        title: "Couldn't update report",
        description: errorMessage(err),
        variant: "destructive",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Content Reports</h1>
        <div className="flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filter === s
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:border-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-16">Loading…</div>
      ) : error ? (
        <QueryError title="Unable to load reports" description={errorMessage(error)} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <div className="text-center text-muted-foreground py-16">No {filter} reports.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[r.status] ?? ""}`}>
                      {r.status}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {r.targetType} · {String(r.targetId ?? "").slice(0, 16)}…
                    </span>
                  </div>
                  {r.targetLabel && (
                    <p className="text-sm font-medium truncate">{r.targetLabel}</p>
                  )}
                  <p className="text-sm mt-1">
                    <span className="font-medium">Reason:</span> {r.reason}
                  </p>
                  {r.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">{r.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                </div>
                {r.status === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => dismiss.mutate({ id: r.id, status: "actioned" })}
                      disabled={dismiss.isPending}
                      className="px-3 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100"
                    >
                      Action
                    </button>
                    <button
                      onClick={() => dismiss.mutate({ id: r.id, status: "dismissed" })}
                      disabled={dismiss.isPending}
                      className="px-3 py-1 text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded hover:bg-gray-100"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
