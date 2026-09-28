/**
 * GlobalCallOverlay — mounted once in app/_layout.tsx (wiring done outside
 * this PR), rendered as an absolute-fill layer above the whole app so a call
 * survives navigation exactly like Instagram's minimize-to-bar behavior.
 *
 * Renders nothing at all (not an empty absolute View) when there's no active
 * session, so it never blocks touches to the app underneath.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useCallSession } from '@/lib/calls/CallSessionContext';
import { CallBar } from './CallBar';
import { CallEndedView } from './CallEndedView';
import { IncomingCallView } from './IncomingCallView';
import { InCallView } from './InCallView';
import { OutgoingCallView } from './OutgoingCallView';

export function GlobalCallOverlay() {
  const { session } = useCallSession();
  if (!session) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {(() => {
        if (session.status === 'ended') return <CallEndedView />;
        if (session.minimized) return <CallBar />;
        if (session.status === 'outgoing') return <OutgoingCallView />;
        if (session.status === 'incoming') return <IncomingCallView />;
        return <InCallView />;
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
  },
});
