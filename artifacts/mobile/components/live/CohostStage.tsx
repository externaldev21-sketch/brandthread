/**
 * Co-host stage — what an accepted co-host sees while publishing on the
 * host's channel. Native only (Agora publishing needs the native SDK); the
 * caller never mounts it on web. Joins the SAME channel as the host with the
 * publisher token from POST /api/live/:id/cohost/respond, shows the local
 * camera, the live viewer count and the chat, and lets the co-host leave.
 * If the host removes the co-host (`cohost_removed` over the live socket) or
 * the stream ends (`ended`, emitted by api-server lib/liveEnd.ts), the camera
 * stops and a short "The live ended" / "You're off stage" state shows before
 * the stage closes. If Agora can't start, can't join within 15s or loses the
 * connection for good, the stage says so and offers Leave. The publisher token is
 * short-lived and renewed on Agora's token-privilege-will-expire through
 * POST /api/live/:id/cohost/token; a refused renewal also ends the stage.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { loadAgoraModule } from '@/lib/agoraAvailability';
import { useUser } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { showAlert } from '@/lib/actionSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Button } from '@/components/ui/Button';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useLiveSocket, type LiveSocketEvent } from '@/lib/live/useLiveSocket';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { CohostProductsSheet } from './CohostProductsSheet';

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
  // Co-host bag: add your own products to the host's live.
  const [productsOpen, setProductsOpen] = useState(false);
  const engineRef = useRef<any>(null);
  const chatRef = useRef<ScrollView>(null);
  const doneRef = useRef(false);
  // Connection: 'joining' until Agora confirms, 'reconnecting' on a blip,
  // 'lost' when Agora gives up, 'failed' when it never started / joined.
  const [conn, setConn] = useState<'joining' | 'live' | 'reconnecting' | 'lost' | 'failed'>('joining');
  // Taken off stage by the server (live ended / host removed you / token refused).
  const [offStage, setOffStage] = useState<{ title: string; body: string } | null>(null);
  const offStageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (offStageTimer.current) clearTimeout(offStageTimer.current); }, []);

  function stopEngine() {
    try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    engineRef.current = null;
  }

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    if (offStageTimer.current) { clearTimeout(offStageTimer.current); offStageTimer.current = null; }
    stopEngine();
    onDone();
  }

  /** Stop publishing now, show why for a moment, then close the stage. */
  function takeOffStage(title: string, body: string) {
    if (doneRef.current || offStageTimer.current) return;
    stopEngine();
    setOffStage({ title, body });
    offStageTimer.current = setTimeout(finish, 2500);
  }

  useEffect(() => {
    if (!AgoraModule || !creds.agoraAppId) return;
    const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = AgoraModule;
    // Agora's ConnectionStateType: 1 disconnected, 3 connected, 4 reconnecting, 5 failed.
    const CS = AgoraModule.ConnectionStateType ?? {};
    const CONNECTED = CS.ConnectionStateConnected ?? 3;
    const RECONNECTING = CS.ConnectionStateReconnecting ?? 4;
    const FAILED = CS.ConnectionStateFailed ?? 5;
    let joined = false;
    // Never joined within 15s: say so instead of an endless black stage.
    const joinTimer = setTimeout(() => { if (!joined) setConn((c) => (c === 'joining' ? 'failed' : c)); }, 15_000);
    try {
      const engine = createAgoraRtcEngine();
      engine.initialize({ appId: creds.agoraAppId });
      engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.enableVideo();
      engine.startPreview();
      engine.registerEventHandler({
        onError: (err: any) => console.warn('[Agora cohost]', err),
        onJoinChannelSuccess: () => { joined = true; setConn('live'); },
        onRejoinChannelSuccess: () => setConn('live'),
        onConnectionLost: () => setConn('reconnecting'),
        onConnectionStateChanged: (_conn: unknown, state: number) => {
          if (state === CONNECTED) { joined = true; setConn('live'); }
          else if (state === RECONNECTING) setConn('reconnecting');
          else if (state === FAILED) setConn(joined ? 'lost' : 'failed');
        },
        // Co-host tokens are short-lived (api-server lib/liveCohost.ts
        // COHOST_TOKEN_TTL_SECONDS). Renew before expiry; the server refuses
        // once the co-host was removed / left, the live ended or a block
        // exists — then the co-host leaves the stage.
        onTokenPrivilegeWillExpire: () => { void renewToken(); },
        onRequestToken: () => { void renewToken(); },
      });
      engine.joinChannel(creds.token || null, creds.channelName, creds.agoraUid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      });
      engineRef.current = engine;
    } catch (e) {
      console.warn('[Agora cohost init]', e);
      setConn('failed');
    }
    return () => {
      clearTimeout(joinTimer);
      try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    };
  }, [creds.agoraAppId, creds.channelName, creds.agoraUid, creds.token]);

  const renewingRef = useRef(false);
  async function renewToken() {
    if (renewingRef.current || doneRef.current) return;
    renewingRef.current = true;
    try {
      const fresh = await api.liveCohost.token(streamId);
      engineRef.current?.renewToken(fresh.token);
    } catch {
      takeOffStage('You’re off stage', 'You’re no longer a co-host on this live.');
    } finally {
      renewingRef.current = false;
    }
  }

  const onEvent = React.useCallback((event: LiveSocketEvent) => {
    if (event.type === 'viewerCount') setViewerCount(event.count);
    else if (event.type === 'comment') setComments((prev) => [...prev, event.comment].slice(-40));
    else if (event.type === 'comment_removed') setComments((prev) => prev.filter((c) => c.id !== event.commentId));
    else if (event.type === 'cohost_removed' && event.userId === user?.id) {
      takeOffStage('You’re off stage', 'The host took you off stage.');
    } else if (event.type === 'removed') {
      takeOffStage('You’re off stage', 'You can’t rejoin this live.');
    } else if (event.type === 'ended') {
      // The host ended the live (routes/live.ts → lib/liveEnd.ts emits 'ended').
      takeOffStage('The live ended', 'The host ended this live. Thanks for co-hosting!');
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLiveSocket({
    streamId, enabled: true, asHost: true, onEvent, onConnected: () => {}, onFallback: () => {},
  });

  async function leave() {
    setLeaving(true);
    try {
      await api.liveCohost.leave(streamId);
    } catch {
      // Retry once in the background so the server doesn't keep listing us;
      // if that fails too, say so (the host can still remove you).
      const retryLeave = api.liveCohost.leave;
      setTimeout(() => {
        retryLeave(streamId).catch(() => {
          showAlert('You left the stage', 'We couldn’t tell the host. They may still see you listed as a co-host until they remove you.');
        });
      }, 1500);
    }
    finish();
  }

  const Camera = AgoraModule ? AgoraModule.RtcSurfaceView : null;

  return (
    <View style={s.root}>
      {Camera ? (
        <Camera canvas={{ uid: 0, renderMode: 1 }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.placeholder]}>
          <Icon name="video" size={48} color={theme.muted} />
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
            <Icon name="eye" size={13} color={theme.text} />
            <Text style={s.countText}>{viewerCount.toLocaleString()}</Text>
          </View>
        </View>
        <View style={s.topRight}>
          <Button label="Products" variant="secondary" size="compact" icon="shopping-bag" onPress={() => setProductsOpen(true)} testID="cohost-products" />
          <Button label="Leave" variant="destructive" size="compact" onPress={() => void leave()} loading={leaving} />
        </View>
      </View>

      <View style={[s.chat, { paddingBottom: insets.bottom + SP.md }]} pointerEvents="none">
        <ScrollView
          ref={chatRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.chatContent}
          onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
        >
          {comments.map((c) => (
            <Text key={c.id} style={s.chatLine}>
              <Text style={s.chatName}>{c.display_name} </Text>{c.message}
            </Text>
          ))}
        </ScrollView>
      </View>
      {(conn === 'reconnecting' || conn === 'lost') && !offStage && (
        <View style={[s.connBanner, { top: topInset + 56 }]} testID="cohost-connection">
          <Text style={s.connText}>{conn === 'reconnecting' ? 'Reconnecting…' : 'Connection lost. Viewers can’t see you.'}</Text>
        </View>
      )}
      {conn === 'failed' && !offStage && (
        <View style={[StyleSheet.absoluteFill, s.overlay]} testID="cohost-join-failed">
          <Text style={s.overlayTitle}>Couldn’t join the live</Text>
          <Text style={s.overlayBody}>Your camera couldn’t connect to the host’s live. Leave and try accepting again.</Text>
          <Button label="Leave" variant="destructive" onPress={() => void leave()} loading={leaving} style={{ marginTop: SP.md }} />
        </View>
      )}
      {offStage && (
        <View style={[StyleSheet.absoluteFill, s.overlay]} testID="cohost-off-stage">
          <Text style={s.overlayTitle}>{offStage.title}</Text>
          <Text style={s.overlayBody}>{offStage.body}</Text>
          <Button label="Done" variant="secondary" onPress={finish} style={{ marginTop: SP.md }} />
        </View>
      )}
      {leaving && <ActivityIndicator style={StyleSheet.absoluteFill} color={theme.text} />}
      <CohostProductsSheet streamId={streamId} myId={user?.id} visible={productsOpen} onClose={() => setProductsOpen(false)} />
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
  topRight: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 5, backgroundColor: LIVE_RED,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.onAccent },
  livePillText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: 12 },
  countPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.card,
  },
  countText: { color: theme.text, fontFamily: FONT.semibold, fontSize: 12, fontVariant: ['tabular-nums'] },
  chat: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: 220, paddingHorizontal: SP.md },
  chatContent: { gap: 4 },
  chatLine: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.meta },
  chatName: { fontFamily: FONT.bold },
  connBanner: {
    position: 'absolute', alignSelf: 'center', zIndex: 11, borderRadius: RADIUS.pill,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.card,
  },
  connText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.meta },
  overlay: { zIndex: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: theme.background },
  overlayTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center' },
  overlayBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginTop: SP.xs },
});
