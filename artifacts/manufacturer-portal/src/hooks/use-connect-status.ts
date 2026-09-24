import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, useApiRequest } from "@/lib/api";
import type { ConnectStatus } from "@/lib/order-types";

export const CONNECT_STATUS_KEY = ["manufacturer-connect-status"] as const;

/** Stripe payout readiness. A 503 means payments aren't configured on this server. */
export function useConnectStatus() {
  const request = useApiRequest();
  return useQuery<ConnectStatus, ApiRequestError>({
    queryKey: CONNECT_STATUS_KEY,
    queryFn: () => request<ConnectStatus>("/api/manufacturers/connect/status"),
    staleTime: 60_000,
    retry: (count, error) => error.status >= 500 && error.status !== 503 && count < 2,
  });
}
