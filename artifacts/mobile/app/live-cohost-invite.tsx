/**
 * Co-host invites — the invitee's side. Opened from the "invited you to
 * co-host" activity notification (targetType live_cohost) or directly. Shows
 * pending invites with Accept / Decline. Accepting flips this same screen to
 * the co-host stage (components/live/CohostStage.tsx) on the host's channel.
 * `&demo=1` shows a sample invite with no API calls.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { CohostStage, type CohostCreds } from '@/components/live/CohostStage';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, SP } from '@/lib/theme';
import type { LiveCohostInvite } from '@/lib/live/moderationTypes';
import { isPreviewDemoMode } from '@/lib/devPreview';

const DEMO_INVITES: LiveCohostInvite[] = [
  { streamId: 'demo', title: 'Autumn drop, first look', hostName: 'Atelier Nord', hostUsername: 'atelier.nord', hostAvatarUrl: null, createdAt: '' },
];

export default function LiveCohostInviteScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const params = useLocalSearchParams<{ streamId?: string; demo?: string }>();
  const demo = isPreviewDemoMode();
  const focusId = params.streamId ? String(params.streamId) : '';

  const [invites, setInvites] = useState<LiveCohostInvite[]>(demo ? DEMO_INVITES : []);
  const [loading, setLoading] = useState(!demo);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<{ streamId: string; creds: CohostCreds } | null>(null);

  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setFailed(false);
    try {
      const r = await api.liveCohost.invites();
      setInvites(focusId ? [...r.invites].sort((a, b) => Number(b.streamId === focusId) - Number(a.streamId === focusId)) : r.invites);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, demo, focusId]);

  useEffect(() => { void load(); }, [load]);

  async function respond(invite: LiveCohostInvite, accept: boolean) {
    setBusy(invite.streamId);
    try {
      if (!demo) {
        const r = await api.liveCohost.respond(invite.streamId, accept);
        if (accept && r.channelName && r.agoraAppId != null && r.agoraUid != null) {
          setStage({
            streamId: invite.streamId,
            creds: { channelName: r.channelName, agoraUid: r.agoraUid, agoraAppId: r.agoraAppId, token: r.token ?? '' },
          });
          return;
        }
      }
      setInvites((prev) => prev.filter((i) => i.streamId !== invite.streamId));
    } catch (e: any) {
      Alert.alert(accept ? 'Couldn’t join' : 'Couldn’t decline', e?.message ?? 'Try again.');
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (stage) {
    return <CohostStage streamId={stage.streamId} creds={stage.creds} onDone={() => goBackOr(router)} />;
  }

  const s = makeStyles(theme);
  // Publishing needs the native Agora SDK, so a browser can decline but not accept.
  const canAccept = Platform.OS !== 'web' || demo;

  return (
    <View style={s.root}>
      <ScreenHeader title="Co-host invites" onBack={() => goBackOr(router)} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : invites.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyText}>{failed ? 'Couldn’t load invites.' : 'No invites right now.'}</Text>
          {failed && <Button label="Retry" variant="secondary" size="small" onPress={() => void load()} style={{ marginTop: SP.md }} />}
        </View>
      ) : (
        <View style={[s.content, { paddingBottom: insets.bottom + SP.xl }]}>
          {invites.map((invite) => (
            <View key={invite.streamId} style={s.card}>
              <ListRow
                avatar={{ uri: invite.hostAvatarUrl, name: invite.hostName }}
                title={invite.hostName}
                subtitle={invite.title}
              />
              <View style={s.actions}>
                <View style={s.actionBtn}>
                  <Button
                    label="Decline" variant="secondary" size="small" fullWidth
                    disabled={busy === invite.streamId} onPress={() => void respond(invite, false)}
                  />
                </View>
                <View style={s.actionBtn}>
                  <Button
                    label="Accept" size="small" fullWidth
                    loading={busy === invite.streamId} disabled={!canAccept || busy === invite.streamId}
                    onPress={() => void respond(invite, true)}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  emptyText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.md },
  card: { paddingBottom: SP.sm },
  actions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm },
  actionBtn: { flex: 1 },
});
