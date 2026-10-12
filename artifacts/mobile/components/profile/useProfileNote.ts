/**
 * The small status bubble above the avatar on a profile banner (TikTok's
 * "On your mind…" bubble) — backed by the existing 24h Notes feature
 * (POST /api/social/notes, shown in the buyer inbox tray).
 *
 *  - Visited profile: their active note, when it is in my notes tray.
 *  - Own profile: my active note; with none, buyers get the "On your mind…"
 *    prompt, which opens the inbox where notes are posted.
 * Loaded only while a banner is showing (`enabled`), refreshed on focus.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getNotesForTray } from '@/services/socialService';
import { getPreviewMyNote, getPreviewNotesForTray, isPreviewNotesEnabled } from '@/lib/previewNotes';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

export const NOTE_PROMPT = 'On your mind…';

export function useProfileNote({
  userId,
  own,
  enabled,
  onCompose,
}: {
  userId?: string | null;
  own: boolean;
  enabled: boolean;
  /** Own profile: where tapping the bubble goes (buyers: the inbox notes tray). */
  onCompose?: () => void;
}): { text: string; placeholder?: boolean; onPress?: () => void } | null {
  const [text, setText] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    let alive = true;
    const preview = isBuyerDevPreview() || isSellerDevPreview();
    if (preview) {
      // Seeded notes only under the explicit demo opt-in.
      const note = isPreviewDemoMode() && isPreviewNotesEnabled()
        ? (own ? getPreviewMyNote() : getPreviewNotesForTray().find((entry) => entry.authorId === userId) ?? null)
        : null;
      setText(note?.text ?? null);
      return () => { alive = false; };
    }
    if (!userId) { setText(null); return undefined; }
    getNotesForTray()
      .then((rows) => { if (alive) setText(rows.find((row) => row.authorId === userId)?.text ?? null); })
      .catch(() => { /* no bubble rather than a broken one */ });
    return () => { alive = false; };
  }, [enabled, own, userId]));

  if (!enabled) return null;
  if (text) return { text, onPress: own ? onCompose : undefined };
  if (own && onCompose) return { text: NOTE_PROMPT, placeholder: true, onPress: onCompose };
  return null;
}
