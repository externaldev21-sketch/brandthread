/**
 * aiSafetyGuard - the single hook every AI tool route mounts.
 *
 *   router.use("/logo", tc, requirePlan("growth"), aiSafetyGuard("logo"), logoRouter);
 *
 * On POST/PUT/PATCH from a signed-in user it:
 *   1. filters the request text (local denylist + OpenAI moderation when a key
 *      is configured) and answers 422 { error, code: "AI_PROMPT_BLOCKED" }
 *      before any paid model is called;
 *   2. wraps res.json so any generated image in the response (b64_json and
 *      friends) is moderated first - flagged output is replaced by
 *      422 { error, code: "AI_OUTPUT_BLOCKED" }; clean output gets
 *      `ai_generated: true` and its hash is recorded as provenance.
 *
 * Signed-out requests pass straight through (the route's own auth answers
 * them) so this never spends moderation calls for anonymous traffic.
 * Route internals are not touched: this works purely at mount level.
 */
import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { checkPrompt, PROMPT_BLOCK_MESSAGES, type PromptMode } from "../lib/aiSafety/promptFilter";
import {
  AI_OUTPUT_BLOCKED_MESSAGE,
  AI_OUTPUT_UNAVAILABLE_MESSAGE,
  moderateGeneratedImage,
  sha256Hex,
} from "../lib/aiSafety/outputModeration";
import { recordAiProvenance } from "../lib/aiSafety/provenance";
import { logger } from "../lib/logger";

export interface AiSafetyOptions {
  /** "media" = full rules (likeness, brands, characters). "chat" = safety rules only. */
  mode?: PromptMode;
  /** Which request strings to read. "all" = every text field; "user-turn" = only the latest typed message. Default: all for media, user-turn for chat. */
  scan?: "all" | "user-turn";
  /** Moderate + label generated images in JSON responses. Default true for media, false for chat. */
  output?: boolean;
  /** Test seams. */
  getUserId?: (req: Request) => string | null;
  recordProvenance?: (input: { ownerId: string; tool: string; sha256: string }) => Promise<void>;
}

const MAX_TEXT_CHARS = 6000;
const IMAGE_KEYS = new Set(["b64_json", "image_b64", "imageBase64", "imageB64"]);
const CHAT_TEXT_KEYS = new Set(["message", "content", "text", "prompt", "query", "question"]);
const MAX_IMAGES = 8;

function looksBinary(s: string): boolean {
  if (s.startsWith("data:")) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return s.length > 600 && !/\s/.test(s.slice(0, 600));
}

/** All human-written strings in a JSON body (media mode). */
export function collectPromptStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || out.length > 60) return out;
  if (typeof value === "string") {
    if (value.trim() && !looksBinary(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value.slice(0, 30)) collectPromptStrings(v, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectPromptStrings(v, out, depth + 1);
  }
  return out;
}

/** Chat mode: only what the user typed this turn (message/content/text, or the last user message). */
export function collectChatStrings(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const out: string[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (CHAT_TEXT_KEYS.has(k) && typeof v === "string" && !looksBinary(v)) out.push(v);
  }
  const messages = b["messages"];
  if (Array.isArray(messages)) {
    const lastUser = [...messages].reverse().find((m) => m && typeof m === "object" && (m as any).role === "user") as any;
    if (lastUser) {
      if (typeof lastUser.content === "string") out.push(lastUser.content);
      else if (Array.isArray(lastUser.content)) {
        for (const part of lastUser.content) if (part && typeof part.text === "string") out.push(part.text);
      }
    }
  }
  return out;
}

/** Finds base64 images in a response body. Returns [holder, key, buffer] triples. */
export function findGeneratedImages(body: unknown): Array<{ buffer: Buffer }> {
  const found: Array<{ buffer: Buffer }> = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || found.length >= MAX_IMAGES || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (IMAGE_KEYS.has(k) && typeof val === "string" && val.length > 100) {
        found.push({ buffer: Buffer.from(val, "base64") });
      } else if (val && typeof val === "object") {
        walk(val, depth + 1);
      }
    }
  };
  walk(body, 0);
  return found;
}

function defaultGetUserId(req: Request): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

export function aiSafetyGuard(tool: string, options: AiSafetyOptions = {}) {
  const mode: PromptMode = options.mode ?? "media";
  const moderateOutput = options.output ?? mode === "media";
  const getUserId = options.getUserId ?? defaultGetUserId;
  const record = options.recordProvenance ?? recordAiProvenance;

  return async function aiSafetyGuardMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") return next();
      const userId = getUserId(req);
      if (!userId) return next();

      // 1. Prompt filter.
      const strings = (options.scan ?? (mode === "chat" ? "user-turn" : "all")) === "user-turn" ? collectChatStrings(req.body) : collectPromptStrings(req.body);
      const text = strings.join("\n").slice(0, MAX_TEXT_CHARS);
      if (text.trim()) {
        const verdict = await checkPrompt(text, mode);
        if (!verdict.allowed) {
          logger.info({ tool, userId, category: verdict.category, source: verdict.source }, "AI prompt blocked");
          res.status(422).json({
            error: PROMPT_BLOCK_MESSAGES[verdict.category],
            code: "AI_PROMPT_BLOCKED",
            category: verdict.category,
            retryable: false,
          });
          return;
        }
      }

      // 2. Output filter + provenance label.
      if (moderateOutput) {
        const originalJson = res.json.bind(res) as (body?: unknown) => Response;
        let sent = false;
        res.json = ((body?: unknown): Response => {
          if (sent || res.statusCode >= 300 || !body || typeof body !== "object") return originalJson(body);
          const images = findGeneratedImages(body);
          if (images.length === 0) return originalJson(body);
          sent = true;
          void (async () => {
            try {
              const verdicts = await Promise.all(images.map((i) => moderateGeneratedImage(i.buffer)));
              const blocked = verdicts.find((v) => v.status === "blocked");
              const unavailable = verdicts.find((v) => v.status === "unavailable");
              if (blocked || unavailable) {
                logger.info({ tool, userId, blocked: Boolean(blocked) }, "AI output withheld");
                res.status(blocked ? 422 : 503);
                originalJson({
                  error: blocked ? AI_OUTPUT_BLOCKED_MESSAGE : AI_OUTPUT_UNAVAILABLE_MESSAGE,
                  code: blocked ? "AI_OUTPUT_BLOCKED" : "AI_OUTPUT_UNAVAILABLE",
                  retryable: true,
                });
                return;
              }
              for (const i of images) void record({ ownerId: userId, tool, sha256: sha256Hex(i.buffer) });
              originalJson(Array.isArray(body) ? body : { ...(body as object), ai_generated: true });
            } catch (err) {
              logger.error({ err, tool }, "AI output guard failed");
              if (!res.headersSent) {
                res.status(502);
                originalJson({ error: AI_OUTPUT_UNAVAILABLE_MESSAGE, code: "AI_OUTPUT_UNAVAILABLE", retryable: true });
              }
            }
          })();
          return res;
        }) as typeof res.json;
      }
      next();
    } catch (err) {
      // Fail-safe: a bug in the guard must not take the tool down.
      logger.error({ err, tool }, "aiSafetyGuard error");
      if (!res.headersSent) next();
    }
  };
}
