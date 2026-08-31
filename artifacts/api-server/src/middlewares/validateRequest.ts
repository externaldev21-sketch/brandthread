import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "@workspace/api-zod";

type RequestSchemas = {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
};

function validationError(res: Response, issues: z.ZodIssue[]): void {
  res.status(400).json({
    error: "Invalid request",
    code: "VALIDATION_ERROR",
    details: issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    })),
  });
}

function replaceRequestValue(req: Request, key: "body" | "query" | "params", value: unknown): void {
  if (key === "body") {
    req.body = value;
    return;
  }
  Object.defineProperty(req, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const key of ["params", "query", "body"] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const parsed = schema.safeParse(req[key]);
      if (!parsed.success) {
        validationError(res, parsed.error.issues);
        return;
      }
      replaceRequestValue(req, key, parsed.data);
    }
    next();
  };
}

export const requestPrimitives = {
  uuid: z.string().uuid(),
  id: z.string().trim().min(1).max(160),
  shortText: z.string().trim().min(1).max(160),
  longText: z.string().trim().min(1).max(5_000),
  moneyCents: z.coerce.number().int().min(0).max(100_000_000),
  url: z.string().url().max(2_048),
  email: z.string().trim().toLowerCase().email().max(320),
  boolean: z.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((value) => value === true || value === "true" || value === "1"),
  stringArray: z.array(z.string().trim().min(1).max(160)).max(100),
} as const;

const mutationEnvelopeSchema = z.record(z.unknown()).superRefine((value, ctx) => {
  if (Object.keys(value).length > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Request body has too many fields",
    });
  }
});

/**
 * Baseline validation for JSON mutations. Route-specific schemas still enforce
 * business fields; this prevents arrays/primitives and pathological object
 * shapes from reaching legacy write handlers.
 */
export const validateMutationEnvelope: RequestHandler = (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  if (Buffer.isBuffer(req.body) || req.body === undefined) {
    next();
    return;
  }
  const parsed = mutationEnvelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error.issues);
    return;
  }
  req.body = parsed.data;
  next();
};