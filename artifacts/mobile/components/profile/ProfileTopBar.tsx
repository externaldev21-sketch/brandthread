/**
 * Plain, chrome-free top-bar controls for a profile's own video-header
 * (no grey pill behind the account name, no grey circles behind the
 * icons) — shared by the buyer and seller own-profile screens so the two
 * headers stay pixel-identical. `ProfileVideoHeader` already paints a
 * legibility scrim behind the whole top bar, so these need no background
 * of their own; `overMedia` adds a small text shadow on top of that for
 * extra insurance when a cover video is actually playing.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticLight } from '@/lib/haptics';
import { FONT, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { InteractionLayer } from './ProfileControls';

export function ProfileAccountSwitcher({
  label,
  onPress,
  overMedia,
  testID,
  accessibilityLabel = 'Switch account',
}: {
  label: string;
  onPress: () => void;
  overMedia?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      style={styles.switcher}
      onPress={() => { hapticLight(); onPress(); }}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {(state) => (
        <>
          <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.sm} theme={theme} />
          <Text style={[styles.switcherText, { color: theme.text }, overMedia && styles.overMedia]} numberOfLines={1}>
            {label}
          </Text>
          <Icon name="chevron-down" size={16} color={theme.text} />
        </>
      )}
    </PressableScale>
  );
}

/** Plain white line icon, no circle background — 44pt invisible tap target via hitSlop. */
export function ProfileTopBarIcon({
  name,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  badge,
  testID,
}: {
  name: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  badge?: boolean;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={10}
      style={styles.iconButton}
    >
      <Icon name={name} size={24} color={theme.text} />
      {badge ? <View style={[styles.iconBadge, { backgroundColor: theme.accent, borderColor: theme.background }]} /> : null}
    </Pressable>
  );
}

/** Groups ProfileTopBarIcons with the exact 16pt gap the buyer header uses. */
export function ProfileTopBarIconRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.iconRow}>{children}</View>;
}

const styles = StyleSheet.create({
  switcher: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32,
    borderRadius: RADIUS.sm, overflow: 'hidden',
  },
  switcherText: { fontFamily: FONT.semibold, fontSize: 18, flexShrink: 1, minWidth: 0 },
  overMedia: {
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4, // theme-exempt: legibility over cover media
  },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 0 },
  // 24pt icon, hitSlop 10 on every side -> 44pt effective tap target,
  // invisible (no background), matching the buyer header's icon size/stroke.
  iconButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
});
