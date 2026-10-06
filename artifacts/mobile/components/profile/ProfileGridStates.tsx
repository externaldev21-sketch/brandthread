import React, { useContext } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ICON, SP } from '@/lib/theme';
import type { ThreadMotif } from '@/components/illustrations/EmptyStateArt';
import { ProfileGridSkeleton } from './ProfileVideoGrid';
import type { ProfileLayout } from './profileLayout';
import { ProfileEmptyAreaContext } from './ProfileEmptyAreaContext';

/** Gap between the tab row and the top of every profile empty state. */
export const EMPTY_STATE_TOP_GAP = 32;

/**
 * Three hairline-bordered ghost tiles standing in for the grid this empty
 * state will fill in — the middle one carries the CTA icon — instead of a
 * single lone icon floating with no relation to what's coming.
 */
function EmptyGridPreview({ layout }: { layout: ProfileLayout }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.previewRow} testID="profile-empty-grid-preview">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.previewTile,
            { width: layout.tileWidth, height: layout.tileHeight, borderColor: theme.border },
          ]}
        >
          {i === 1 ? <Feather name="plus" size={ICON.sm} color={theme.subtle} /> : null}
        </View>
      ))}
    </View>
  );
}

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
  showGridPreview,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  layout: ProfileLayout;
  icon?: keyof typeof Feather.glyphMap;
  illustration?: ThreadMotif;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; icon?: keyof typeof Feather.glyphMap };
  testID?: string;
  /** Tighter icon/padding — for a screen tight on height above a floating tab bar. */
  compact?: boolean;
  /** `text` = Instagram-style link action; `pill` = slim white fit-to-text
   *  pill; default `button`. */
  actionStyle?: 'button' | 'text' | 'pill';
  /** The posts grid's empty state: three ghost tiles above the copy, instead
   * of a lone icon with no relation to the grid it's standing in for. */
  showGridPreview?: boolean;
}) {
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
  return (
    <>
      {showGridPreview ? <EmptyGridPreview layout={layout} /> : null}
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
  previewRow: { flexDirection: 'row', gap: 1, marginBottom: SP.md },
  previewTile: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
