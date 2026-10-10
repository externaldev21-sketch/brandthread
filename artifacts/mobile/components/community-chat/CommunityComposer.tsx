/**
 * Composer for the community group chat — the shared slim <Composer/> (which
 * also hides the floating tab bar) with an image button on the left, minus
 * voice / products / orders / Thread Cash, and photo staging in its top slot: each picked photo uploads through the moderated
 * endpoint BEFORE the message is sent, and a rejected photo shows a calm
 * inline note on its own thumbnail with a remove button.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { PressableScale } from '@/components/BrandthreadUI';
import Composer from '@/components/ui/Composer';
import MediaUploadThumb from '@/components/chat/MediaUploadThumb';
import { ReplyBanner } from '@/components/chat/ReplyBanner';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { messagePreviewText } from '@/lib/chatGrouping';
import { hapticPrimaryAction } from '@/lib/haptics';
import { ApiError } from '@/lib/networkNotice';
import { apiErrorMessage } from '@/lib/safety';
import { FONT, FS, SP } from '@/lib/theme';
import type { CommunityAttachment } from '@/lib/communities/types';
import type { DisplayMessage } from '@/lib/communities/chatMerge';
import type { SendOutcome } from './useCommunityChat';

/** Links the message list's KeyboardGestureArea to this TextInput (interactive keyboard dismiss). */
export const COMMUNITY_CHAT_INPUT_ID = 'community-chat-composer-input';

const MAX_PHOTOS = 5;
const MAX_TEXT = 4000;
const THUMB = 64;
const ATTACH_SIZE = 36;

const REJECTED_FALLBACK = 'This photo can’t be shared in Brandthread communities. Try a different one.';
const UNAVAILABLE_FALLBACK = 'We couldn’t check that photo right now. Please try again in a moment.';

type PhotoState = 'uploading' | 'ready' | 'rejected' | 'retry';

interface StagedPhoto {
  key: string;
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  state: PhotoState;
  url?: string;
  message?: string;
}

export interface CommunityComposerProps {
  onSend: (payload: { text: string; attachments: CommunityAttachment[] }) => Promise<SendOutcome>;
  uploadPhoto: (body: { data: string; mimeType: string }) => Promise<{ url: string }>;
  replyTo: DisplayMessage | null;
  onCancelReply: () => void;
  /** Quiet, transient messages (e.g. photo permission) — shown by the screen's snackbar. */
  onNotice: (text: string) => void;
}

export function CommunityComposer({ onSend, uploadPhoto, replyTo, onCancelReply, onNotice }: CommunityComposerProps) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [inlineNote, setInlineNote] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const base64Ref = useRef(new Map<string, string>());
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const patchPhoto = useCallback((key: string, patch: Partial<StagedPhoto>) => {
    if (!aliveRef.current) return;
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }, []);

  const uploadOne = useCallback(async (key: string, mimeType: string) => {
    const data = base64Ref.current.get(key);
    if (!data) { patchPhoto(key, { state: 'rejected', message: 'We couldn’t read that photo. Try a different one.' }); return; }
    patchPhoto(key, { state: 'uploading', message: undefined });
    try {
      const { url } = await uploadPhoto({ data, mimeType });
      base64Ref.current.delete(key);
      patchPhoto(key, { state: 'ready', url });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IMAGE_REJECTED') {
        base64Ref.current.delete(key);
        patchPhoto(key, { state: 'rejected', message: apiErrorMessage(e, REJECTED_FALLBACK) });
      } else if (e instanceof ApiError && e.code === 'IMAGE_CHECK_UNAVAILABLE') {
        patchPhoto(key, { state: 'retry', message: apiErrorMessage(e, UNAVAILABLE_FALLBACK) });
      } else {
        patchPhoto(key, { state: 'retry', message: 'That photo didn’t upload. Check your connection and try again.' });
      }
    }
  }, [patchPhoto, uploadPhoto]);

  const handlePickPhoto = useCallback(async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) { onNotice(`You can share up to ${MAX_PHOTOS} photos at a time.`); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { onNotice('Allow photo library access in Settings to share photos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets.length || !aliveRef.current) return;
    const picked = result.assets.slice(0, room);
    const staged: StagedPhoto[] = picked.map((a, i) => ({
      key: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      uri: a.uri,
      mimeType: a.mimeType ?? 'image/jpeg',
      width: a.width,
      height: a.height,
      state: 'uploading',
    }));
    staged.forEach((p, i) => { if (picked[i].base64) base64Ref.current.set(p.key, picked[i].base64 as string); });
    setInlineNote(null);
    setPhotos((prev) => [...prev, ...staged]);
    for (const p of staged) await uploadOne(p.key, p.mimeType);
  }, [onNotice, photos.length, uploadOne]);

  const removePhoto = useCallback((key: string) => {
    base64Ref.current.delete(key);
    setPhotos((prev) => prev.filter((p) => p.key !== key));
  }, []);

  const uploading = photos.some((p) => p.state === 'uploading');
  const blocked = photos.some((p) => p.state === 'rejected' || p.state === 'retry');
  const ready = photos.filter((p) => p.state === 'ready' && p.url);
  const hasContent = text.trim().length > 0 || ready.length > 0;
  const canSend = hasContent && !uploading && !blocked;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const prevText = text;
    const prevPhotos = photos;
    const payload = {
      text: text.trim(),
      attachments: ready.map((p): CommunityAttachment => ({ type: 'image', url: p.url as string, width: p.width, height: p.height })),
    };
    hapticPrimaryAction();
    setText('');
    setPhotos([]);
    setInlineNote(null);
    const outcome = await onSend(payload);
    if (!aliveRef.current || outcome.ok || outcome.code !== 'MODERATED') return;
    // Keep the draft: hand it back (without clobbering anything typed meanwhile) and explain calmly.
    if (!textRef.current) setText(prevText);
    setPhotos((cur) => (cur.length === 0 ? prevPhotos : cur));
    setInlineNote(outcome.message);
  }, [canSend, onSend, photos, ready, text]);

  const handleChangeText = useCallback((v: string) => {
    setText(v);
    setInlineNote((n) => (n ? null : n));
  }, []);

  const topSlot = (
    <>
      {replyTo && (
        <ReplyBanner
          testID="community-reply-banner"
          theme={theme}
          fromName={replyTo.fromName}
          previewText={messagePreviewText({ text: replyTo.text, attachment: replyTo.attachments[0] ?? null })}
          onCancel={onCancelReply}
        />
      )}

      {photos.length > 0 && (
        <View style={s.stage}>
          {photos.map((p) => (
            <View key={p.key} style={s.stagedItem}>
              <View>
                <MediaUploadThumb
                  type="image"
                  uri={p.uri}
                  uploading={p.state === 'uploading'}
                  size={THUMB}
                  ringColor={theme.onAccent}
                  iconColor={theme.muted}
                  trackColor={theme.cardElevated}
                />
                <PressableScale
                  rippleEnabled={false}
                  noMinHeight
                  hitSlop={{ top: 14, bottom: 6, left: 14, right: 6 }}
                  onPress={() => removePhoto(p.key)}
                  style={[s.removeBtn, { backgroundColor: theme.accent }]}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  testID="community-photo-remove"
                >
                  <Feather name="x" size={12} color={theme.onAccent} />
                </PressableScale>
              </View>
              {(p.state === 'rejected' || p.state === 'retry') && (
                <View style={s.photoNote}>
                  <Text style={[s.noteText, { color: theme.muted }]} numberOfLines={4}>{p.message}</Text>
                  {p.state === 'retry' && (
                    <PressableScale
                      rippleEnabled={false}
                      noMinHeight
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      onPress={() => { void uploadOne(p.key, p.mimeType); }}
                      accessibilityRole="button"
                      accessibilityLabel="Try uploading again"
                    >
                      <Text style={[s.noteAction, { color: theme.text }]}>Try again</Text>
                    </PressableScale>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {inlineNote && (
        <View style={s.inlineNote} testID="community-inline-note">
          <Feather name="info" size={14} color={theme.muted} style={{ marginTop: 1 }} />
          <Text style={[s.noteText, { color: theme.muted, flex: 1 }]}>{inlineNote}</Text>
        </View>
      )}
    </>
  );

  return (
    <Composer
      testID="community"
      value={text}
      onChangeText={handleChangeText}
      onSend={() => { void handleSend(); }}
      canSend={canSend}
      placeholder="Message the group…"
      nativeID={COMMUNITY_CHAT_INPUT_ID}
      maxLength={MAX_TEXT}
      topSlot={topSlot}
      leftAccessory={
        <PressableScale
          rippleEnabled={false}
          bounce={false}
          onPress={() => { hapticPrimaryAction(); void handlePickPhoto(); }}
          style={s.attachBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="community-attach"
          accessibilityRole="button"
          accessibilityLabel="Add photos"
        >
          <Feather name="image" size={18} color={theme.onAccent} />
        </PressableScale>
      }
    />
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  stage: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, alignItems: 'flex-start',
    paddingHorizontal: SP.md, paddingTop: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
  },
  stagedItem: { maxWidth: 160 },
  removeBtn: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  photoNote: { marginTop: 4, gap: 4 },
  noteText: { fontSize: FS.xs, lineHeight: 15, fontFamily: FONT.regular },
  noteAction: { fontSize: FS.xs, fontFamily: FONT.semibold },
  attachBtn: {
    width: ATTACH_SIZE, height: ATTACH_SIZE, borderRadius: ATTACH_SIZE / 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent,
  },
  inlineNote: { flexDirection: 'row', gap: 6, paddingHorizontal: SP.md + SP.xs, paddingTop: SP.xs },
});
