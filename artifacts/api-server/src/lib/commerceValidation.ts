import type { RequestHandler } from "express";
import { z } from "@workspace/api-zod";
import { validateRequest } from "../middlewares/validateRequest";

/**
 * Shared building blocks for request-body schemas on the commerce routes
 * (orders, products, store, returns, shipping, ...).
 *
 * These schemas sit in front of handlers that already read `req.body`
 * loosely, so they are deliberately permissive in shape and strict only in
 * type and size:
 * - every object is `.passthrough()`, so a field the schema doesn't name still
 *   reaches the handler exactly as before;
 * - numeric fields accept a number or a numeric string when the handler
 *   coerces, and are never transformed (the handler keeps its own parsing);
 * - a missing body (Express 5 leaves `req.body` undefined when nothing was
 *   parsed) is treated as `{}`, the same as the handlers' `req.body ?? {}`.
 */

/**
 * validateRequest, typed so it doesn't pin the route's params to the generic
 * ParamsDictionary (which would widen `req.params.id` to `string | string[]`
 * in the handlers that follow); the route path keeps deciding param types.
 */
export function validateInput(schemas: Parameters<typeof validateRequest>[0]): RequestHandler<any, any, any, any> {
  return validateRequest(schemas) as RequestHandler<any, any, any, any>;
}

const MAX_SAFE_CENTS = 100_000_000; // $1,000,000

/** A request body object; unknown keys pass through untouched. */
export function bodyObject<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess(
    (value) => (value === undefined || value === null ? {} : value),
    z.object(shape).passthrough(),
  );
}

/** Route params `{ <names>: id }` — non-empty, bounded (not otherwise reshaped). */
export function idParams<K extends string>(...names: K[]) {
  const shape = Object.fromEntries(
    names.map((name) => [name, z.string().min(1).max(200)]),
  ) as Record<K, z.ZodString>;
  return z.object(shape).passthrough();
}

/** Bounded string (no trimming — the handler keeps its own normalization). */
export const str = (max: number) => z.string().max(max);

/** Integer given as a JS number or a digit string (the handler coerces). */
export function intLike(min: number, max: number) {
  return z.union([
    z.number().int().min(min).max(max),
    z
      .string()
      .trim()
      .regex(/^-?\d+$/, "Expected an integer")
      .refine((value) => {
        const n = Number(value);
        return n >= min && n <= max;
      }, `Expected an integer between ${min} and ${max}`),
  ]);
}

/** Finite number given as a JS number or a numeric string. */
export function numLike(min: number, max: number) {
  return z.union([
    z.number().finite().min(min).max(max),
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d+)?$/, "Expected a number")
      .refine((value) => {
        const n = Number(value);
        return n >= min && n <= max;
      }, `Expected a number between ${min} and ${max}`),
  ]);
}

/** Money in integer cents (number or digit string), 0..$1M. */
export const centsLike = intLike(0, MAX_SAFE_CENTS);
/** Money in integer cents as a JSON number only, 0..$1M. */
export const cents = z.number().int().min(0).max(MAX_SAFE_CENTS);

/** Boolean or the common string/number spellings handlers already accept. */
export const boolLike = z.union([
  z.boolean(),
  z.enum(["true", "false", "1", "0"]),
  z.literal(1),
  z.literal(0),
]);

/** ISO-ish date/time string (or the empty string some clients send to clear). */
export const dateLike = z.string().max(64);

/** A JSON object of arbitrary content with a bounded key count. */
export const looseRecord = z.record(z.unknown()).refine(
  (value) => Object.keys(value).length <= 200,
  "Too many fields",
);

/** Array of ids. */
export const idArray = (max = 500) => z.array(z.string().min(1).max(160)).max(max);

/** A postal address as the seller/buyer apps send it (fields are free text). */
export const addressInput = z.object({
  name: z.string().max(300).nullish(),
  company: z.string().max(300).nullish(),
  street: z.string().max(500).nullish(),
  street1: z.string().max(500).nullish(),
  street2: z.string().max(500).nullish(),
  line1: z.string().max(500).nullish(),
  line2: z.string().max(500).nullish(),
  city: z.string().max(200).nullish(),
  state: z.string().max(200).nullish(),
  zip: z.string().max(40).nullish(),
  country: z.string().max(100).nullish(),
  phone: z.string().max(60).nullish(),
  email: z.string().max(320).nullish(),
}).passthrough();

/** Parcel dimension/weight: number or numeric text (parcelInputError checks range). */
export const parcelDimension = z.union([z.number().finite(), z.string().max(40)]);
