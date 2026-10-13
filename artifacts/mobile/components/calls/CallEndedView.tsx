/**
 * CallEndedView — Instagram's "call ended + rating" screen. Terminal, not
 * minimizable, so the top-right icon is a close "X" (not the chevron the
 * other three surfaces use). Tapping a rating icon gives visual + haptic
 * confirmation and auto-dismisses after a beat; there's no backend yet to
 * persist the rating (follow-up for a later PR — see the report).
 *
 * Instagram shows a privacy-policy line at the very bottom of this screen;
 * that's Instagram-specific legal copy with no Brandthread equivalent, so
 * it's skipped entirely rather than inventing placeholder text.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCallSession } from '@/lib/calls/CallSessionContext';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';
import { CallAvatarCircle } from './CallAvatarCircle';
import { BigCircleButton, CallScreenShell, TopBarIconButton, formatCallDuration } from './CallControls';

const AUTO_DISMISS_MS = 1100;

export function CallEndedView() {
  const { theme } = useAppTheme();
  const { session, clearEndedCall } = useCallSession();
  const [rating, setRating] = useState<'good' | 'not-good' | null>(null);

  useEffect(() => {
    if (!rating) return;
    const id = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating]);

  if (!session) return null;
  const { peer, connectedAt, endedAt } = session;
  const durationSec = connectedAt && endedAt ? Math.max(0, Math.round((endedAt - connectedAt) / 1000)) : null;

  function dismiss() {
    clearEndedCall();
  }

  function rate(value: 'good' | 'not-good') {
    if (rating) return;
    setRating(value);
    haptics.selection();
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

        <View style={styles.ratingBlock}>
          <Text style={[TYPE_SCALE.callout, styles.ratingPrompt, { color: theme.muted }]}>
            How was the quality of your call?
          </Text>
          <View style={styles.ratingRow}>
            <BigCircleButton
              icon="thumbs-up"
              label="Good"
              filled={rating === 'good'}
              onPress={() => rate('good')}
              accessibilityLabel="Rate call quality: good"
            />
            <BigCircleButton
              icon="thumbs-down"
              label="Not good"
              filled={rating === 'not-good'}
              onPress={() => rate('not-good')}
              accessibilityLabel="Rate call quality: not good"
            />
          </View>
        </View>
      </View>
    </CallScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: '18%', gap: 10 },
  ratingBlock: { alignItems: 'center', gap: 20, marginTop: '14%' },
  ratingPrompt: { textAlign: 'center' },
  ratingRow: { flexDirection: 'row', gap: 40 },
});
