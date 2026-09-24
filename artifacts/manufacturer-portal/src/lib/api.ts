import { useCallback } from "react";
import { useAuth } from "@clerk/react";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/**
 * Authenticated JSON fetch for endpoints the generated client doesn't wrap
 * (Stripe Connect, order cards, timeline). Errors carry the server's plain
 * English message, status and code.
 */
export function useApiRequest() {
  const { getToken } = useAuth();
  return useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiRequestError(
        typeof body.error === "string" ? body.error : friendlyStatus(response.status),
        response.status,
        body.code,
        body.fieldErrors,
      );
    }
    return body as T;
  }, [getToken]);
}

export function friendlyStatus(status: number): string {
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "We couldn't find that.";
  if (status === 409) return "This changed somewhere else. Refresh and try again.";
  if (status === 503) return "This service isn't switched on for this server yet.";
  if (status >= 500) return "Something went wrong on our side. Try again in a moment.";
  return "The request didn't go through. Try again.";
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
