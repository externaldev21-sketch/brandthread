/**
 * Reviews and seller replies show publicly on product and store pages, so
 * their text goes through the same public content filter as comments and
 * posts. Reviews have no "held for review" state, so (like live chat)
 * anything the filter would hold or reject is declined with the reason.
 *
 *   POST /api/reviews                 body.body       (buyer review text)
 *   POST /api/reviews/:id/reply       body.replyText  (seller reply)
 */
import type { NextFunction, Request, Response } from "express";
import { evaluateContent } from "../lib/contentModerator";

function textFor(req: Request): string | null {
  if (req.method !== "POST" || !req.body || typeof req.body !== "object") return null;
  const path = req.path.replace(/\/+$/, "");
  if (path === "" || path === "/") {
    return typeof req.body.body === "string" ? req.body.body : null;
  }
  if (/^\/[^/]+\/reply$/.test(path)) {
    return typeof req.body.replyText === "string" ? req.body.replyText : null;
  }
  return null;
}

export function reviewTextModeration(req: Request, res: Response, next: NextFunction): void {
  const text = textFor(req);
  if (!text || !text.trim()) { next(); return; }
  const decision = evaluateContent(text, "public");
  if (decision.action === "allow") { next(); return; }
  res.status(422).json({
    error: `${decision.reason} Please review the Community Guidelines.`,
    category: decision.category,
    code: "CONTENT_REJECTED",
  });
}
