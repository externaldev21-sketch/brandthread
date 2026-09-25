import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { EmptyState } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { ProfileGridSkeleton } from './ProfileVideoGrid';
import type { ProfileLayout } from './profileLayout';

/**
 * What a profile grid shows when it has no tiles: skeleton while loading,
 * ErrorState + Retry on failure, otherwise an EmptyState (with a CTA on the
 * owner's own profile). Never an open-ended spinner.
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
  if (loading) {
    return (
      <ProfileGridSkeleton columns={layout.gridColumns} width={layout.tileWidth} height={layout.tileHeight} rows={2} />
    );
  }
  if (error) {
    return <ErrorState message="Couldn't load these videos." onRetry={onRetry} />;
  }
  return (
    <View testID={testID}>
      <EmptyState icon={icon} title={title} description={description} action={action} compact />
    </View>
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
