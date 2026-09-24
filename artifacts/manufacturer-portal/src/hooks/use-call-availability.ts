import { getGetCallAvailabilityQueryKey, useGetCallAvailability } from "@workspace/api-client-react";

/** True only when the server has Agora credentials; unknown while loading. */
export function useCallAvailability() {
  const query = useGetCallAvailability({
    query: { queryKey: getGetCallAvailabilityQueryKey(), staleTime: 5 * 60_000, retry: 1 },
  });
  return { configured: query.data?.configured === true, loading: query.isLoading };
}
