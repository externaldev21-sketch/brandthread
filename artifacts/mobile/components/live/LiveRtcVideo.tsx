/**
 * The host's live video for a real (Agora) show, as an audience member.
 *
 * Joins the channel with the credentials POST /api/live/:id/join returned
 * (see apiLiveProvider.rtcFromJoin) only while the page is the active one,
 * and leaves it the moment the viewer swipes away or closes. Until the
 * host's first frame arrives — and wherever the native SDK can't run (web,
 * Expo Go) — the show's cover sits full-bleed, the way Whatnot holds the
 * thumbnail while a show connects.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { loadAgoraModule } from '@/lib/agoraAvailability';
import { FONT, FS, MEDIA } from '@/lib/theme';
import type { LiveRtcCredentials } from '@/lib/live/types';

const Agora = loadAgoraModule();

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
  const engineRef = useRef<any>(null);
  const onHostLeftRef = useRef(onHostLeft);
  onHostLeftRef.current = onHostLeft;

  useEffect(() => {
    if (!Agora || !active || !rtc) return undefined;
    const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = Agora;
    let engine: any;
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
          if (rtc.hostUid == null || uid === rtc.hostUid) setHostUid(uid);
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
    }
    return () => {
      setHostUid(null);
      try { engine?.leaveChannel(); engine?.release(); } catch { /* already gone */ }
      engineRef.current = null;
    };
  }, [active, rtc]);

  const Surface = Agora?.RtcSurfaceView;
  return (
    <View style={StyleSheet.absoluteFill} testID="live-rtc-video">
      {posterUri ? (
        <CachedImage source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      {Surface && hostUid != null ? (
        <Surface style={StyleSheet.absoluteFill} canvas={{ uid: hostUid }} />
      ) : null}
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
  note: { position: 'absolute', left: 0, right: 0, top: '46%', alignItems: 'center' },
  noteText: {
    color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.sm,
    backgroundColor: MEDIA.scrim, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, overflow: 'hidden',
  },
});
