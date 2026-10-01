import type { Request } from "express";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pageParams(req: Request, defaults = { limit: 25, max: 100 }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? defaults.limit), 10) || defaults.limit, 1), defaults.max);
  const offset = Math.max(parseInt(String(req.query.offset ?? 0), 10) || 0, 0);
  return { limit, offset };
}

/** Escapes LIKE wildcards so admin search is a literal substring match. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function queryString(req: Request, key: string, max = 100): string {
  const raw = req.query[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function bodyString(body: unknown, key: string, max: number): string {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function clampDays(req: Request, fallback = 30): number {
  return Math.min(Math.max(parseInt(String(req.query.days ?? fallback), 10) || fallback, 1), 365);
}
