/**
 * Slim pill at the top of the feed showing real posting progress after the
 * composer hands off (item 118, Mobbin ref: Instagram's own posting-progress
 * row — see docs/creation-flows.md row 9). Reads the shared
 * lib/postUploadProgress.ts store — same progress source the iOS Live
 * Activity (lib/uploadLiveActivity.ts) is driven from, not a forked model.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { Glass } from '@/components/ui/Glass';
import { FONT, FS, SP, TEXT_SECONDARY } from '@/lib/theme';
import { ALLOW_DEV_TOOLS } from '@/lib/buildFlags';
import {
  usePostUploadEntry, dismissPostUpload,
  startPostUpload, updatePostUploadProgress, completePostUpload, failPostUpload,
} from '@/lib/postUploadProgress';
import { radius } from '@/constants/radii';

// Same __DEV__ / EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST OR every other
// screenshot/e2e-only hook in this codebase uses (see lib/devPreview.ts) —
// checked here directly rather than via isBuyerDevPreview()/
// isSellerDevPreview() because those also require a live ?bt_preview= query
// param, which client-side routing can strip from the address bar by the
// time this effect runs after a navigation; the env/dev-build check alone
// is enough to stay inert in a real production build.
const IS_TEST_BUILD = Platform.OS === 'web' && ALLOW_DEV_TOOLS;

export function UploadProgressPill({ topInset }: { topInset: number }) {
  const entry = usePostUploadEntry();

  // Screenshot/e2e-only bridge — lets scripts/upload-progress-pill-screenshots.mjs
  // drive this real component directly instead of chasing a fragile full
  // composer -> background-persist -> navigation chain. See IS_TEST_BUILD
  // above for why this doesn't use isBuyerDevPreview()/isSellerDevPreview().
  useEffect(() => {
    if (!IS_TEST_BUILD) return;
    (window as any).__btUploadProgress = {
      startPostUpload, updatePostUploadProgress, completePostUpload, failPostUpload,
    };
  }, []);

  if (!entry) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: topInset + 6 }]}
      testID="upload-progress-pill"
    >
      <PressableScale
        onPress={() => {
          if (entry.status === 'failed') entry.retry?.();
          else if (entry.status === 'success') dismissPostUpload(entry.id);
        }}
        style={styles.pill}
        accessibilityLabel={
          entry.status === 'failed' ? 'Upload failed. Tap to retry.'
            : entry.status === 'success' ? 'Thread posted'
              : 'Posting your Thread'
        }
      >
        <Glass solid radius={radius.sm} style={StyleSheet.absoluteFill} />
        {entry.thumbnailUri ? (
          <Image source={{ uri: entry.thumbnailUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Feather name="image" size={14} color="#fff" />
          </View>
        )}
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.status === 'failed' ? 'Upload failed' : entry.status === 'success' ? 'Posted' : 'Posting your Thread…'}
          </Text>
          {entry.status === 'uploading' && (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(entry.progress * 100)}%` }]} />
            </View>
          )}
          {entry.status === 'failed' && (
            <Text style={styles.subtitle} numberOfLines={1}>Tap to retry</Text>
          )}
        </View>
        {entry.status === 'success' ? (
          // Success check is always white — no colored accent, monochrome only.
          <Feather name="check" size={16} color="#fff" />
        ) : entry.status === 'failed' ? (
          <Feather name="alert-circle" size={16} color="#fff" />
        ) : null}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm,
    maxWidth: '86%', overflow: 'hidden',
  },
  thumb: { width: 28, height: 28, borderRadius: 6 },
  thumbFallback: { backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  textCol: { flexShrink: 1, minWidth: 80 },
  title: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.xs },
  subtitle: { color: TEXT_SECONDARY, fontFamily: FONT.regular, fontSize: FS.xs - 1, marginTop: 1 },
  track: { height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 5, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#fff', borderRadius: 1.5 },
});
