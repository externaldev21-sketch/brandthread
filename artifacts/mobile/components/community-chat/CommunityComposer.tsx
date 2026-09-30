/**
 * Composer for the community group chat — the DM composer look (camera circle
 * + text pill + send) minus voice / products / orders / Thread Cash, with
 * photo staging on top: each picked photo uploads through the moderated
 * endpoint BEFORE the message is sent, and a rejected photo shows a calm
 * inline note on its own thumbnail with a remove button.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { PressableScale } from '@/components/BrandthreadUI';
import MediaUploadThumb from '@/components/chat/MediaUploadThumb';
import UploadRing from '@/components/chat/UploadRing';
import { ReplyBanner } from '@/components/chat/ReplyBanner';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { messagePreviewText } from '@/lib/chatGrouping';
import { hapticPrimaryAction } from '@/lib/haptics';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { ApiError } from '@/lib/networkNotice';
import { apiErrorMessage } from '@/lib/safety';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import type { CommunityAttachment } from '@/lib/communities/types';
import type { DisplayMessage } from '@/lib/communities/chatMerge';
import type { SendOutcome } from './useCommunityChat';

/** Links the message list's KeyboardGestureArea to this TextInput (interactive keyboard dismiss). */
export const COMMUNITY_CHAT_INPUT_ID = 'community-chat-composer-input';

const MAX_PHOTOS = 5;
const MAX_TEXT = 4000;
const THUMB = 64;
const COMPOSER_CONTROL = 36;
const COMPOSER_LINE_HEIGHT = 20;
const COMPOSER_MAX_LINES = 5;
const COMPOSER_TEXT_V_PADDING = SP.sm;

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
  /** Safe-area bottom inset — the composer clears the home indicator itself. */
  bottomInset: number;
}

export function CommunityComposer({ onSend, uploadPhoto, replyTo, onCancelReply, onNotice, bottomInset }: CommunityComposerProps) {
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

  const lines = Math.min(Math.max(text.split('\n').length, 1), COMPOSER_MAX_LINES);
  const inputHeight = lines * COMPOSER_LINE_HEIGHT + COMPOSER_TEXT_V_PADDING * 2;
  const bottomPad = Platform.OS === 'web' ? 16 : bottomInset + SP.sm;

  return (
    <View style={s.wrap}>
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

      <View style={s.inputRow}>
        <PressableScale
          rippleEnabled={false}
          bounce={false}
          onPress={() => { hapticPrimaryAction(); void handlePickPhoto(); }}
          style={s.cameraBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="community-attach"
          accessibilityRole="button"
          accessibilityLabel="Add photos"
        >
          <Feather name="image" size={18} color={theme.onAccent} />
        </PressableScale>

        <View style={s.pill}>
          <TextInput
            nativeID={COMMUNITY_CHAT_INPUT_ID}
            style={[s.textInput, WEB_INPUT_RESET, { height: inputHeight }]}
            value={text}
            onChangeText={handleChangeText}
            placeholder="Message the group…"
            placeholderTextColor={theme.muted}
            multiline
            maxLength={MAX_TEXT}
            autoCapitalize="sentences"
            testID="community-input"
            accessibilityLabel="Message"
            onKeyPress={Platform.OS === 'web' ? (e: any) => {
              // Web hardware-keyboard Enter sends; Shift+Enter still inserts a newline.
              if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            } : undefined}
          />
          <PressableScale
            rippleEnabled={false}
            bounce={false}
            noMinHeight
            disabled={!canSend}
            onPress={() => { void handleSend(); }}
            style={[s.sendBtn, { backgroundColor: canSend ? theme.accent : theme.cardElevated }]}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            testID="community-send"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
          >
            {uploading
              ? <UploadRing size={ICON.md - 4} color={theme.muted} />
              : <Feather name="arrow-up" size={COMPOSER_CONTROL * 0.55} color={canSend ? theme.onAccent : theme.muted} />}
          </PressableScale>
        </View>
      </View>

      {inlineNote && (
        <View style={s.inlineNote} testID="community-inline-note">
          <Feather name="info" size={14} color={theme.muted} style={{ marginTop: 1 }} />
          <Text style={[s.noteText, { color: theme.muted, flex: 1 }]}>{inlineNote}</Text>
        </View>
      )}
      <View style={{ height: bottomPad }} />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  wrap: { backgroundColor: theme.background },
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
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: SP.sm,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
  },
  cameraBtn: {
    width: COMPOSER_CONTROL, height: COMPOSER_CONTROL, borderRadius: COMPOSER_CONTROL / 2,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2, backgroundColor: theme.accent,
  },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: theme.cardElevated, borderRadius: RADIUS.xxl,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    paddingLeft: SP.md, paddingRight: SP.xs, gap: SP.sm,
    minHeight: COMPOSER_CONTROL + SP.sm,
  },
  textInput: {
    flex: 1,
    paddingVertical: COMPOSER_TEXT_V_PADDING,
    fontSize: FS.base, lineHeight: COMPOSER_LINE_HEIGHT, fontFamily: FONT.regular, color: theme.text,
    textAlignVertical: 'center',
    maxHeight: COMPOSER_LINE_HEIGHT * COMPOSER_MAX_LINES + COMPOSER_TEXT_V_PADDING * 2,
    minHeight: COMPOSER_CONTROL,
    marginBottom: SP.xs,
    ...(Platform.OS === 'web' ? { paddingTop: COMPOSER_TEXT_V_PADDING, paddingBottom: COMPOSER_TEXT_V_PADDING } : null),
  },
  sendBtn: {
    width: COMPOSER_CONTROL, height: COMPOSER_CONTROL, borderRadius: COMPOSER_CONTROL / 2,
    alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs,
  },
  inlineNote: { flexDirection: 'row', gap: 6, paddingHorizontal: SP.md + SP.xs, paddingTop: SP.xs },
});
