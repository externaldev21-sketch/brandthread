import compression from "compression";
import type { Request, Response } from "express";

/**
 * gzip / brotli for API responses (polish #11).
 *
 * - Brotli when the client accepts it (quality 4 — the library default, cheap
 *   on CPU), gzip otherwise. Native fetch on iOS/Android sends
 *   `Accept-Encoding: gzip, deflate, br` and decodes transparently.
 * - Bodies under 1 KB are sent as-is (not worth the CPU).
 * - Server-sent events (`text/event-stream`, the AI chat stream) are never
 *   compressed: compression buffers output, which would hold streamed tokens
 *   back until the buffer fills.
 * - Images/video are skipped by the default `compressible` check, and a
 *   response that already carries a Content-Encoding is left untouched.
 * - A caller can opt out per request with `x-no-compression`.
 */
export function shouldCompressResponse(req: Request, res: Response): boolean {
  if (req.headers["x-no-compression"]) return false;
  const type = String(res.getHeader("Content-Type") ?? "");
  if (type.includes("text/event-stream")) return false;
  if (String(req.headers.accept ?? "").includes("text/event-stream")) return false;
  return compression.filter(req, res);
}

export const responseCompression = compression({
  threshold: 1024,
  filter: shouldCompressResponse,
});
