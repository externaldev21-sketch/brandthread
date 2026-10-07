/**
 * Co-host stage — what an accepted co-host sees while publishing on the
 * host's channel. Native only (Agora publishing needs the native SDK); the
 * caller never mounts it on web. Joins the SAME channel as the host with the
 * publisher token from POST /api/live/:id/cohost/respond, shows the local
 * camera, the live viewer count and the chat, and lets the co-host leave.
 * If the host removes the co-host (`cohost_removed` over the live socket) or
 * the stream ends, the co-host is taken off stage.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { loadAgoraModule } from '@/lib/agoraAvailability';
import { useUser } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Button } from '@/components/ui/Button';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useLiveSocket, type LiveSocketEvent } from '@/lib/live/useLiveSocket';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

const AgoraModule = loadAgoraModule();

export interface CohostCreds {
  channelName: string;
  agoraUid: number;
  agoraAppId: string;
  token: string;
}

interface Props {
  streamId: string;
  creds: CohostCreds;
  /** Called once the co-host is off stage (left, removed, or stream ended). */
  onDone: () => void;
}

export function CohostStage({ streamId, creds, onDone }: Props) {
  const { theme } = useAppTheme();
  const api = useApi();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const s = React.useMemo(() => makeStyles(theme), [theme]);

  const [viewerCount, setViewerCount] = useState(0);
  const [comments, setComments] = useState<Array<{ id: string; display_name: string; message: string }>>([]);
  const [leaving, setLeaving] = useState(false);
  const engineRef = useRef<any>(null);
  const doneRef = useRef(false);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    engineRef.current = null;
    onDone();
  }

  useEffect(() => {
    if (!AgoraModule || !creds.agoraAppId) return;
    const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = AgoraModule;
    try {
      const engine = createAgoraRtcEngine();
      engine.initialize({ appId: creds.agoraAppId });
      engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.enableVideo();
      engine.startPreview();
      engine.registerEventHandler({ onError: (err: any) => console.warn('[Agora cohost]', err) });
      engine.joinChannel(creds.token || null, creds.channelName, creds.agoraUid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      });
      engineRef.current = engine;
    } catch (e) {
      console.warn('[Agora cohost init]', e);
    }
    return () => {
      try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    };
  }, [creds.agoraAppId, creds.channelName, creds.agoraUid, creds.token]);

  const onEvent = React.useCallback((event: LiveSocketEvent) => {
    if (event.type === 'viewerCount') setViewerCount(event.count);
    else if (event.type === 'comment') setComments((prev) => [...prev, event.comment].slice(-40));
    else if (event.type === 'comment_removed') setComments((prev) => prev.filter((c) => c.id !== event.commentId));
    else if (event.type === 'cohost_removed' && event.userId === user?.id) {
      Alert.alert('Removed from the live', 'The host took you off stage.');
      finish();
    } else if (event.type === 'ended') {
      // The host ended the live (routes/live.ts → lib/liveEnd.ts).
      Alert.alert('The live ended', 'The host ended this live.');
      finish();
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLiveSocket({
    streamId, enabled: true, asHost: true, onEvent, onConnected: () => {}, onFallback: () => {},
  });

  async function leave() {
    setLeaving(true);
    try { await api.liveCohost.leave(streamId); } catch {}
    finish();
  }

  const Camera = AgoraModule ? AgoraModule.RtcSurfaceView : null;

  return (
    <View style={s.root}>
      {Camera ? (
        <Camera canvas={{ uid: 0, renderMode: 1 }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.placeholder]}>
          <Feather name="video" size={48} color={theme.muted} />
          <Text style={s.placeholderText}>Camera preview available on device</Text>
        </View>
      )}

      <View style={[s.topBar, { paddingTop: topInset + 8 }]}>
        <View style={s.topLeft}>
          <View style={s.livePill}>
            <View style={s.liveDot} />
            <Text style={s.livePillText}>LIVE</Text>
          </View>
          <View style={s.countPill}>
            <Feather name="eye" size={13} color={theme.text} />
            <Text style={s.countText}>{viewerCount.toLocaleString()}</Text>
          </View>
        </View>
        <Button label="Leave" variant="destructive" size="compact" onPress={() => void leave()} loading={leaving} />
      </View>

      <View style={[s.chat, { paddingBottom: insets.bottom + SP.md }]} pointerEvents="none">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.chatContent}>
          {comments.map((c) => (
            <Text key={c.id} style={s.chatLine}>
              <Text style={s.chatName}>{c.display_name} </Text>{c.message}
            </Text>
          ))}
        </ScrollView>
      </View>
      {leaving && <ActivityIndicator style={StyleSheet.absoluteFill} color={theme.text} />}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: theme.background },
  placeholderText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingHorizontal: 40 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 5, backgroundColor: LIVE_RED,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.onAccent },
  livePillText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 1.5 },
  countPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.card,
  },
  countText: { color: theme.text, fontFamily: FONT.semibold, fontSize: 12 },
  chat: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: 220, paddingHorizontal: SP.md },
  chatContent: { gap: 4 },
  chatLine: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.meta },
  chatName: { fontFamily: FONT.bold },
});
