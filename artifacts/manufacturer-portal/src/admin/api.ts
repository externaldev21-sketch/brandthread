import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useApiRequest } from "@/lib/api";

/** Query keys are namespaced so signing out (qc.clear) drops every admin cache. */
const key = (path: string) => ["admin", path] as const;

export function useAdminQuery<T>(path: string, enabled = true) {
  const request = useApiRequest();
  return useQuery({
    queryKey: key(path),
    queryFn: () => request<T>(`/api/admin${path}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useAdminMutation<TBody = unknown, TResult = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  path: string | ((body: TBody) => string),
  invalidate: string[] = [],
) {
  const request = useApiRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) =>
      request<TResult>(`/api/admin${typeof path === "function" ? path(body) : path}`, {
        method,
        body: method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
      }),
    onSuccess: () => {
      for (const prefix of invalidate) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && String(q.queryKey[1]).startsWith(prefix) });
    },
  });
}

/** The moderation queue lives in the trust & safety API, not under /api/admin. */
export function useModerationQuery<T>(path: string) {
  const request = useApiRequest();
  return useQuery({
    queryKey: ["admin", `moderation${path}`],
    queryFn: () => request<T>(`/api/moderation${path}`),
    placeholderData: keepPreviousData,
  });
}

export function useModerationResolve() {
  const request = useApiRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: string; note?: string }) =>
      request(`/api/moderation/reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ action, note }) }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" }),
  });
}

export function useAdminMe() {
  const request = useApiRequest();
  return useQuery({
    queryKey: ["admin", "me"],
    queryFn: () => request<{ isAdmin: boolean; email?: string; name?: string }>("/api/admin/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export const useQs = () =>
  useCallback((params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, []);

export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
export const dollarsFromMicros = (micros: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(micros / 1_000_000);
export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
