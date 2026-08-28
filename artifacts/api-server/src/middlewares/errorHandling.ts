import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError, requestIdFor, toApiErrorEnvelope } from "../lib/apiError";

/**
 * Normalizes legacy explicit error responses at one boundary while routes are
 * incrementally migrated to ApiError. Successful response shapes are untouched.
 */
export const normalizeErrorResponses: RequestHandler = (req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 400) return sendJson(body);
    return sendJson(toApiErrorEnvelope(res.statusCode, body, requestIdFor(req.id)));
  }) as typeof res.json;
  next();
};

export const jsonNotFound: RequestHandler = (req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: `No API route exists for ${req.method} ${req.path}.`,
  });
};

export const apiErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const parserErrorType =
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    typeof err.type === "string"
      ? err.type
      : null;
  const parseFailure = parserErrorType === "entity.parse.failed";
  const payloadTooLarge = parserErrorType === "entity.too.large";
  const known = err instanceof ApiError;
  const status = known ? err.status : payloadTooLarge ? 413 : parseFailure ? 400 : 500;
  const errorCode = known
    ? err.code
    : payloadTooLarge
      ? "PAYLOAD_TOO_LARGE"
      : parseFailure
        ? "INVALID_JSON"
        : "INTERNAL_ERROR";

  req.log.error(
    {
      err,
      errorCode,
      status,
    },
    known ? "API request failed" : "Unhandled API request failure",
  );

  if (res.headersSent) {
    _next(err);
    return;
  }
  res.status(status).json(
    known
      ? { code: err.code, message: err.message, details: err.details }
      : payloadTooLarge
        ? { code: "PAYLOAD_TOO_LARGE", message: "The request is too large." }
      : parseFailure
        ? { code: "INVALID_JSON", message: "The request body is not valid JSON." }
      : { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  );
};