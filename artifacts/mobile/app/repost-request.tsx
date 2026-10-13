/**
 * A brand asked to repost your post — Instagram collab-invite pattern:
 * the Activity row opens the post with the brand's request and a "Review"
 * button; Review opens a sheet with Accept (here "Approve") / Decline.
 * Approving creates the brand's repost (it stays credited to you).
 *
 * Route: /repost-request?id=<requestId> (Activity targetType repost_request).
 * Server: GET /api/fits/repost-requests/:id, POST …/:id/respond.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ListRow } from '@/components/ui/ListRow';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { fitsErrorMessage } from '@/lib/fits';
import { fitsService, type RepostRequestDetail } from '@/services/fitsService';
import { FONT, FS, SP } from '@/lib/theme';

const STATUS_TEXT: Record<string, string> = {
  approved: 'You approved this request.',
  declined: 'You declined this request.',
  cancelled: 'This request was withdrawn.',
};

export default function RepostRequestScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [request, setRequest] = useState<RepostRequestDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setRequest((await fitsService.repostRequest(id)).request);
    } catch {
      setFailed(true);
    }
  }, [id]);

  useEffect(() => { if (id) void load(); else setFailed(true); }, [id, load]);

  const respond = useCallback(async (decision: 'approve' | 'decline') => {
    if (!request || busy) return;
    setBusy(decision);
    setError(null);
    try {
      const r = await fitsService.respondToRepostRequest(request.id, decision);
      setRequest((prev) => (prev ? { ...prev, status: r.request.status } : prev));
      setSheetOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      setError(fitsErrorMessage(err, decision === 'approve' ? 'Couldn’t approve. Try again.' : 'Couldn’t decline. Try again.'));
      void load();
    } finally {
      setBusy(null);
    }
  }, [busy, load, request]);

  const brandName = request?.brand?.name ?? 'A brand';
  const image = request?.post?.thumbnailUrl ?? null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Repost request" onBack={() => goBackOr(router)} />
      {!request ? (
        <View style={styles.center}>
          {failed ? <Text style={styles.muted}>This request is no longer available.</Text> : <ActivityIndicator color={theme.text} />}
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: SP.lg }} testID="repost-request">
            <ListRow
              avatar={{ uri: request.brand?.avatarUrl ?? null, name: brandName }}
              title={brandName}
              subtitle={request.brand?.handle || undefined}
              style={styles.brandRow}
            />
            <Text style={styles.ask}>{`${brandName} wants to repost your post.`}</Text>
            {request.post ? (
              <View style={[styles.media, { width, height: Math.round(width * 4 / 3) }]}>
                {image ? <CachedImage source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              </View>
            ) : (
              <Text style={styles.muted}>This post was removed.</Text>
            )}
            {request.post?.caption ? <Text style={styles.caption} numberOfLines={3}>{request.post.caption}</Text> : null}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {request.status === 'pending' && request.post ? (
              <Button label="Review" onPress={() => setSheetOpen(true)} accessibilityLabel="Review request" testID="repost-request-review" />
            ) : (
              <Text style={styles.status} testID="repost-request-status">{STATUS_TEXT[request.status] ?? ''}</Text>
            )}
          </View>
        </>
      )}

      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} testID="repost-request-sheet">
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{`Let ${brandName} repost your post?`}</Text>
          <Text style={styles.sheetBody}>Your post will appear on their profile, credited to you.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Approve" onPress={() => void respond('approve')} loading={busy === 'approve'} disabled={!!busy} testID="repost-request-approve" />
          <Button label="Decline" variant="secondary" onPress={() => void respond('decline')} loading={busy === 'decline'} disabled={!!busy} testID="repost-request-decline" />
        </View>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  muted: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingHorizontal: SP.md },
  brandRow: { paddingHorizontal: SP.md },
  ask: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.base, paddingHorizontal: SP.md, paddingBottom: SP.md },
  media: { backgroundColor: theme.surface },
  caption: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, paddingHorizontal: SP.md, paddingTop: SP.sm },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: theme.background },
  status: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center', paddingVertical: SP.md },
  sheet: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md, gap: SP.sm },
  sheetTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center' },
  sheetBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginBottom: SP.sm },
  error: { color: theme.error ?? theme.text, fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center' },
});
