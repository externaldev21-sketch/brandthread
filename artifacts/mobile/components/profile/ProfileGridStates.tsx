import React, { useContext } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { ProfileGridSkeleton } from './ProfileVideoGrid';
import type { ProfileLayout } from './profileLayout';
import { ProfileEmptyAreaContext } from './ProfileEmptyAreaContext';

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
  title,
  description,
  action,
  testID,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  layout: ProfileLayout;
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; icon?: keyof typeof Feather.glyphMap };
  testID?: string;
}) {
  const areaHeight = useContext(ProfileEmptyAreaContext);
  const fill = areaHeight ? { minHeight: areaHeight, justifyContent: 'center' as const } : null;
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
    <EmptyState
      testID={testID ?? 'profile-empty-state'}
      style={fill}
      icon={icon}
      title={title}
      message={description ?? ''}
      actionLabel={action?.label}
      onAction={action?.onPress}
    />
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
});
