/** Pure validation for seller canned replies. */

export const QUICK_REPLY_LIMIT = 50;
export const QUICK_REPLY_TITLE_MAX = 40;
export const QUICK_REPLY_BODY_MAX = 1000;
export const QUICK_REPLY_SHORTCUT_MAX = 24;

export type QuickReplyValidation =
  | { ok: true; value: { title: string; body: string; shortcut: string | null } }
  | { ok: false; error: string };

/** Normalises "shipping", "/Shipping " or "/shipping" to "/shipping". Empty
 *  input means no shortcut. */
export function normalizeShortcut(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(/^\/+/, "").toLowerCase();
  if (!cleaned) return null;
  return `/${cleaned}`;
}

export function validateQuickReply(input: { title?: unknown; body?: unknown; shortcut?: unknown }): QuickReplyValidation {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title) return { ok: false, error: "Title is required." };
  if (title.length > QUICK_REPLY_TITLE_MAX) {
    return { ok: false, error: `Title must be ${QUICK_REPLY_TITLE_MAX} characters or fewer.` };
  }
  if (!body) return { ok: false, error: "Message is required." };
  if (body.length > QUICK_REPLY_BODY_MAX) {
    return { ok: false, error: `Message must be ${QUICK_REPLY_BODY_MAX} characters or fewer.` };
  }
  const shortcut = normalizeShortcut(input.shortcut);
  if (shortcut === undefined) return { ok: false, error: "Shortcut must be text." };
  if (shortcut !== null) {
    if (shortcut.length - 1 > QUICK_REPLY_SHORTCUT_MAX) {
      return { ok: false, error: `Shortcut must be ${QUICK_REPLY_SHORTCUT_MAX} characters or fewer.` };
    }
    if (!/^\/[a-z0-9_-]+$/.test(shortcut)) {
      return { ok: false, error: "Shortcut can use letters, numbers, dashes and underscores." };
    }
  }
  return { ok: true, value: { title, body, shortcut } };
}
