/**
 * InCallView — the `connected` status, for both voice and video. Mirrors
 * Instagram's in-call screen: minimize chevron top-left (no top-right
 * "people" icon — we're 1:1 only, group calls aren't supported so that icon
 * is skipped entirely, not just left empty), a local-camera PiP card for
 * video calls, the peer's avatar centered (with "{name}'s camera is off"
 * once their camera drops), and the bottom control capsule.
 *
 * Voice calls reuse the same avatar+name+duration treatment
 * app/call-screen.tsx already uses for its voice layout (a big centered
 * avatar with the running duration beneath it) — see `formatCallDuration`
 * in ./CallControls, lifted from that screen's `formatDuration` helper.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCallSession } from '@/lib/calls/CallSessionContext';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';
import { CallAvatarCircle } from './CallAvatarCircle';
import {
  CallScreenShell, ControlButton, ControlCapsule, TopBarIconButton, formatCallDuration,
} from './CallControls';

export function InCallView() {
  const { theme } = useAppTheme();
  const {
    session, minimize, declineOrEndCall, toggleMute, toggleCameraOff, toggleSpeaker,
  } = useCallSession();
  const [durationSec, setDurationSec] = useState(0);

  useEffect(() => {
    if (!session?.connectedAt) return;
    const connectedAt = session.connectedAt;
    const tick = () => setDurationSec(Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.connectedAt]);

  if (!session) return null;
  const {
    peer, me, mode, muted, cameraOff, peerCameraOff, speakerOn,
  } = session;
  const isVideo = mode === 'video';
  const showScrim = isVideo && peerCameraOff;

  return (
    <CallScreenShell
      topLeft={<TopBarIconButton name="chevron-down" onPress={minimize} accessibilityLabel="Minimize call" />}
      style={showScrim ? { backgroundColor: theme.background } : undefined}
    >
      {/* Dark scrim standing in for a blurred camera-off backdrop — no live
          camera feed in the simulated provider, so a plain dark overlay is
          used rather than a fake blurred photo. */}
      {showScrim && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.card, opacity: 0.55 }]} />}

      {isVideo && (
        <View
          accessibilityLabel={`${me.name}'s camera preview`}
          style={[styles.pip, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          {/* No live local camera feed in the simulated provider (PR1) — the
              PiP always shows the self-avatar fallback, camera on or off. */}
          <View style={[styles.pipFallback, { backgroundColor: me.color }]}>
            <Text style={[TYPE_SCALE.footnote, styles.pipInitials]}>{me.initials}</Text>
          </View>
        </View>
      )}

      <View style={styles.center}>
        {showScrim ? (
          <CallAvatarCircle
            name={peer.name}
            initials={peer.initials}
            color={peer.color}
            avatarUri={peer.avatarUri}
            size={56}
            subtitle={`${peer.name}'s camera is off`}
            gap={10}
          />
        ) : (
          <CallAvatarCircle
            name={peer.name}
            initials={peer.initials}
            color={peer.color}
            avatarUri={peer.avatarUri}
            size={120}
            title={peer.name}
          />
        )}
        <Text style={[TYPE_SCALE.body, TABULAR_NUMS, styles.duration, { color: theme.muted }]}>
          {formatCallDuration(durationSec)}
        </Text>
      </View>

      <View style={styles.bottom}>
        <ControlCapsule>
          {isVideo && (
            <ControlButton
              icon={cameraOff ? 'camera-off' : 'camera'}
              active={cameraOff}
              onPress={toggleCameraOff}
              accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            />
          )}
          <ControlButton
            icon={muted ? 'mic-off' : 'mic'}
            active={muted}
            onPress={toggleMute}
            accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
          />
          {/* No "Flip camera" here: this overlay runs on the in-app call
              provider, which has no camera to switch, so the button did
              nothing. Real video calls use app/call-screen.tsx. */}
          <ControlButton
            icon={speakerOn ? 'volume-2' : 'volume-x'}
            active={speakerOn}
            onPress={toggleSpeaker}
            accessibilityLabel={speakerOn ? 'Turn speaker off' : 'Turn speaker on'}
          />
          <ControlButton
            icon="phone-off"
            danger
            onPress={declineOrEndCall}
            accessibilityLabel="End call"
          />
        </ControlCapsule>
      </View>
    </CallScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  duration: {},
  bottom: { paddingBottom: 48, paddingTop: 12 },
  pip: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 70,
    height: 90,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pipFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pipInitials: { color: '#FFFFFF', fontWeight: '700' },
});
