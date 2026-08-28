export type ApiErrorDetails = Record<string, unknown>;

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetails;
  };
  requestId: string;
}

const STATUS_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  502: "PROVIDER_UNAVAILABLE",
  503: "SERVICE_UNAVAILABLE",
  504: "PROVIDER_TIMEOUT",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "The request is invalid.",
  401: "Authentication is required.",
  403: "You do not have permission to perform this action.",
  404: "The requested resource was not found.",
  405: "This method is not supported.",
  408: "The request timed out.",
  409: "The request conflicts with the current resource state.",
  413: "The request is too large.",
  422: "The request could not be processed.",
  429: "Too many requests. Please try again later.",
  502: "An external service is currently unavailable.",
  503: "The service is currently unavailable.",
  504: "An external service took too long to respond.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCode(value: unknown, status: number): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
    ? value
    : (STATUS_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"));
}

function safeClientMessage(status: number, body: unknown): string {
  if (status >= 500) return STATUS_MESSAGES[status] ?? "An unexpected error occurred.";
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 500);
  if (!isRecord(body)) return STATUS_MESSAGES[status] ?? "The request failed.";

  const nestedError = isRecord(body.error) ? body.error : undefined;
  const candidate =
    nestedError?.message ??
    (typeof body.message === "string" ? body.message : undefined) ??
    (typeof body.error === "string" ? body.error : undefined);
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim().slice(0, 500)
    : (STATUS_MESSAGES[status] ?? "The request failed.");
}

function safeDetails(status: number, body: unknown): ApiErrorDetails | undefined {
  if (status >= 500 || !isRecord(body)) return undefined;
  if (isRecord(body.error) && isRecord(body.error.details)) {
    return body.error.details;
  }
  if (isRecord(body.details)) return body.details;

  const entries = Object.entries(body).filter(
    ([key]) => !["error", "message", "code", "requestId", "stack"].includes(key),
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function requestIdFor(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "unavailable";
}

export function toApiErrorEnvelope(
  status: number,
  body: unknown,
  requestId: string,
): ApiErrorEnvelope {
  const nested = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const code = safeCode(nested?.code ?? (isRecord(body) ? body.code : undefined), status);
  const details = safeDetails(status, body);
  return {
    error: {
      code,
      message: safeClientMessage(status, body),
      ...(details ? { details } : {}),
    },
    requestId,
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiError";
  }
}