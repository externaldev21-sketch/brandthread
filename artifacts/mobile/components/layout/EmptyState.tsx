import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { ThreadMotif } from '@/components/illustrations/EmptyStateArt';
import { EmptyStateBadge } from './EmptyStateBadge';
import { radius } from '@/constants/radii';

/**
 * One shared empty/error state used on every list and grid: the shared
 * EmptyStateBadge (Feather-family stroke icon, optically centred in a 2px
 * silver ring — the same badge as every other empty state in the app),
 * optional title, an optional one-sentence message that wraps (never
 * clips), and one clear action with a 44pt+ tap target. Pass `variant="error"` for
 * failures so the icon reads as a problem rather than "nothing here yet".
 *
 * Inside a list that scrolls under a floating tab bar, give it the list's
 * empty-area height via `style={{ minHeight }}` (see ProfileShell /
 * computeEmptyArea) so it centres in the visible gap instead of sitting
 * under the bar.
 */
export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  variant = 'empty',
  style,
  testID,
  /** Shrinks the icon circle and vertical padding — for a screen tight on
   * height (e.g. the buyer profile's grid, above a floating tab bar). */
  compact,
  /** One of the shared thread-motif line illustrations; falls back to `icon` when omitted. */
  illustration,
  /** `text` = Instagram-style link action (accent text, no pill); `pill` =
   *  slim white fit-to-text pill (black text, 36px, equal side padding);
   *  default `button`. */
  actionStyle = 'button',
}: {
  icon: keyof typeof Feather.glyphMap;
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'empty' | 'error';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  compact?: boolean;
  /** Accepted for API compatibility; the shared badge always draws `icon`
   *  (Dev: one badge for every empty state). */
  illustration?: ThreadMotif;
  actionStyle?: 'button' | 'text' | 'pill';
}) {
  const { theme } = useAppTheme();
  const textAction = actionStyle === 'text';
  const pillAction = actionStyle === 'pill';
  void illustration;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, style]} testID={testID}>
      {/* Same badge size everywhere (Dev: one badge for every empty state),
          compact included — compact only drops the message line. */}
      <EmptyStateBadge
        icon={icon}
        color={variant === 'error' ? theme.error : undefined}
        testID={testID ? `${testID}-badge` : undefined}
      />
      <View style={[styles.copy, compact && styles.copyCompact]}>
        {title ? <Text style={[styles.title, compact && styles.titleCompact, { color: theme.text }]} accessibilityRole="header">{title}</Text> : null}
        {/* The message is dropped in `compact` mode — the title alone
            ("No posts yet") already says it, and reclaiming its height is
            what lets the CTA below clear a floating tab bar without
            scrolling on a screen with a tall header above it. An empty
            message renders nothing (no blank line). */}
        {compact || !message ? null : <Text style={[styles.message, { color: theme.muted }]}>{message}</Text>}
      </View>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={
            textAction ? styles.actionText
              : pillAction ? [styles.actionPill, { backgroundColor: theme.text }]
              : [styles.actionBtn, { backgroundColor: theme.accent }]
          }
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text
            style={[
              styles.actionLabel,
              pillAction && styles.actionPillLabel,
              { color: textAction ? theme.accentLight : pillAction ? theme.background : theme.onAccent },
            ]}
            numberOfLines={1}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SP.xxl,
    paddingHorizontal: SP.lg,
    gap: SP.md,
  },
  wrapCompact: { paddingVertical: 6, paddingHorizontal: SP.md, gap: 8 },
  copy: { alignItems: 'center', gap: SP.xs, maxWidth: 320, alignSelf: 'center' },
  copyCompact: { maxWidth: 280 },
  title: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    textAlign: 'center',
  },
  titleCompact: { fontSize: 17 },
  message: {
    fontFamily: FONT.medium,
    fontSize: FS.base,
    lineHeight: 21,
    textAlign: 'center',
    flexShrink: 1,
  },
  actionBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm + 2,
    borderRadius: radius.md,
    marginTop: SP.xs,
  },
  actionText: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SP.sm },
  // Slim white fit-to-text pill: 36px tall, equal 16px side padding, black
  // text — never stretched, never a fixed width.
  actionPill: {
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: SP.md,
    borderRadius: 18,
  },
  actionPillLabel: { fontSize: FS.sm },
  actionLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
});
