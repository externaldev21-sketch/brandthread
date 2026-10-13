/**
 * Product mentions in captions (client side).
 *
 * The caption keeps a mention's label as plain text (normally the product
 * name); the post's `productMentions` say which product each label links to.
 * Rules mirror api-server/src/lib/productMentions.ts: the label must appear
 * verbatim in the caption, one mention per product, at most 10.
 */
export const MAX_PRODUCT_MENTIONS = 10;

export interface PostProductMention {
  productId: string;
  label: string;
  name?: string;
  imageUri?: string;
  priceCents?: number;
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'product'; text: string; mention: PostProductMention };

/**
 * Splits a caption into plain text and product-mention segments. Every
 * occurrence of a label is linked; when labels overlap, the longer one wins.
 */
export function splitProductMentions(text: string, mentions: PostProductMention[] | undefined | null): MentionSegment[] {
  if (!text) return [];
  const usable = (mentions ?? []).filter((m) => m && typeof m.label === 'string' && m.label.length > 0);
  if (usable.length === 0) return [{ kind: 'text', text }];
  const byLength = [...usable].sort((a, b) => b.label.length - a.label.length);
  const out: MentionSegment[] = [];
  let cursor = 0;
  let plainStart = 0;
  while (cursor < text.length) {
    const hit = byLength.find((m) => text.startsWith(m.label, cursor));
    if (hit) {
      if (cursor > plainStart) out.push({ kind: 'text', text: text.slice(plainStart, cursor) });
      out.push({ kind: 'product', text: hit.label, mention: hit });
      cursor += hit.label.length;
      plainStart = cursor;
    } else {
      cursor += 1;
    }
  }
  if (plainStart < text.length) out.push({ kind: 'text', text: text.slice(plainStart) });
  return out;
}

/** Keeps only the mentions whose label is still in the caption (first per product, caption order). */
export function mentionsInCaption(caption: string, mentions: PostProductMention[]): PostProductMention[] {
  const seen = new Set<string>();
  return mentions
    .filter((m) => {
      if (seen.has(m.productId) || !m.label || !caption.includes(m.label)) return false;
      seen.add(m.productId);
      return true;
    })
    .sort((a, b) => caption.indexOf(a.label) - caption.indexOf(b.label))
    .slice(0, MAX_PRODUCT_MENTIONS);
}

/** Inserts a label at the cursor with single spaces around it. */
export function insertMentionLabel(caption: string, cursor: number, label: string, max: number): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, caption.length));
  const before = caption.slice(0, at);
  const after = caption.slice(at);
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trail = after.length > 0 && /^\s/.test(after) ? '' : ' ';
  const text = `${before}${lead}${label}${trail}${after}`;
  if (text.length > max) return { text: caption, cursor: at };
  return { text, cursor: before.length + lead.length + label.length + trail.length };
}

/** Maps a server `productMentions` entry to the client shape. */
export function mapApiProductMentions(raw: unknown): PostProductMention[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m: any) => (m && typeof m.productId === 'string' && typeof m.label === 'string'
    ? [{
        productId: m.productId,
        label: m.label,
        name: typeof m.name === 'string' ? m.name : undefined,
        imageUri: Array.isArray(m.images) && typeof m.images[0] === 'string' ? m.images[0] : undefined,
        priceCents: typeof m.priceCents === 'number' ? m.priceCents : undefined,
      }]
    : []));
}

export const BTS_LABEL_TEXT = 'Behind the scenes';
