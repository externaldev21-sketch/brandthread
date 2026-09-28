/**
 * IncomingCallView — our in-app equivalent of the OS CallKit sheet Instagram
 * relies on for a foreground incoming call. Expo managed workflow can't show
 * a native CallKit UI without a custom dev build (documented PR2 gap), so
 * this mirrors the outgoing screen's visual language (same avatar/name
 * treatment, same near-black chrome) with "Incoming call"/"Incoming video
 * call" in place of "Calling…", and two large Accept/Decline circles in
 * place of the bottom control capsule — same shape Instagram's own CallKit
 * sheet uses (accept vs. decline, not a mid-call control row).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useCallSession } from '@/lib/calls/CallSessionContext';
import { CallAvatarCircle } from './CallAvatarCircle';
import { BigCircleButton, CallScreenShell } from './CallControls';

export function IncomingCallView() {
  const { session, acceptCall, declineOrEndCall } = useCallSession();
  if (!session) return null;
  const { peer, mode } = session;

  return (
    <CallScreenShell>
      <View style={styles.center}>
        <CallAvatarCircle
          name={peer.name}
          initials={peer.initials}
          color={peer.color}
          avatarUri={peer.avatarUri}
          size={120}
          title={peer.name}
          subtitle={mode === 'video' ? 'Incoming video call' : 'Incoming call'}
        />
      </View>

      <View style={styles.bottom}>
        <BigCircleButton
          icon="phone-off"
          label="Decline"
          danger
          onPress={declineOrEndCall}
          accessibilityLabel="Decline call"
        />
        <BigCircleButton
          icon="phone"
          label="Accept"
          filled
          onPress={acceptCall}
          accessibilityLabel="Accept call"
        />
      </View>
    </CallScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingBottom: 56,
    paddingTop: 12,
    paddingHorizontal: 32,
  },
});
