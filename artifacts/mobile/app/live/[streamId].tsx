/**
 * Shared live link: https://brandthread.app/live/{streamId} (BT-320/321).
 *
 * - Signed in: straight into the stream (buyer-live), same as tapping a live
 *   in the app.
 * - Signed out: the stream's public card (host, title, LIVE) with
 *   "Log in to watch", which returns here after sign-in. Joining a stream
 *   needs an account (POST /api/live/:id/join is requireAuth), so this is
 *   the TikTok pattern for a LIVE link opened without an account.
 * - Ended or missing: says so, with one way back into the app.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { LiveAvatarRing } from '@/components/live/LiveAvatarRing';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, SP } from '@/lib/theme';

type State =
  | { kind: 'loading' }
  | { kind: 'live'; hostName: string; title: string | null; avatarUrl: string | null; viewers: number }
  | { kind: 'ended' };

export default function LiveLinkScreen() {
  const { streamId: raw } = useLocalSearchParams<{ streamId?: string }>();
  const streamId = typeof raw === 'string' ? raw : '';
  const router = useRouter();
  const api = useApi();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!streamId) { router.replace('/' as never); return; }
    if (!isLoaded) return;
    if (isSignedIn) {
      router.replace(`/buyer-live?streamId=${encodeURIComponent(streamId)}` as never);
      return;
    }
    let cancelled = false;
    (api as any).live.get(streamId)
      .then((r: { stream?: any }) => {
        if (cancelled) return;
        const s = r?.stream;
        if (!s || s.status !== 'live') { setState({ kind: 'ended' }); return; }
        setState({
          kind: 'live',
          hostName: s.brand_name || s.seller_name || 'Brandthread seller',
          title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : null,
          avatarUrl: typeof s.avatar_url === 'string' ? s.avatar_url : null,
          viewers: Number(s.viewer_count ?? 0) || 0,
        });
      })
      .catch(() => { if (!cancelled) setState({ kind: 'ended' }); });
    return () => { cancelled = true; };
  }, [api, isLoaded, isSignedIn, router, streamId]);

  const logIn = () => router.push({ pathname: '/sign-in', params: { returnTo: `/live/${streamId}` } } as never);

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ScreenHeader title="LIVE" onBack={() => goBackOr(router, '/(buyer)')} />
      {state.kind === 'loading' || (isLoaded && isSignedIn) ? (
        <ActivityIndicator color={c.foreground} style={{ marginTop: 80 }} />
      ) : state.kind === 'ended' ? (
        <View style={styles.center}>
          <Text style={[styles.title, { color: c.foreground }]}>This live has ended</Text>
          <View style={[styles.actions, { paddingBottom: insets.bottom + SP.lg }]}>
            <Button label="Go to Brandthread" fullWidth onPress={() => router.replace('/(buyer)' as never)} />
          </View>
        </View>
      ) : (
        <View style={styles.center}>
          <LiveAvatarRing live size={96}>
            <Avatar uri={state.avatarUrl} name={state.hostName} size={96} />
          </LiveAvatarRing>
          <Text style={[styles.host, { color: c.foreground }]} numberOfLines={1}>{state.hostName}</Text>
          {state.title ? (
            <Text style={[styles.streamTitle, { color: c.mutedForeground }]} numberOfLines={2}>{state.title}</Text>
          ) : null}
          {state.viewers > 0 ? (
            <Text style={[styles.viewers, { color: c.mutedForeground }]}>
              {state.viewers === 1 ? '1 watching' : `${state.viewers.toLocaleString()} watching`}
            </Text>
          ) : null}
          <View style={[styles.actions, { paddingBottom: insets.bottom + SP.lg }]}>
            <Button label="Log in to watch" fullWidth onPress={logIn} />
            <Button label="Sign up" variant="tertiary" fullWidth onPress={() => router.push('/onboarding' as never)} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', paddingHorizontal: SP.lg, paddingTop: 72 },
  host: { fontSize: FS.lg, fontFamily: FONT.semibold, marginTop: SP.lg, maxWidth: '100%' },
  streamTitle: { fontSize: FS.base, fontFamily: FONT.regular, marginTop: 6, textAlign: 'center', lineHeight: 22 },
  viewers: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 6, fontVariant: ['tabular-nums'] },
  title: { fontSize: FS.lg, fontFamily: FONT.semibold, textAlign: 'center' },
  actions: { position: 'absolute', left: SP.lg, right: SP.lg, bottom: 0, gap: SP.sm },
});
