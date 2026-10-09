import type { Response } from "express";
import { z } from "@workspace/api-zod";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
}).passthrough();

export type Pagination = Pick<z.infer<typeof paginationSchema>, "limit" | "offset">;

export function parsePagination(
  value: unknown,
  defaults: Partial<Pagination> = {},
): { success: true; data: Pagination } | { success: false; error: z.ZodError } {
  const parsed = paginationSchema.safeParse({
    ...(typeof value === "object" && value !== null ? value : {}),
    limit: (value as Record<string, unknown> | null)?.limit ?? defaults.limit ?? DEFAULT_PAGE_LIMIT,
    offset: (value as Record<string, unknown> | null)?.offset ?? defaults.offset ?? 0,
  });
  return parsed.success
    ? { success: true, data: { limit: parsed.data.limit, offset: parsed.data.offset } }
    : parsed;
}

export function setPaginationHeaders(
  res: Response,
  pagination: Pagination,
  returned: number,
  total?: number,
): void {
  res.setHeader("X-Pagination-Limit", String(pagination.limit));
  res.setHeader("X-Pagination-Offset", String(pagination.offset));
  res.setHeader("X-Pagination-Returned", String(returned));
  if (total !== undefined) res.setHeader("X-Pagination-Total", String(total));
}

export function paginationMetadata(
  pagination: Pagination,
  returned: number,
  total?: number,
) {
  return {
    limit: pagination.limit,
    offset: pagination.offset,
    returned,
    ...(total === undefined ? {} : { total }),
    hasMore: total === undefined
      ? returned === pagination.limit
      : pagination.offset + returned < total,
  };
}
/**
 * Opt-in pagination for legacy list endpoints that historically returned every
 * row. Callers that send no params (the shipped mobile app) keep getting the
 * same response shape with a generous default cap, and can page with
 * ?limit=&offset=. Unlike parsePagination this never rejects a request: a
 * garbage value falls back to the default, an oversized limit is clamped, so
 * no existing client can start getting 400s.
 */
export type ListPageOptions = { defaultLimit?: number; maxLimit?: number };

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 200;

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function parseListPage(query: unknown, options: ListPageOptions = {}): Pagination {
  const maxLimit = options.maxLimit ?? MAX_LIST_LIMIT;
  const defaultLimit = Math.min(options.defaultLimit ?? DEFAULT_LIST_LIMIT, maxLimit);
  const q = (typeof query === "object" && query !== null ? query : {}) as Record<string, unknown>;
  const rawLimit = Number(firstQueryValue(q.limit));
  const rawOffset = Number(firstQueryValue(q.offset));
  const limit = q.limit !== undefined && q.limit !== "" && Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(Math.floor(rawLimit), maxLimit)
    : defaultLimit;
  const offset = q.offset !== undefined && q.offset !== "" && Number.isFinite(rawOffset) && rawOffset >= 0
    ? Math.floor(rawOffset)
    : 0;
  return { limit, offset };
}

/**
 * Finishes a page that was fetched with `.limit(page.limit + 1)`: drops the
 * probe row, sets the X-Pagination-* headers (plus X-Pagination-Has-More) and
 * returns the rows to send.
 */
export function finishListPage<T>(res: Response, page: Pagination, rows: T[]): T[] {
  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  setPaginationHeaders(res, page, items.length);
  res.setHeader("X-Pagination-Has-More", hasMore ? "true" : "false");
  return items;
}
