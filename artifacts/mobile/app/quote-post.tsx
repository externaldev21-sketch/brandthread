/**
 * Quote a post: add your own caption above an embedded original.
 *
 * Route: /quote-post?postId=…  (+ optional author / caption / thumb / mediaType
 * preview params passed by the share sheet so the original renders instantly).
 * Publishes through POST /api/posts with `quotedPostId`; the server applies the
 * same moderation, blocks and allowReposts rules as any other post and embeds
 * only the direct original.
 *
 * Preview / demo sessions never call the API — posting just returns.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { QuotedPostCard } from '@/components/social/QuotedPostCard';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { isUUID } from '@/lib/engagementUtils';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { QUOTE_MAX_LENGTH, quoteErrorMessage } from '@/lib/quotePost';
import { RADII } from '@/constants/radii';
import { FONT, FS } from '@/lib/theme';
import type { QuotedPostSummary } from '@/services/socialTypes';

type Params = { postId?: string; author?: string; caption?: string; thumb?: string; mediaType?: string };

export default function QuotePostScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<Params>();
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const postId = typeof params.postId === 'string' ? params.postId : '';
  const original: QuotedPostSummary = useMemo(() => ({
    id: postId,
    userId: '',
    author: { displayName: params.author ?? null, brandName: null, username: null },
    caption: params.caption ?? '',
    thumbnailUrl: params.thumb || null,
    mediaType: params.mediaType ?? 'photo',
  }), [postId, params.author, params.caption, params.thumb, params.mediaType]);

  const trimmed = caption.trim();
  const canPost = trimmed.length > 0 && postId.length > 0 && !busy;

  const submit = useCallback(async () => {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      // Demo / preview ids never reach the server.
      if (isBuyerDevPreview() || !isUUID(postId)) {
        goBackOr(router, '/');
        return;
      }
      await api.posts.create({ quotedPostId: postId, caption: trimmed, mediaType: 'photo' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      goBackOr(router, '/');
    } catch (err) {
      setError(quoteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [api, canPost, postId, router, trimmed]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Quote" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          style={styles.input}
          value={caption}
          onChangeText={(text) => { setCaption(text.slice(0, QUOTE_MAX_LENGTH)); if (error) setError(null); }}
          placeholder="Add your caption"
          placeholderTextColor={theme.subtle}
          multiline
          autoFocus
          maxLength={QUOTE_MAX_LENGTH}
          accessibilityLabel="Caption"
          testID="quote-caption-input"
        />
        <Text style={styles.counter}>{caption.length}/{QUOTE_MAX_LENGTH}</Text>
        <QuotedPostCard quotedPost={original} testID="quote-original-card" />
        {error ? <Text style={styles.error} testID="quote-error">{error}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Button label="Post" onPress={() => void submit()} loading={busy} disabled={!canPost} accessibilityLabel="Post quote" />
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: { background: string; surface: string; border: string; text: string; muted: string; error?: string }) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 12 },
  input: {
    minHeight: 132,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: RADII.input,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted },
  error: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.error ?? theme.text },
  footer: { paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.background },
});
