/**
 * Pure helpers for the Thread share sheet (components/ThreadShareSheet.tsx):
 * the TikTok-style "Send to" people row and the even 5-column tile grid.
 */
import { MY_USER_ID } from '@/services/socialService';
import type { Conversation, Friendship } from '@/services/socialTypes';
import { SHARE_TILE_FILL } from '@/lib/theme';

/** One person in the "Send to" row: a recent 1:1 chat or an accepted friend. */
export interface SendToTarget {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  /** Existing conversation to send straight into (recent chats). */
  conversationId?: string;
}

/** Max people in the "Send to" row before "Find friends". */
export const SEND_TO_MAX = 8;

/**
 * TikTok's first share row is people: recent 1:1 chats (newest first), then
 * accepted friends not already listed. Requests, archived and group chats
 * are left out; only real rows from the social service, never placeholders.
 */
export function buildSendToTargets(conversations: Conversation[], friends: Friendship[], max = SEND_TO_MAX): SendToTarget[] {
  const out: SendToTarget[] = [];
  const seen = new Set<string>();
  const recent = [...conversations]
    .filter(c => !c.isArchived && !c.isRequest && c.participants.filter(p => p.userId !== MY_USER_ID).length === 1)
    .sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0));
  for (const c of recent) {
    const p = c.participants.find(x => x.userId !== MY_USER_ID);
    if (!p || seen.has(p.userId)) continue;
    seen.add(p.userId);
    out.push({ userId: p.userId, name: p.name, handle: p.handle, initials: p.initials, color: p.color, conversationId: c.id });
  }
  for (const f of friends) {
    if (seen.has(f.userId)) continue;
    seen.add(f.userId);
    out.push({ userId: f.userId, name: f.name, handle: f.handle, initials: f.initials, color: f.color });
  }
  return out.slice(0, max);
}

/** Share tiles per row before a row scrolls sideways. */
export const SHARE_GRID_COLUMNS = 5;
export const SHARE_ROW_INSET = 8;

/** Tile width for an even 5-column grid across the sheet. */
export function shareTileWidth(sheetWidth: number): number {
  return Math.floor((sheetWidth - SHARE_ROW_INSET * 2) / SHARE_GRID_COLUMNS);
}

/** Lighter tile circles on dark sheets (black-on-black read as holes; audit #34). */
export const SHARE_TILE_DARK = SHARE_TILE_FILL;

export function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5;
}
