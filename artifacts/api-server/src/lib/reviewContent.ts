/**
 * Pure rules for buyer review content: length limits, the fit chips, photo
 * path ownership, and the public row shape (verified-purchase flag, seller
 * reply, helpful count). No I/O here so every rule is unit-testable.
 */
export const REVIEW_BODY_MAX = 1000;
export const REVIEW_REPLY_MAX = 1000;
export const MAX_REVIEW_PHOTOS = 4;
export const MAX_REVIEW_PHOTO_BYTES = 8 * 1024 * 1024;

export const FIT_NOTES = {
  "Runs small": -1,
  "True to size": 0,
  "Runs large": 1,
} as const;
export type FitNote = keyof typeof FIT_NOTES;

/** `undefined`/empty -> no fit answer; an unknown label -> null (invalid). */
export function parseFitNote(raw: unknown): { fitNote: FitNote; fitScale: number } | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  const hit = (Object.keys(FIT_NOTES) as FitNote[]).find((k) => k.toLowerCase() === raw.trim().toLowerCase());
  return hit ? { fitNote: hit, fitScale: FIT_NOTES[hit] } : null;
}

export function reviewPhotoPrefix(buyerId: string): string {
  return `/objects/reviews/${buyerId.replace(/[^A-Za-z0-9_-]/g, "_")}/`;
}

/**
 * Photos must be object paths this buyer uploaded through POST /photos, so a
 * review can never point at someone else's object or an arbitrary URL.
 */
export function validateReviewPhotos(
  raw: unknown,
  buyerId: string,
): { ok: true; photos: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, photos: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "photos must be a list" };
  if (raw.length > MAX_REVIEW_PHOTOS) return { ok: false, error: `Add up to ${MAX_REVIEW_PHOTOS} photos.` };
  const prefix = reviewPhotoPrefix(buyerId);
  const seen = new Set<string>();
  for (const p of raw) {
    if (typeof p !== "string" || !p.startsWith(prefix) || p.includes("..") || p.length > 300) {
      return { ok: false, error: "One of the photos is not valid. Upload it again." };
    }
    seen.add(p);
  }
  return { ok: true, photos: [...seen] };
}

export function normalizeReviewBody(raw: unknown): { ok: true; body: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, body: null };
  if (typeof raw !== "string") return { ok: false, error: "body must be text" };
  const body = raw.trim();
  if (body.length > REVIEW_BODY_MAX) return { ok: false, error: `Reviews can be up to ${REVIEW_BODY_MAX} characters.` };
  return { ok: true, body: body || null };
}

type Row = Record<string, any>;

/**
 * Extra public fields layered onto toPublicReview(). Accepts drizzle (camel)
 * or raw SQL (snake) rows. `verifiedPurchase` is derived from the order link,
 * never from client input; the order id itself is not exposed.
 */
export function reviewExtras(r: Row, opts: { photos: string[]; helpfulCount: number; viewerHelpful: boolean }) {
  const orderId = r.orderId ?? r.order_id ?? null;
  const reply = r.sellerReply ?? r.seller_reply ?? null;
  const repliedAt = r.sellerRepliedAt ?? r.seller_replied_at ?? null;
  const name = r.buyer_name ?? null;
  return {
    verifiedPurchase: !!orderId,
    verifiedBuyer: !!orderId,
    sellerReply: reply,
    sellerRepliedAt: repliedAt,
    sizeBought: r.sizeBought ?? r.size_bought ?? null,
    fitNote: r.fitNote ?? r.fit_note ?? null,
    fitScale: r.fitScale ?? r.fit_scale ?? null,
    photos: opts.photos,
    helpfulCount: opts.helpfulCount,
    viewerHelpful: opts.viewerHelpful,
    ...(name !== null ? { buyerName: name, buyerAvatar: r.buyer_avatar ?? null } : {}),
  };
}
