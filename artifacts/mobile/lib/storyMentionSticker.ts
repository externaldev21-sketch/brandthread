/**
 * Pure helpers for the story @mention sticker, shared by the composer
 * (app/buyer-story-create.tsx) and the viewer (app/buyer-story-viewer.tsx).
 *
 * The product rule these encode: a mention is a TAG first and a sticker
 * second. People shrink it to a speck and tuck it in a corner (or fade it
 * out) so the photo's look is untouched, and the tag still registers — the
 * server never looks at size/position/opacity. So for mention stickers the
 * composer must not clamp them into a readable size or the safe area, and the
 * viewer must keep a >=44pt tap target even when the sticker is invisible.
 */
import type { StoryOverlay, StoryOverlayType } from '@/services/socialTypes';

export type MentionStyle = NonNullable<StoryOverlay['mentionStyle']>;

/** Order the placed sticker cycles through when tapped. */
export const MENTION_STYLES: readonly MentionStyle[] = ['classic', 'outline', 'solid', 'neon'];

export const MAX_MENTIONS_PER_STORY = 10;
export const MIN_TAP_TARGET = 44;

const MAX_SCALE = 4;
const DEFAULT_MIN_SCALE = 0.4;
/** Mentions have no minimum readable size. */
export const MENTION_MIN_SCALE = 0.05;
export const MENTION_MIN_OPACITY = 0.02;

export function nextMentionStyle(current?: MentionStyle): MentionStyle {
  const i = current ? MENTION_STYLES.indexOf(current) : -1;
  return MENTION_STYLES[(i + 1) % MENTION_STYLES.length];
}

export function clampOverlayScale(type: StoryOverlayType, scale: number): number {
  const min = type === 'mention' ? MENTION_MIN_SCALE : DEFAULT_MIN_SCALE;
  if (!Number.isFinite(scale)) return 1;
  return Math.max(min, Math.min(MAX_SCALE, scale));
}

export function clampMentionOpacity(opacity: number | undefined): number {
  if (opacity == null || !Number.isFinite(opacity)) return 1;
  return Math.max(MENTION_MIN_OPACITY, Math.min(1, opacity));
}

type Canvas = { width: number; height: number };

/**
 * Where an overlay's top-left may rest after a drag. Every other sticker keeps
 * the original loose clamp; a mention may sit anywhere on the canvas — its
 * CENTRE is only kept within a hair of the canvas (so it can straddle the edge
 * or a corner, slightly off-canvas, but can never be lost entirely).
 */
export function clampOverlayPosition(
  type: StoryOverlayType,
  pos: { x: number; y: number },
  canvas: Canvas,
  size?: { width: number; height: number },
): { x: number; y: number } {
  if (type !== 'mention') {
    return {
      x: Math.max(-40, Math.min(canvas.width - 20, pos.x)),
      y: Math.max(-40, Math.min(canvas.height - 20, pos.y)),
    };
  }
  const w = size?.width ?? 0;
  const h = size?.height ?? 0;
  const slack = 12;
  const cx = Math.max(-slack, Math.min(canvas.width + slack, pos.x + w / 2));
  const cy = Math.max(-slack, Math.min(canvas.height + slack, pos.y + h / 2));
  return { x: cx - w / 2, y: cy - h / 2 };
}

/**
 * Extra touch slop (unscaled points, per side) so a sticker scaled by `scale`
 * still presents at least MIN_TAP_TARGET on screen.
 */
export function tapSlop(size: { width: number; height: number }, scale: number): { x: number; y: number } {
  const s = Math.max(scale, MENTION_MIN_SCALE);
  return {
    x: Math.max(0, (MIN_TAP_TARGET / s - size.width) / 2),
    y: Math.max(0, (MIN_TAP_TARGET / s - size.height) / 2),
  };
}

/**
 * Viewer hit rectangle (screen points) for a sticker whose unscaled top-left is
 * (x, y) and measured size is `size`: centred on the sticker, never smaller
 * than MIN_TAP_TARGET square. Rotation is ignored (the box is the axis-aligned
 * bound of the un-rotated, scaled sticker, floored at the minimum).
 */
export function mentionHitRect(
  overlay: Pick<StoryOverlay, 'x' | 'y' | 'scale'>,
  size: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const s = Math.max(overlay.scale ?? 1, MENTION_MIN_SCALE);
  const cx = overlay.x + size.width / 2;
  const cy = overlay.y + size.height / 2;
  const width = Math.max(MIN_TAP_TARGET, size.width * s);
  const height = Math.max(MIN_TAP_TARGET, size.height * s);
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

export interface TaggedPerson { userId: string; handle: string; name?: string }

/** Everyone tagged on a slide (deduped), independent of how visible the stickers are. */
export function taggedPeople(overlays: readonly StoryOverlay[] | undefined): TaggedPerson[] {
  const seen = new Set<string>();
  const out: TaggedPerson[] = [];
  for (const ov of overlays ?? []) {
    if (ov.type !== 'mention' || !ov.mentionUserId || seen.has(ov.mentionUserId)) continue;
    seen.add(ov.mentionUserId);
    out.push({ userId: ov.mentionUserId, handle: ov.mentionHandle ?? '', name: ov.mentionName });
  }
  return out;
}

/** "@name" with exactly one leading @. */
export function withAt(handle: string | null | undefined): string {
  const h = (handle ?? '').trim().replace(/^@+/, '');
  return h ? `@${h}` : '';
}

/** Route for a tagged person's profile (same shape as lib/activity.ts's 'user' case). */
export function mentionProfileHref(p: { userId: string; name?: string; handle?: string }): string {
  const params = [`userId=${encodeURIComponent(p.userId)}`];
  if (p.name) params.push(`name=${encodeURIComponent(p.name)}`);
  if (p.handle) params.push(`handle=${encodeURIComponent(withAt(p.handle))}`);
  return `/buyer-other-profile?${params.join('&')}`;
}

// ─── "@" inline suggestions in the text tool ─────────────────────────────────

/** The "@partial" token the caret is at the end of, or null. */
export function activeMentionQuery(text: string): { query: string; start: number } | null {
  const m = /(^|\s)@([A-Za-z0-9_.]{0,30})$/.exec(text);
  if (!m) return null;
  return { query: m[2], start: m.index + m[1].length };
}

export function insertMention(text: string, username: string): string {
  const tok = activeMentionQuery(text);
  const handle = `@${username.replace(/^@+/, '')} `;
  if (tok) return text.slice(0, tok.start) + handle;
  return (text && !/\s$/.test(text) ? `${text} ` : text) + handle;
}
