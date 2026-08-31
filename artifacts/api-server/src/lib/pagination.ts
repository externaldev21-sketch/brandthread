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