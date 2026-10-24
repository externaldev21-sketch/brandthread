/**
 * CallEndedView — Instagram's "call ended" screen. Terminal, not
 * minimizable, so the top-right icon is a close "X" (not the chevron the
 * other three surfaces use).
 *
 * The Instagram-style "How was the quality of your call?" thumbs rating was
 * removed: there is no endpoint to store it (api-server's /api/call/events
 * only records manufacturer-thread call lifecycle events), so tapping it
 * only ever showed a confirmation for a rating that went nowhere.
 *
 * Instagram shows a privacy-policy line at the very bottom of this screen;
 * that's Instagram-specific legal copy with no Brandthread equivalent, so
 * it's skipped entirely rather than inventing placeholder text.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCallSession } from '@/lib/calls/CallSessionContext';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';
import { CallAvatarCircle } from './CallAvatarCircle';
import { CallScreenShell, TopBarIconButton, formatCallDuration } from './CallControls';

export function CallEndedView() {
  const { theme } = useAppTheme();
  const { session, clearEndedCall } = useCallSession();

  if (!session) return null;
  const { peer, connectedAt, endedAt } = session;
  const durationSec = connectedAt && endedAt ? Math.max(0, Math.round((endedAt - connectedAt) / 1000)) : null;

  function dismiss() {
    clearEndedCall();
  }

  return (
    <CallScreenShell
      topRight={<TopBarIconButton name="x" onPress={dismiss} accessibilityLabel="Close" />}
    >
      <View style={styles.center}>
        <CallAvatarCircle
          name={peer.name}
          initials={peer.initials}
          color={peer.color}
          avatarUri={peer.avatarUri}
          size={90}
          title={peer.name}
          subtitle="Call ended"
        />
        {durationSec != null && (
          <Text style={[TYPE_SCALE.body, TABULAR_NUMS, { color: theme.muted }]}>
            {formatCallDuration(durationSec)}
          </Text>
        )}
      </View>
    </CallScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: '18%', gap: 10 },
});
