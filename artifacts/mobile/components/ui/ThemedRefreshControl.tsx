/**
 * Brandthread Design System — ThemedRefreshControl (Phase 1)
 *
 * Audit finding: pull-to-refresh spinners across the app use inconsistent
 * tint colors (`colors.primary`, `theme.accent`, `theme.text`, with or
 * without the Android `colors` array) — see app/team.tsx, app/buyer-drops.tsx,
 * app/seller-inbox.tsx, app/manufacturer-messages.tsx. This wrapper is the
 * single, theme-correct RefreshControl for every future/Phase 2 screen; it is
 * intentionally *not* retrofitted into existing screens in this PR (per the
 * "global chrome only" scope), but is ready to drop in as `<ThemedRefreshControl
 * refreshing={..} onRefresh={..} />` in place of a raw `<RefreshControl>`.
 */
import React from 'react';
import { RefreshControl, RefreshControlProps } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';

export function ThemedRefreshControl(props: Omit<RefreshControlProps, 'tintColor' | 'colors'>) {
  const { theme } = useAppTheme();
  return (
    <RefreshControl
      {...props}
      tintColor={theme.accent}
      colors={[theme.accent]}
      progressBackgroundColor={theme.card}
    />
  );
}
