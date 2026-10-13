/**
 * Photo replies in comments (F6 item 83) — Threads 1:1, reskinned.
 *
 * Reference (Mobbin, Threads iOS):
 *   composer attach icon  https://mobbin.com/screens/cc503bb6-a3af-4358-8aac-93e5fd1dc8c7
 *   picked photo + "x"    https://mobbin.com/screens/3511218b-1ba5-44b0-b944-dbd3565c7280
 *
 *  - CommentPhotoButton: the image glyph that sits with the other composer tools.
 *  - CommentPhotoDraft:  the picked photo above the input with a round "x" in
 *    its top-right corner (removes it before sending). While uploading it shows
 *    a small spinner; a refused photo shows the server's reason under it.
 *  - CommentPhotoView:   the photo under a comment's text, rounded, sized by
 *    its aspect ratio; tap opens the shared full-screen MediaViewer.
 *  - useCommentPhotoDraft: pick → moderated upload → { media } for posting.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import MediaViewer from '@/components/chat/MediaViewer';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ApiError } from '@/lib/networkNotice';
import { apiErrorMessage } from '@/lib/safety';
import { FS, RADIUS, SP } from '@/lib/theme';
import type { CommentMedia } from '@/lib/safetyTypes';
import { uploadCommentPhoto } from '@/services/commentMediaService';
import { commentPhotoSize, uploadMimeType } from '@/lib/commentPhoto';

export { commentPhotoSize, uploadMimeType };

type AppTheme = ReturnType<typeof useAppTheme>['theme'];

// ─── Draft state ─────────────────────────────────────────────────────────────

export type CommentPhotoDraftState =
  | { status: 'uploading'; uri: string; width: number; height: number }
  | { status: 'ready'; uri: string; width: number; height: number; media: CommentMedia }
  | { status: 'error'; uri: string; width: number; height: number; message: string; retryable: boolean };

const REJECTED_FALLBACK = 'This photo can’t be shared in Brandthread. Try a different one.';
const FAILED_FALLBACK = 'That photo didn’t upload. Tap it to try again.';

export function useCommentPhotoDraft(onNotice?: (text: string) => void) {
  const [draft, setDraft] = useState<CommentPhotoDraftState | null>(null);
  const alive = useRef(true);
  const base64 = useRef<{ data: string; mimeType: string } | null>(null);
  const token = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const upload = useCallback(async (uri: string, width: number, height: number) => {
    const payload = base64.current;
    if (!payload) return;
    const mine = ++token.current;
    setDraft({ status: 'uploading', uri, width, height });
    try {
      const media = await uploadCommentPhoto(payload);
      if (!alive.current || mine !== token.current) return;
      base64.current = null;
      setDraft({ status: 'ready', uri, width, height, media });
    } catch (error) {
      if (!alive.current || mine !== token.current) return;
      const rejected = error instanceof ApiError && (error.code === 'IMAGE_REJECTED' || error.status === 400 || error.status === 413);
      if (rejected) base64.current = null;
      setDraft({
        status: 'error', uri, width, height, retryable: !rejected,
        message: rejected ? apiErrorMessage(error, REJECTED_FALLBACK) : FAILED_FALLBACK,
      });
    }
  }, []);

  const pick = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { onNotice?.('Allow photo library access in Settings to add a photo.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets?.length || !alive.current) return;
    const asset = result.assets[0];
    if (!asset.base64) { onNotice?.('We couldn’t read that photo. Try a different one.'); return; }
    base64.current = { data: asset.base64, mimeType: uploadMimeType(asset.mimeType) };
    await upload(asset.uri, asset.width ?? 1, asset.height ?? 1);
  }, [onNotice, upload]);

  const retry = useCallback(() => {
    if (draft?.status === 'error' && draft.retryable) void upload(draft.uri, draft.width, draft.height);
  }, [draft, upload]);

  const clear = useCallback(() => {
    token.current += 1;
    base64.current = null;
    setDraft(null);
  }, []);

  /** Puts a photo that failed to post back into the composer. */
  const restore = useCallback((state: CommentPhotoDraftState | null) => { setDraft(state); }, []);

  return {
    draft,
    pick,
    retry,
    clear,
    restore,
    uploading: draft?.status === 'uploading',
    blocked: draft?.status === 'error',
    media: draft?.status === 'ready' ? draft.media : null,
  };
}

// ─── Composer button ─────────────────────────────────────────────────────────

export function CommentPhotoButton({ onPress, disabled, color, style }: {
  onPress: () => void;
  disabled?: boolean;
  color: string;
  style?: object;
}) {
  return (
    <PressableScale
      style={style}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Add a photo"
      accessibilityState={{ disabled: !!disabled }}
      testID="comment-photo-button"
    >
      <Feather name="image" size={18} color={color} />
    </PressableScale>
  );
}

// ─── Draft preview (above the input) ─────────────────────────────────────────

export function CommentPhotoDraft({ draft, onRemove, onRetry }: {
  draft: CommentPhotoDraftState;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const box = commentPhotoSize(draft.width, draft.height, 160, 120);
  const canRetry = draft.status === 'error' && draft.retryable;
  // Siblings, not nested: on web every PressableScale is a <button>, and a
  // button inside a button is invalid DOM (the comments screen guards this).
  return (
    <View style={s.draftWrap} testID="comment-photo-draft">
      <View style={[s.draftPhoto, box]}>
        <CachedImage source={{ uri: draft.uri }} style={StyleSheet.absoluteFill} recyclingKey={draft.uri} />
        {draft.status === 'uploading' ? (
          <View style={s.draftSpinner} testID="comment-photo-uploading">
            <ActivityIndicator size="small" color={theme.text} />
          </View>
        ) : null}
        {canRetry ? (
          <PressableScale
            style={StyleSheet.absoluteFill}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try uploading the photo again"
            rippleEnabled={false}
            noMinHeight
          >
            <View style={s.draftSpinner}>
              <Feather name="rotate-cw" size={14} color={theme.text} />
            </View>
          </PressableScale>
        ) : null}
        <PressableScale
          style={s.draftRemove}
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Remove photo"
          testID="comment-photo-remove"
          noMinHeight
        >
          <Feather name="x" size={13} color={theme.background} />
        </PressableScale>
      </View>
      {draft.status === 'error' ? (
        <Text style={s.draftError} numberOfLines={2} accessibilityRole="alert">{draft.message}</Text>
      ) : null}
    </View>
  );
}

// ─── Photo in a comment row ──────────────────────────────────────────────────

export function CommentPhotoView({ media, compact = false }: { media: CommentMedia; compact?: boolean }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const box = commentPhotoSize(media.width, media.height, compact ? 160 : 200, compact ? 200 : 240);
  return (
    <>
      <PressableScale
        style={[s.rowPhoto, box]}
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel="Photo. Opens full screen"
        testID="comment-photo"
        rippleEnabled={false}
        noMinHeight
      >
        <CachedImage source={{ uri: media.url }} style={StyleSheet.absoluteFill} recyclingKey={media.url} />
      </PressableScale>
      {open ? <MediaViewer visible uri={media.url} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const makeStyles = (theme: AppTheme) => StyleSheet.create({
  draftWrap: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.xs, alignItems: 'flex-start' },
  draftPhoto: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  draftSpinner: {
    position: 'absolute', left: '50%', top: '50%', marginLeft: -16, marginTop: -16,
    width: 32, height: 32, borderRadius: 16, backgroundColor: theme.background,
    alignItems: 'center', justifyContent: 'center',
  },
  // Threads: a round dark "x" in the photo's top-right corner.
  draftRemove: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.text, alignItems: 'center', justifyContent: 'center',
  },
  draftError: { marginTop: SP.xs, fontSize: FS.meta, color: theme.error, maxWidth: 280 },
  rowPhoto: {
    marginTop: SP.xs + 2,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
});
