import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { ThreadIllustration, type ThreadMotif } from '@/components/illustrations/EmptyStateArt';

/**
 * One shared empty/error state used on every list and grid: icon in a thin
 * circle, optional title, a one-sentence message that wraps (never clips), and
 * one clear action with a 44pt+ tap target. Pass `variant="error"` for
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
  /** `text` = Instagram-style link action (accent text, no pill); default `button`. */
  actionStyle = 'button',
  /** `slim` = a compact fit-to-text pill (36pt tall, 16px sides) for a
   *  secondary next step; default keeps the original 44pt pill. */
  actionSize = 'default',
}: {
  icon: keyof typeof Feather.glyphMap;
  title?: string;
  /** Omit for a title-only empty state (no filler sentence). */
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'empty' | 'error';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  compact?: boolean;
  illustration?: ThreadMotif;
  actionStyle?: 'button' | 'text';
  actionSize?: 'default' | 'slim';
}) {
  const { theme } = useAppTheme();
  const textAction = actionStyle === 'text';
  const iconColor = variant === 'error' ? theme.error : theme.muted;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, style]} testID={testID}>
      <View style={[styles.iconCircle, compact && styles.iconCircleCompact, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {illustration && variant !== 'error' ? (
          <ThreadIllustration motif={illustration} size={compact ? 26 : 36} color={iconColor} strokeWidth={3.5} />
        ) : (
          <Feather name={icon} size={compact ? ICON.md : ICON.xl} color={iconColor} />
        )}
      </View>
      <View style={[styles.copy, compact && styles.copyCompact]}>
        {title ? <Text style={[styles.title, compact && styles.titleCompact, { color: theme.text }]} accessibilityRole="header">{title}</Text> : null}
        {/* The message is dropped in `compact` mode — the title alone
            ("No posts yet") already says it, and reclaiming its height is
            what lets the CTA below clear a floating tab bar without
            scrolling on a screen with a tall header above it. */}
        {compact || !message ? null : <Text style={[styles.message, { color: theme.muted }]}>{message}</Text>}
      </View>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={textAction ? styles.actionText : [styles.actionBtn, actionSize === 'slim' && styles.actionBtnSlim, { backgroundColor: theme.accent }]}
          hitSlop={actionSize === 'slim' ? { top: 4, bottom: 4 } : undefined}
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text style={[styles.actionLabel, actionSize === 'slim' && styles.actionLabelSlim, { color: textAction ? theme.accentLight : theme.onAccent }]}>{actionLabel}</Text>
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
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleCompact: { width: 36, height: 36, borderRadius: 18 },
  copy: { alignItems: 'center', gap: SP.xs, maxWidth: 320, alignSelf: 'center' },
  copyCompact: { maxWidth: 280 },
  title: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    textAlign: 'center',
  },
  titleCompact: { fontSize: 18 },
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
    borderRadius: RADIUS.pill,
    marginTop: SP.xs,
  },
  actionBtnSlim: {
    minHeight: 36,
    paddingHorizontal: SP.md,
    paddingVertical: 0,
    alignItems: 'center',
  },
  actionText: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SP.sm },
  actionLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  actionLabelSlim: { fontSize: FS.sm },
});
