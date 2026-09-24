/**
 * Call Screen — Agora-based 1:1 voice and video calls.
 * Gracefully degrades when the native Agora SDK is unavailable (Expo Go / web).
 *
 * Route params:
 *   conversationId   — used to fetch the Agora token
 *   participantName  — display name of the other person
 *   participantInitials
 *   participantColor — avatar background color
 *   mode             — 'voice' | 'video'
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { useApi } from '@/lib/api';
import {
  BG, PURPLE, PURPLE_DIM, BORDER,
  FG, MUTED, SUBTLE, CARD, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import NativeOnlyFeature from '@/components/NativeOnlyFeature';

// ─── Agora SDK — native only, gracefully absent on web / Expo Go ──────────────
let AgoraModule: any = null;
try {
  AgoraModule = require('react-native-agora');
} catch {}

const { width: W, height: H } = Dimensions.get('window');

const CALL_DARK  = '#0A0A14';
const MUTE_RED   = '#FF3B30';
const CTRL_BG    = 'rgba(255,255,255,0.10)';
const HANG_RED   = '#FF3B30';

// ─── Duration timer ───────────────────────────────────────────────────────────
function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Avatar circle ────────────────────────────────────────────────────────────
function AvatarCircle({
  initials, color, size = 100, label,
}: { initials: string; color: string; size?: number; label?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={[av.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
        <Text style={[av.initials, { fontSize: size * 0.38 }]}>{initials}</Text>
      </View>
      {label ? <Text style={av.label}>{label}</Text> : null}
    </View>
  );
}
const av = StyleSheet.create({
  circle:   { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontFamily: 'System', fontWeight: '700' },
  label:    { color: MUTED, fontSize: FS.sm, fontFamily: 'System' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CallScreen() {
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyFeature
        icon="phone-off"
        title="Calls are available in the mobile app"
        description="Voice and video calls use native device audio and video. Continue your conversation by message on web, or open Brandthread on iOS or Android to call."
      />
    );
  }
  return <NativeCallScreen />;
}

function NativeCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();

  const params = useLocalSearchParams<{
    conversationId: string;
    participantName: string;
    participantInitials: string;
    participantColor: string;
    myInitials?: string;
    myColor?: string;
    mode?: string;
    manufacturerCall?: string;
  }>();

  const mode             = (params.mode ?? 'voice') as 'voice' | 'video';
  const participantColor = params.participantColor ?? colors.primary;
  const participantInit  = params.participantInitials ?? '?';
  const myColor          = params.myColor ?? '#555';
  const myInit           = params.myInitials ?? 'Me';

  // Call state
  const [status, setStatus]           = useState<'connecting' | 'ringing' | 'connected' | 'ended' | 'unavailable'>('connecting');
  const [unavailableReason, setUnavailableReason] = useState('');
  const [muted, setMuted]             = useState(false);
  const [cameraOff, setCameraOff]     = useState(false);
  const [remoteUid, setRemoteUid]     = useState<number | null>(null);
  const [channelName, setChannelName] = useState('');
  const [duration, setDuration]       = useState(0);
  const [screenSharing, setScreenSharing] = useState(false);

  const engineRef  = useRef<any>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const renewalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renewalInFlightRef = useRef(false);
  const callStartedRef = useRef(false);
  const credentialsIssuedRef = useRef(false);
  const remoteJoinedRef = useRef(false);
  const terminalEventRef = useRef<'ended' | 'failed' | 'declined' | null>(null);
  // Keep one UUID per lifecycle type. If an SDK callback repeats or an API
  // request is retried, the server receives the same idempotency key.
  const eventIdsRef = useRef<Partial<Record<'started' | 'ended' | 'failed' | 'declined', string>>>({});

  function clientEventIdFor(type: 'started' | 'ended' | 'failed' | 'declined') {
    const existing = eventIdsRef.current[type];
    if (existing) return existing;
    const clientEventId = randomUUID();
    eventIdsRef.current[type] = clientEventId;
    return clientEventId;
  }

  /**
   * A terminal lifecycle event is recorded at most once per screen instance.
   * The server independently authorizes the manufacturer thread, so a failed
   * best-effort audit request must never change call UI or retry indefinitely.
   */
  function emitTerminalEvent(type: 'ended' | 'failed' | 'declined') {
    if (params.manufacturerCall !== '1' || !params.conversationId || terminalEventRef.current) return;
    terminalEventRef.current = type;
    void api.call.event({
      threadId: params.conversationId,
      type,
      mode,
      clientEventId: clientEventIdFor(type),
    }).catch(() => {});
  }

  function closeAfterRenewalFailure() {
    if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
    renewalTimerRef.current = null;
    setUnavailableReason('The call dropped. Try calling again.');
    setStatus('unavailable');
    try {
      engineRef.current?.leaveChannel();
      engineRef.current?.release();
    } catch {}
    engineRef.current = null;
    emitTerminalEvent('failed');
  }

  async function renewCallToken() {
    const engine = engineRef.current;
    if (
      params.manufacturerCall !== '1'
      || !engine
      || !callStartedRef.current
      || renewalInFlightRef.current
    ) return;

    renewalInFlightRef.current = true;
    try {
      const renewed = await api.call.renew({
        threadId: params.conversationId,
        mode,
        clientRenewalId: randomUUID(),
      });
      if (engineRef.current !== engine || !callStartedRef.current) return;
      const result = engine.renewToken(renewed.token);
      if (typeof result === 'number' && result < 0) {
        throw new Error(`Agora token renewal failed (${result})`);
      }
      scheduleTokenRenewal(renewed.expiresAt);
    } catch {
      if (engineRef.current === engine) closeAfterRenewalFailure();
    } finally {
      renewalInFlightRef.current = false;
    }
  }

  function scheduleTokenRenewal(expiresAt?: string) {
    if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
    renewalTimerRef.current = null;
    if (params.manufacturerCall !== '1' || !expiresAt) return;
    const expiry = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiry)) return;
    renewalTimerRef.current = setTimeout(
      () => void renewCallToken(),
      Math.max(1_000, expiry - Date.now() - 60_000),
    );
  }

  // ── Fetch token + init Agora ─────────────────────────────────────────────────

  const initCall = useCallback(async () => {
    if (!params.conversationId) {
      setUnavailableReason('No authorized conversation was provided for this call.');
      setStatus('unavailable');
      return;
    }

    if (!AgoraModule) {
      setUnavailableReason("Calls aren't available right now. Keep chatting by message.");
      setStatus('unavailable');
      emitTerminalEvent('failed');
      return;
    }

    let tokenData: {
      appId: string;
      token: string;
      channelName: string;
      uid: number;
      expiresAt?: string;
    } | null = null;
    try {
      tokenData = await api.call.token({
        conversationId: params.conversationId,
        mode,
      });
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (msg.includes('503') || msg.includes('not configured')) {
        setUnavailableReason("Calls aren't available right now. Keep chatting by message.");
        setStatus('unavailable');
        return;
      }
      if (msg.includes('403') || msg.includes('participant')) {
        setUnavailableReason('Only participants in this conversation can join its calls.');
      } else {
        setUnavailableReason('The call could not be started. Check your connection and try again.');
      }
      setStatus('unavailable');
      emitTerminalEvent('failed');
      return;
    }

    if (!tokenData?.appId || !tokenData.channelName) {
      setUnavailableReason("Calls aren't available right now. Keep chatting by message.");
      setStatus('unavailable');
      emitTerminalEvent('failed');
      return;
    }
    setChannelName(tokenData.channelName);
    credentialsIssuedRef.current = true;

    const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = AgoraModule;

    try {
      const engine = createAgoraRtcEngine();
      engine.initialize({ appId: tokenData.appId });
      engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);

      if (mode === 'video') {
        engine.enableVideo();
        engine.startPreview();
      } else {
        engine.enableAudio();
      }

      engine.registerEventHandler({
        onJoinChannelSuccess: () => {
          setStatus('ringing');
          callStartedRef.current = true;
          if (params.manufacturerCall === '1') {
            void api.call.event({
              threadId: params.conversationId,
              type: 'started',
              mode,
              clientEventId: clientEventIdFor('started'),
            }).catch(() => {});
          }
        },
        onUserJoined: (connection: any, uid: number) => {
          setRemoteUid(uid);
          remoteJoinedRef.current = true;
          setStatus('connected');
          timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
        },
        onUserOffline: () => {
          setRemoteUid(null);
          clearInterval(timerRef.current!);
          setStatus('ended');
          emitTerminalEvent('ended');
          setTimeout(() => router.back(), 1500);
        },
        onTokenPrivilegeWillExpire: () => {
          void renewCallToken();
        },
        onError: (err: any) => {
          console.warn('[Agora call error]', err);
          clearInterval(timerRef.current!);
          setUnavailableReason('The call ended because of a device or connection error. Continue the conversation by message.');
          setStatus('unavailable');
          emitTerminalEvent('failed');
        },
      });

      engine.joinChannel(
        tokenData.token || null,
        tokenData.channelName,
        tokenData.uid,
        { clientRoleType: ClientRoleType.ClientRoleBroadcaster },
      );

      engineRef.current = engine;
      setStatus('ringing');
      scheduleTokenRenewal(tokenData.expiresAt);
    } catch (e) {
      console.warn('[Agora init]', e);
      setUnavailableReason('Calling is not supported by this device or app build. Continue the conversation by message.');
      setStatus('unavailable');
      emitTerminalEvent('failed');
    }
  }, [api, mode, params.conversationId]);

  useEffect(() => {
    initCall();
    return () => {
      clearInterval(timerRef.current!);
      if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
      renewalTimerRef.current = null;
      if (callStartedRef.current || credentialsIssuedRef.current) {
        emitTerminalEvent(remoteJoinedRef.current ? 'ended' : 'declined');
      }
      try {
        engineRef.current?.leaveChannel();
        engineRef.current?.release();
      } catch {}
    };
  }, []);

  // ── Controls ─────────────────────────────────────────────────────────────────

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    engineRef.current?.muteLocalAudioStream(next);
  }

  function toggleCamera() {
    const next = !cameraOff;
    setCameraOff(next);
    if (next) {
      engineRef.current?.disableVideo();
    } else {
      engineRef.current?.enableVideo();
    }
  }

  function toggleScreenShare() {
    if (!AgoraModule || !engineRef.current) return;
    const next = !screenSharing;
    setScreenSharing(next);
    try {
      if (next) {
        engineRef.current?.startScreenCapture?.({});
      } else {
        engineRef.current?.stopScreenCapture?.();
      }
    } catch {}
  }

  function handleHangUp() {
    clearInterval(timerRef.current!);
    if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
    renewalTimerRef.current = null;
    emitTerminalEvent(remoteJoinedRef.current ? 'ended' : 'declined');
    try {
      engineRef.current?.leaveChannel();
      engineRef.current?.release();
    } catch {}
    router.back();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const isConnected = status === 'connected';
  const RtcView = AgoraModule?.RtcSurfaceView ?? null;

  // Status line
  const statusText =
    status === 'connecting' ? 'Connecting…' :
    status === 'ringing'    ? 'Calling…' :
    status === 'connected'  ? (duration > 0 ? formatDuration(duration) : 'Connected') :
    status === 'unavailable' ? 'Unavailable' :
                              'Call ended';

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom + SP.lg }]}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={handleHangUp}
          style={s.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerName} numberOfLines={1}>{params.participantName ?? 'Call'}</Text>
          <Text style={s.headerStatus}>{statusText}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* ── Video area ─────────────────────────────────────────────────────── */}
      <View style={s.videoArea}>
        {status === 'unavailable' ? (
          <View style={s.unavailable}>
            <View style={s.unavailableIcon}>
              <Feather name="phone-off" size={30} color={MUTE_RED} />
            </View>
            <Text style={s.unavailableTitle}>Call unavailable</Text>
            <Text style={s.unavailableText}>{unavailableReason}</Text>
            <TouchableOpacity style={[s.messageButton, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
              <Feather name="message-circle" size={17} color={colors.primaryForeground} />
              <Text style={[s.messageButtonText, { color: colors.primaryForeground }]}>Return to messages</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>

        {/* Remote video / avatar */}
        {mode === 'video' && isConnected && remoteUid != null && RtcView && !cameraOff ? (
          <View style={s.remoteVideo}>
            <RtcView
              uid={remoteUid}
              style={{ flex: 1 }}
              channelId={channelName}
            />
          </View>
        ) : (
          /* Always show avatars in voice mode or when camera is off */
          <View style={s.avatarArea}>
            {isConnected && remoteUid != null ? (
              /* Both participants visible */
              <View style={s.avatarRow}>
                <AvatarCircle
                  initials={myInit}
                  color={myColor}
                  size={90}
                  label="You"
                />
                <AvatarCircle
                  initials={participantInit}
                  color={participantColor}
                  size={90}
                  label={params.participantName ?? ''}
                />
              </View>
            ) : (
              /* Waiting for remote — show large remote avatar */
              <View style={{ alignItems: 'center', gap: SP.md }}>
                <AvatarCircle
                  initials={participantInit}
                  color={participantColor}
                  size={120}
                />
                <Text style={s.callingText}>{params.participantName ?? 'Unknown'}</Text>
                <View style={s.callingDots}>
                  {status === 'connecting' || status === 'ringing' ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : null}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Local video preview — small, top-right corner */}
        {mode === 'video' && isConnected && RtcView && !cameraOff && (
          <View style={s.localVideoBox}>
            <RtcView
              uid={0}
              style={{ flex: 1, borderRadius: RADIUS.md }}
              channelId={channelName}
              setupMode={1} // VideoViewSetupMode.VideoViewSetupAdd
            />
          </View>
        )}
        {mode === 'video' && isConnected && cameraOff && (
          <View style={s.localVideoBox}>
            <View style={[s.localCameraOff, { backgroundColor: myColor }]}>
              <Text style={s.localCameraOffInitials}>{myInit}</Text>
            </View>
          </View>
        )}
          </>
        )}
      </View>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      {status !== 'unavailable' && <View style={s.controls}>
        {/* Mute */}
        <TouchableOpacity
          style={[s.ctrlBtn, muted && s.ctrlBtnActive]}
          onPress={toggleMute}
          activeOpacity={0.8}
        >
          <Feather
            name={muted ? 'mic-off' : 'mic'}
            size={24}
            color={muted ? MUTE_RED : FG}
          />
          <Text style={[s.ctrlLabel, muted && { color: MUTE_RED }]}>
            {muted ? 'Unmute' : 'Mute'}
          </Text>
        </TouchableOpacity>

        {/* Camera — video only */}
        {mode === 'video' && (
          <TouchableOpacity
            style={[s.ctrlBtn, cameraOff && s.ctrlBtnActive]}
            onPress={toggleCamera}
            activeOpacity={0.8}
          >
            <Feather
              name={cameraOff ? 'camera-off' : 'camera'}
              size={24}
              color={cameraOff ? MUTE_RED : FG}
            />
            <Text style={[s.ctrlLabel, cameraOff && { color: MUTE_RED }]}>
              {cameraOff ? 'Camera on' : 'Camera off'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Hang up */}
        <TouchableOpacity
          style={[s.ctrlBtn, s.hangUpBtn]}
          onPress={handleHangUp}
          activeOpacity={0.8}
        >
          <Feather name="phone-off" size={26} color="#fff" />
          <Text style={[s.ctrlLabel, { color: '#fff' }]}>End</Text>
        </TouchableOpacity>

        {/* Screen share — video only */}
        {mode === 'video' && (
          <TouchableOpacity
            style={[s.ctrlBtn, screenSharing && s.ctrlBtnActive]}
            onPress={toggleScreenShare}
            activeOpacity={0.8}
          >
            <Feather name="monitor" size={24} color={screenSharing ? colors.primary : FG} />
            <Text style={[s.ctrlLabel, screenSharing && { color: colors.primary }]}>
              {screenSharing ? 'Stop share' : 'Share'}
            </Text>
          </TouchableOpacity>
        )}
      </View>}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CALL_DARK,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  headerStatus: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 2,
  },
  videoArea: {
    flex: 1,
    position: 'relative',
  },
  remoteVideo: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    margin: SP.sm,
  },
  avatarArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    gap: SP.xl,
    alignItems: 'center',
  },
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
  },
  unavailableIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,59,48,0.14)',
    marginBottom: SP.md,
  },
  unavailableTitle: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    marginBottom: SP.sm,
  },
  unavailableText: {
    color: MUTED,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 360,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    marginTop: SP.xl,
  },
  messageButtonText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  callingText: {
    fontSize: FS.xl,
    fontFamily: FONT.semibold,
    color: FG,
    textAlign: 'center',
  },
  callingDots: {
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localVideoBox: {
    position: 'absolute',
    top: SP.md,
    right: SP.md,
    width: 90,
    height: 120,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: BORDER,
  },
  localCameraOff: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localCameraOffInitials: {
    color: '#fff',
    fontSize: 22,
    fontFamily: FONT.bold,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SP.lg,
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
  },
  ctrlBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: CTRL_BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  ctrlBtnActive: {
    backgroundColor: 'rgba(255,59,48,0.15)',
    borderColor: 'rgba(255,59,48,0.30)',
  },
  ctrlLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: FG,
    textAlign: 'center',
  },
  hangUpBtn: {
    backgroundColor: HANG_RED,
    borderColor: HANG_RED,
    width: 76,
    height: 76,
    borderRadius: 38,
  },
});
