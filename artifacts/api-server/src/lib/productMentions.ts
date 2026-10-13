/**
 * Product mentions in captions — pure input rules (no DB).
 *
 * A mention links a readable label inside the caption (normally the product's
 * name, inserted by the composer's product picker) to one of the author's own
 * active products. The caption keeps the label as plain text; readers resolve
 * it through `productMentions` on post reads.
 *
 * Rules:
 *   - at most MAX_PRODUCT_MENTIONS per post
 *   - productId must be a UUID; label is trimmed, 1..MAX_MENTION_LABEL chars
 *   - the label must appear verbatim in the caption
 *   - one mention per product (first one wins)
 *   - `position` is the caption order (index of the label's first occurrence)
 */
export const MAX_PRODUCT_MENTIONS = 10;
export const MAX_MENTION_LABEL = 80;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MentionInput = { productId: string; label: string; position: number };
export type MentionParseResult =
  | { ok: true; mentions: MentionInput[] }
  | { ok: false; code: "INVALID_MENTIONS" | "TOO_MANY_MENTIONS" | "LABEL_NOT_IN_CAPTION"; error: string };

export function parseProductMentions(raw: unknown, caption: string): MentionParseResult {
  if (!Array.isArray(raw)) {
    return { ok: false, code: "INVALID_MENTIONS", error: "mentions must be an array" };
  }
  const seen = new Set<string>();
  const out: Array<{ productId: string; label: string; at: number }> = [];
  for (const item of raw) {
    const productId = typeof item?.productId === "string" ? item.productId.trim().toLowerCase() : "";
    const label = typeof item?.label === "string" ? item.label.trim().replace(/\s+/g, " ") : "";
    if (!UUID_RE.test(productId) || label.length === 0 || label.length > MAX_MENTION_LABEL) {
      return { ok: false, code: "INVALID_MENTIONS", error: "Each mention needs a productId and a label" };
    }
    if (seen.has(productId)) continue;
    const at = caption.indexOf(label);
    if (at < 0) {
      return { ok: false, code: "LABEL_NOT_IN_CAPTION", error: `"${label}" is not in the caption` };
    }
    seen.add(productId);
    out.push({ productId, label, at });
  }
  if (out.length > MAX_PRODUCT_MENTIONS) {
    return { ok: false, code: "TOO_MANY_MENTIONS", error: `You can mention up to ${MAX_PRODUCT_MENTIONS} products` };
  }
  out.sort((a, b) => a.at - b.at);
  return { ok: true, mentions: out.map((m, position) => ({ productId: m.productId, label: m.label, position })) };
}

/** Labels a post can carry, with their reader-facing text. */
export const POST_LABEL_TEXT = { bts: "Behind the scenes" } as const;
export function isPostLabel(value: unknown): value is keyof typeof POST_LABEL_TEXT {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(POST_LABEL_TEXT, value);
}
