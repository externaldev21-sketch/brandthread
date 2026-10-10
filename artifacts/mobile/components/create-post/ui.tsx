/**
 * Shared chrome for the create flow (capture → gallery → edit → post).
 * TikTok's layout with our palette: true black, white, silver — the only
 * colour anywhere is LIVE/record red. Inter throughout. These are fixed
 * values on purpose: the creation canvas is always black, whatever app theme
 * is selected.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import { CREATE_CANVAS, FONT } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';

export const CP = CREATE_CANVAS;

export function tap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** 52px pill — the Drafts / Post / Next buttons. */
export function PillButton({
  label, onPress, icon, variant = 'primary', disabled, loading, style, testID, flex = true,
}: {
  label: string; onPress: () => void; icon?: IconName;
  variant?: 'primary' | 'secondary'; disabled?: boolean; loading?: boolean;
  style?: StyleProp<ViewStyle>; testID?: string; flex?: boolean;
}) {
  const isPrimary = variant === 'primary';
  const bg = disabled ? CP.surface : isPrimary ? CP.white : CP.surface2;
  const fg = disabled ? CP.silverDim : isPrimary ? CP.black : CP.white;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled || loading}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [s.pill, flex && { flex: 1 }, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Icon name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[s.pillText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Right-hand tool rail item: white icon over a tiny label. */
export function RailButton({ icon, label, onPress, testID, active }: {
  icon: IconName; label: string; onPress: () => void; testID?: string; active?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { tap(); onPress(); }}
      hitSlop={6}
      style={s.rail}
    >
      <Icon name={icon} size={26} color={active ? CP.white : CP.white} />
      <Text style={s.railLabel}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, size = 26, testID }: {
  icon: IconName; onPress: () => void; label: string; size?: number; testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { tap(); onPress(); }}
      hitSlop={10}
      style={s.iconBtn}
    >
      <Icon name={icon} size={size} color={CP.white} />
    </Pressable>
  );
}

/**
 * The app's standard ScreenHeader (arrow-left, left-aligned Inter-bold title,
 * same paddings) — no subtitle, and no divider under it.
 */
export function CreateHeader({ title, onBack, right }: {
  title: string; onBack: () => void; right?: React.ReactNode; testID?: string;
}) {
  return <ScreenHeader title={title} onBack={() => { tap(); onBack(); }} rightElement={right} divider={false} backTestID="create-header-back" />;
}

/** Full-screen, fully opaque page (TikTok pushes a page for every picker; no scrims). */
export function SubPage({ title, onBack, children, right, testID }: {
  title: string; onBack: () => void; children: React.ReactNode; right?: React.ReactNode; testID?: string;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: CP.black, zIndex: 50 }]} testID={testID}>
      <CreateHeader title={title} onBack={onBack} right={right} />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  pill: { height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pillText: { fontFamily: FONT.semibold, fontSize: 16 },
  rail: { alignItems: 'center', width: 52, gap: 3 },
  railLabel: { color: CP.white, fontFamily: FONT.semibold, fontSize: 11 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
