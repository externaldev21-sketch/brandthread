import type { RequestHandler } from "express";
import { z } from "@workspace/api-zod";
import { validateRequest } from "./validateRequest";

/**
 * Permissive zod building blocks for request bodies on legacy route handlers.
 *
 * These schemas are deliberately loose: they enforce shape (object vs array,
 * string vs number), generous size caps and array lengths, but leave business
 * rules (enums, ownership, cross-field checks, friendly error messages) to the
 * handlers that already implement them. Unknown keys are passed through so a
 * handler that reads extra fields keeps working.
 */

/** Object body; a missing body (no JSON content-type) is treated as `{}`. */
export function looseBody<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess(
    (value) => (value === undefined || value === null ? {} : value),
    z.object(shape).passthrough(),
  );
}

/** Nested object that keeps unknown keys. */
export function looseObject<T extends z.ZodRawShape>(shape: T = {} as T) {
  return z.object(shape).passthrough();
}

/** Optional, nullable string capped at `max` characters (no trimming). */
export function optText(max: number) {
  return z.string().max(max).nullish();
}

/** Required string capped at `max` characters (no trimming; emptiness is the handler's call). */
export function text(max: number) {
  return z.string().max(max);
}

/** Identifier-ish string (uuid, clerk id, slug). */
export const idString = z.string().max(200);
export const optId = idString.nullish();

/** Array of strings with caps on item count and per-item length. */
export function stringList(maxItems: number, maxLen = 200) {
  return z.array(z.string().max(maxLen)).max(maxItems);
}

/**
 * Value whose type the handler checks itself (keeping its own error message);
 * only caps string length when it is a string.
 */
export function cappedUnknown(maxLen: number) {
  return z.unknown().refine(
    (value) => typeof value !== "string" || value.length <= maxLen,
    { message: `Must be at most ${maxLen} characters` },
  );
}

/**
 * List whose type and item types the handler checks (keeping its own error
 * message for a non-array); when it IS an array, caps the item count and the
 * length of string items.
 */
export function cappedList(maxItems: number, maxLen = 500) {
  return z.unknown().superRefine((value, ctx) => {
    if (!Array.isArray(value)) return;
    if (value.length > maxItems) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must have at most ${maxItems} items` });
      return;
    }
    value.forEach((item, index) => {
      if (typeof item === "string" && item.length > maxLen) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: `Must be at most ${maxLen} characters` });
      }
    });
  });
}

/**
 * List of JSON items (objects) whose shape the handler checks; when it IS an
 * array, caps the item count and each item's serialised size.
 */
export function jsonList(maxItems: number, maxItemChars: number) {
  return z.unknown().superRefine((value, ctx) => {
    if (!Array.isArray(value)) return;
    if (value.length > maxItems) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must have at most ${maxItems} items` });
      return;
    }
    value.forEach((item, index) => {
      if (item === undefined) return;
      let size = 0;
      try {
        size = JSON.stringify(item)?.length ?? 0;
      } catch {
        size = Infinity;
      }
      if (size > maxItemChars) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: `Item is too large (max ${maxItemChars} characters)` });
      }
    });
  });
}

/** Number, or a numeric-ish string the handler coerces itself. */
export const numberish = z.union([z.number(), z.string().max(64)]);
export const optNumberish = numberish.nullish();

/** Boolean as sent by JSON or form-ish clients ("true"/"false"/1/0). */
export const boolish = z.union([z.boolean(), z.number(), z.string().max(10)]);
export const optBoolish = boolish.nullish();

/** Any JSON value with a size guard on its serialised form. */
export function jsonValue(maxChars = 100_000) {
  return z.unknown().superRefine((value, ctx) => {
    if (value === undefined) return;
    let size = 0;
    try {
      size = JSON.stringify(value)?.length ?? 0;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Value is not serialisable" });
      return;
    }
    if (size > maxChars) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Value is too large (max ${maxChars} characters)` });
    }
  });
}

/** Common text caps (kept at or above every existing client / handler limit). */
export const LIMITS = {
  caption: 10_000,
  message: 10_000,
  comment: 5_000,
  reason: 5_000,
  name: 500,
  url: 4_096,
  shortText: 1_000,
} as const;

/**
 * `validateRequest({ body })` typed so it can sit in front of handlers that
 * rely on Express's path-parameter inference (named params are strings).
 */
export function validateBody(schema: z.ZodTypeAny): RequestHandler<Record<string, string>> {
  return validateRequest({ body: schema }) as unknown as RequestHandler<Record<string, string>>;
}

/** `looseBody` plus a cap on the serialised size of the whole body. */
export function boundedBody<T extends z.ZodRawShape>(shape: T, maxChars: number) {
  return looseBody(shape).superRefine((value, ctx) => {
    let size = 0;
    try {
      size = JSON.stringify(value)?.length ?? 0;
    } catch {
      size = Infinity;
    }
    if (size > maxChars) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Request body is too large (max ${maxChars} characters)` });
    }
  });
}
