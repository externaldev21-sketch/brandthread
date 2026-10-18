/**
 * The host's live video for a real (Agora) show, as an audience member.
 *
 * Joins the channel with the credentials POST /api/live/:id/join returned
 * (see apiLiveProvider.rtcFromJoin) only while the page is the active one,
 * and leaves it the moment the viewer swipes away or closes. Until the
 * host's first frame arrives — and wherever the native SDK can't run (web,
 * Expo Go) — the show's cover sits full-bleed, the way Whatnot holds the
 * thumbnail while a show connects. If the host's video hasn't arrived after
 * LIVE_VIDEO_CONNECT_TIMEOUT_MS (or the engine fails to start), it says so
 * and offers Retry instead of waiting forever.
 */
import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { loadAgoraModule } from '@/lib/agoraAvailability';
import { FONT, FS, MEDIA } from '@/lib/theme';
import type { LiveRtcCredentials } from '@/lib/live/types';

const Agora = loadAgoraModule();

/** How long to wait for the host's first frame before offering Retry. */
export const LIVE_VIDEO_CONNECT_TIMEOUT_MS = 20_000;

export function LiveRtcVideo({
  rtc, active, posterUri, onHostLeft,
}: {
  rtc: LiveRtcCredentials | null | undefined;
  active: boolean;
  posterUri?: string | null;
  /** The broadcaster dropped out of the channel (show ended / connection lost). */
  onHostLeft?: () => void;
}) {
  const [hostUid, setHostUid] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped by Retry to rebuild the engine and rejoin.
  const [attempt, setAttempt] = useState(0);
  const engineRef = useRef<any>(null);
  const onHostLeftRef = useRef(onHostLeft);
  onHostLeftRef.current = onHostLeft;

  useFocusEffect(useCallback(() => {
    if (!Agora || !active || !rtc) return undefined;
    const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = Agora;
    let engine: any;
    let gotVideo = false;
    setFailed(false);
    // Never sit on the cover forever: no host frame in time → Retry.
    const timeout = setTimeout(() => { if (!gotVideo) setFailed(true); }, LIVE_VIDEO_CONNECT_TIMEOUT_MS);
    try {
      engine = createAgoraRtcEngine();
      engine.initialize({ appId: rtc.appId });
      engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
      engine.setClientRole(ClientRoleType.ClientRoleAudience);
      engine.enableVideo();
      engine.registerEventHandler({
        // react-native-agora v6 passes (connection, uid); accept either shape.
        onUserJoined: (a: any, b?: number) => {
          const uid: number = typeof a === 'number' ? a : (b as number);
          if (rtc.hostUid == null || uid === rtc.hostUid) {
            gotVideo = true;
            setFailed(false);
            setHostUid(uid);
          }
        },
        onUserOffline: (a: any, b?: number) => {
          const uid: number = typeof a === 'number' ? a : (b as number);
          if (rtc.hostUid == null || uid === rtc.hostUid) {
            setHostUid(null);
            onHostLeftRef.current?.();
          }
        },
      });
      engine.joinChannel(rtc.token || null, rtc.channelName, rtc.uid, {
        clientRoleType: ClientRoleType.ClientRoleAudience,
      });
      engineRef.current = engine;
    } catch (e) {
      console.warn('[LiveRtcVideo]', e);
      setFailed(true);
    }
    return () => {
      clearTimeout(timeout);
      setHostUid(null);
      try { engine?.leaveChannel(); engine?.release(); } catch { /* already gone */ }
      engineRef.current = null;
    };
  }, [active, rtc, attempt]));

  const Surface = Agora?.RtcSurfaceView;
  return (
    <View style={StyleSheet.absoluteFill} testID="live-rtc-video">
      {posterUri ? (
        <CachedImage source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      {Surface && hostUid != null ? (
        <Surface style={StyleSheet.absoluteFill} canvas={{ uid: hostUid }} />
      ) : null}
      {Agora && failed && hostUid == null && (
        <View style={styles.note} testID="live-rtc-failed">
          <Text style={styles.noteText}>Couldn’t connect to the live video</Text>
          <Pressable onPress={() => setAttempt(n => n + 1)} style={styles.retry} accessibilityRole="button" testID="live-rtc-retry">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {!Agora && (
        <View style={styles.note} pointerEvents="none">
          <Text style={styles.noteText}>
            {Platform.OS === 'web' ? 'Live video plays in the Brandthread app' : 'Update Brandthread to watch live video'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { position: 'absolute', left: 0, right: 0, top: '46%', alignItems: 'center', gap: 10 },
  retry: { height: 36, paddingHorizontal: 20, borderRadius: 18, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: FS.sm },
  noteText: {
    color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.sm,
    backgroundColor: MEDIA.scrim, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, overflow: 'hidden',
  },
});
