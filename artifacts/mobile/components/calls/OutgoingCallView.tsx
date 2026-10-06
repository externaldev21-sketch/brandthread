/**
 * OutgoingCallView — Instagram "Calling…" screen, mirrored 1:1 in layout:
 * chevron-down minimize top-left, centered peer avatar + name + "Calling…",
 * bottom control capsule (camera, mic, [effects/gallery skipped — no such
 * feature], end). Flip-camera only appears for `mode === 'video'`, matching
 * Instagram not showing it on the audio-only variant either.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useCallSession } from '@/lib/calls/CallSessionContext';
import { CallAvatarCircle } from './CallAvatarCircle';
import { CallScreenShell, ControlButton, ControlCapsule, TopBarIconButton } from './CallControls';

export function OutgoingCallView() {
  const { session, minimize, declineOrEndCall, toggleMute, toggleCameraOff } = useCallSession();
  if (!session) return null;
  const { peer, mode, muted, cameraOff } = session;

  return (
    <CallScreenShell
      topLeft={(
        <TopBarIconButton name="chevron-down" onPress={minimize} accessibilityLabel="Minimize call" />
      )}
    >
      <View style={styles.center}>
        <CallAvatarCircle
          name={peer.name}
          initials={peer.initials}
          color={peer.color}
          avatarUri={peer.avatarUri}
          size={120}
          title={peer.name}
          subtitle="Calling…"
        />
      </View>

      <View style={styles.bottom}>
        <ControlCapsule>
          <ControlButton
            icon={cameraOff ? 'camera-off' : 'camera'}
            active={mode === 'video' && cameraOff}
            onPress={toggleCameraOff}
            accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'}
          />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottom: { paddingBottom: 48, paddingTop: 12 },
});
