import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetManufacturerDashboardQueryKey,
  getGetManufacturerSampleOrderQueryKey,
  getGetThreadMessagesQueryKey,
  getListManufacturerSampleOrdersQueryKey,
  getListManufacturerThreadsQueryKey,
} from "@workspace/api-client-react";
import { ApiRequestError, useApiRequest } from "@/lib/api";
import type { OrderTimeline } from "@/lib/order-types";

export const orderTimelineKey = (orderId: string) => ["manufacturer-order-timeline", orderId] as const;

export function useOrderTimeline(orderId: string, options: { refetchInterval?: number } = {}) {
  const request = useApiRequest();
  return useQuery<OrderTimeline, ApiRequestError>({
    queryKey: orderTimelineKey(orderId),
    queryFn: () => request<OrderTimeline>(`/api/manufacturers/orders/${orderId}/timeline`),
    refetchInterval: options.refetchInterval ?? 15_000,
    enabled: !!orderId,
  });
}

/** Stage updates and card withdrawal, with every dependent view refreshed. */
export function useOrderActions(threadId?: string | null) {
  const request = useApiRequest();
  const queryClient = useQueryClient();
  const refresh = (orderId: string) => {
    void queryClient.invalidateQueries({ queryKey: orderTimelineKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getGetManufacturerSampleOrderQueryKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getListManufacturerSampleOrdersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetManufacturerDashboardQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListManufacturerThreadsQueryKey() });
    if (threadId) void queryClient.invalidateQueries({ queryKey: getGetThreadMessagesQueryKey(threadId) });
  };

  const advance = useMutation<unknown, ApiRequestError, {
    orderId: string; status: string; expectedRevision: number; carrier?: string; trackingNumber?: string;
  }>({
    mutationFn: ({ orderId, ...body }) => request(`/api/manufacturers/me/sample-orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    onSettled: (_data, _error, variables) => refresh(variables.orderId),
  });

  const withdraw = useMutation<unknown, ApiRequestError, { orderId: string; reason?: string }>({
    mutationFn: ({ orderId, reason }) => request(`/api/manufacturers/orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }),
    onSettled: (_data, _error, variables) => refresh(variables.orderId),
  });

  return { advance, withdraw };
}
