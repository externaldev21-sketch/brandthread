import React, { useContext } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { type IconName } from '@/components/ui/Icon';
import { Icon as Feather } from '@/components/ui/Icon';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import type { ThreadMotif } from '@/components/illustrations/EmptyStateArt';
import { ProfileGridSkeleton } from './ProfileVideoGrid';
import type { ProfileLayout } from './profileLayout';
import { ProfileEmptyAreaContext } from './ProfileEmptyAreaContext';

/** Gap between the tab row and the top of every profile empty state. */
export const EMPTY_STATE_TOP_GAP = 32;

/**
 * What a profile grid shows when it has no tiles: skeleton while loading,
 * ErrorState + Retry on failure, otherwise the shared EmptyState (icon in a
 * thin circle, title, one sentence, CTA on the owner's own profile only).
 * Never an open-ended spinner. Empty/error fill the shell's empty area so
 * they centre above the floating tab bar instead of sitting under it.
 */
export function ProfileGridPlaceholder({
  loading,
  error,
  onRetry,
  layout,
  icon = 'film',
  illustration,
  title,
  description,
  action,
  testID,
  compact,
  actionStyle,
  alignTop,
  quiet,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  layout: ProfileLayout;
  icon?: IconName;
  illustration?: ThreadMotif;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  testID?: string;
  /** Tighter icon/padding — for a screen tight on height above a floating tab bar. */
  compact?: boolean;
  /** The posts grid's empty state sits right under the tab row instead of centring in the area. */
  alignTop?: boolean;
  /** `text` = Instagram-style link action; `pill` = slim white fit-to-text
   *  pill; default `button`. */
  actionStyle?: 'button' | 'text' | 'pill';
  /** The posts grid's empty state: three ghost tiles above the copy, instead
   * of a lone icon with no relation to the grid it's standing in for. */
  showGridPreview?: boolean;
  /** Profile grids: a small plain icon, a 15pt title and one muted line —
   *  no badge circle or headline — so it sits in the room under the tabs
   *  without running under the floating tab bar. */
  quiet?: boolean;
}) {
  const { theme } = useAppTheme();
  const areaHeight = useContext(ProfileEmptyAreaContext);
  // The empty area still reserves the full visible gap (so the list never
  // ends under the floating tab bar), but the empty state itself sits a
  // fixed ~32px under the tab row — the same spot on every tab, never
  // floating mid-screen or down by the bar (Dev).
  const fill = areaHeight
    ? { minHeight: areaHeight, justifyContent: 'flex-start' as const, paddingTop: EMPTY_STATE_TOP_GAP }
    : { justifyContent: 'flex-start' as const, paddingTop: EMPTY_STATE_TOP_GAP };
  if (loading) {
    return (
      <ProfileGridSkeleton columns={layout.gridColumns} width={layout.tileWidth} height={layout.tileHeight} rows={2} />
    );
  }
  if (error) {
    return (
      <View style={fill} testID="profile-grid-error">
        <ErrorState message="Couldn't load these videos." onRetry={onRetry} />
      </View>
    );
  }
  if (quiet) {
    return (
      <View style={[fill, styles.quietFill]} testID={testID ?? 'profile-empty-state'}>
        <View style={styles.quiet}>
          <Feather name={icon} size={22} color={theme.muted} />
          <Text style={[styles.quietTitle, { color: theme.text }]} accessibilityRole="header">{title}</Text>
          {description ? <Text style={[styles.quietMessage, { color: theme.muted }]}>{description}</Text> : null}
          {action ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={action.onPress}
              hitSlop={8}
              style={styles.quietAction}
              testID={`${testID ?? 'profile-empty-state'}-action`}
            >
              <Text style={[styles.quietActionText, { color: theme.accentLight }]} numberOfLines={1}>{action.label}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <>
      <EmptyState
        testID={testID ?? 'profile-empty-state'}
        style={fill}
        icon={icon}
        illustration={illustration}
        title={title}
        message={description ?? ''}
        actionLabel={action?.label}
        onAction={action?.onPress}
        compact={compact}
        actionStyle={actionStyle}
      />
    </>
  );
}

/** Footer spinner while the next page of tiles loads (bounded: only during a fetch). */
export function ProfileGridFooter({ loadingMore }: { loadingMore: boolean }) {
  const { theme } = useAppTheme();
  if (!loadingMore) return null;
  return (
    <View style={styles.footer}>
      <ActivityIndicator size="small" color={theme.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingVertical: SP.lg, alignItems: 'center' },
  // Quiet profile empty state: 24pt under the tabs, everything ≤ 15pt.
  quietFill: { paddingTop: 24 },
  quiet: { alignItems: 'center', gap: 6, paddingHorizontal: SP.lg, maxWidth: 300, alignSelf: 'center' },
  quietTitle: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, textAlign: 'center', marginTop: 2 },
  quietMessage: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  quietAction: { minHeight: 32, justifyContent: 'center', paddingHorizontal: SP.sm },
  quietActionText: { fontFamily: FONT.semibold, fontSize: 14 },
});
