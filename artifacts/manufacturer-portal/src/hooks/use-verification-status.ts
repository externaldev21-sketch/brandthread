import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, useApiRequest } from "@/lib/api";

export type VerificationStatus = {
  status: "pending_verification" | "verified" | "rejected";
  missing: Array<"email" | "phone" | "payouts">;
  /** One plain line of what's missing, or null when nothing is. */
  message: string | null;
};

export const VERIFICATION_STATUS_KEY = ["manufacturer-verification-status"] as const;

/** Light-vetting state: pending profiles can't send payable cards or appear in the directory. */
export function useVerificationStatus() {
  const request = useApiRequest();
  return useQuery<VerificationStatus, ApiRequestError>({
    queryKey: VERIFICATION_STATUS_KEY,
    queryFn: () => request<VerificationStatus>("/api/manufacturers/me/verification"),
    staleTime: 60_000,
    retry: false,
  });
}
