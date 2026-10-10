/**
 * CallLogBubble — an Instagram-style DM call-log entry: a light rounded pill,
 * left-aligned like an incoming message bubble, with a small phone icon and
 * two lines of text. Tapping it calls back (per the product requirement),
 * with a light haptic on press.
 *
 * PR1 note: the log this reads (`useCallLog`, lib/calls/CallSessionContext.tsx)
 * is in-memory only — it shows calls placed/received in the current app
 * session and is not persisted to a backend yet. See CallSessionContext's own
 * doc comment; PR2 adds real persistence with no change expected here.
 *
 * Monochrome hard rule: no color-only signal — a missed call is distinguished
 * by bold title text and a dedicated icon (not just a red tint).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticPrimaryAction } from '@/lib/haptics';
import type { CallLogEntry } from '@/lib/calls/types';

/** Matches the "h:mm AM/PM" format the conversation screens already use for
 *  message timestamps (see buyer-conversation.tsx's local `formatTime`). Kept
 *  as a small local copy rather than importing a non-exported helper. */
function formatCallTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

function callLabel(mode: CallLogEntry['mode']): string {
  return mode === 'video' ? 'Video call' : 'Audio call';
}

export interface CallLogBubbleProps {
  entry: CallLogEntry;
  onCallBack: () => void;
}

export function CallLogBubble({ entry, onCallBack }: CallLogBubbleProps) {
  const { theme } = useAppTheme();
  const isMissed = entry.missed;
  const isEnded = !isMissed && (entry.reason === 'hangup' || entry.reason === 'declined' || entry.reason === 'cancelled');

  const title = isMissed ? 'Missed call' : callLabel(entry.mode);
  const subtitle = isEnded ? `${callLabel(entry.mode)} ended` : formatCallTime(entry.startedAt);
  const icon: IconName = isMissed ? 'phone-missed' : 'phone';

  return (
    <PressableScale
      onPress={() => { hapticPrimaryAction(); onCallBack(); }}
      style={[styles.bubble, { backgroundColor: theme.card, borderColor: theme.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${isEnded ? subtitle : `at ${subtitle}`}. Double tap to call back.`}
    >
      <View style={[styles.iconCircle, { backgroundColor: theme.cardElevated }]}>
        <Icon name={icon} size={16} color={theme.text} />
      </View>
      <View style={styles.textCol}>
        {/* No numberOfLines here: title/subtitle are always short, fixed,
            developer-authored copy ("Video call", "12:34 AM", "Missed call"),
            never long or user-generated — truncation would only ever be a
            react-native-web sizing artifact on a shrink-to-fit row, not a
            real overflow case. */}
        <Text style={[TYPE_SCALE.headline, isMissed && styles.missedTitle, { color: theme.text }]}>
          {title}
        </Text>
        <Text style={[TYPE_SCALE.footnote, { color: theme.muted }]}>
          {subtitle}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.xs,
    borderWidth: 1,
    borderRadius: RADII.card,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    // A plain shrink-to-fit width (no minWidth) collapses this row's rendered
    // width below its own text's natural size on react-native-web, wrapping
    // "Video call"/"Audio call ended" mid-word. The copy here is always one
    // of a handful of short, fixed strings, so a floor wide enough for the
    // longest of them ("Video call ended") keeps it on one line without
    // needing a hairline-precision measurement.
    minWidth: 190,
    maxWidth: '75%',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: RADII.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flexShrink: 1 },
  missedTitle: { fontWeight: '700' },
});
