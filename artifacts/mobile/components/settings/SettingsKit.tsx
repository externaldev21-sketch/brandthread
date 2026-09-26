/**
 * Shared building blocks for the Settings Hub (buyer + seller).
 *
 * Buyer and seller settings screens render completely different sections,
 * but both are built from these same primitives so the two experiences stay
 * visually identical (same premium "grouped iOS list" feel, same tokens,
 * same haptics) while their content differs.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { PressableScale, SheetHandle, HapticSwitch } from '@/components/BrandthreadUI';

type Colors = ReturnType<typeof useColors>;

// ─── Profile card ───────────────────────────────────────────────────────────

export function SettingsProfileCard({
  name,
  handle,
  subtitle,
  initials,
  eyebrow,
  onPress,
}: {
  name: string;
  handle?: string;
  subtitle?: string;
  initials: string;
  eyebrow: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const s = React.useMemo(() => makeCardStyles(colors), [colors]);
  return (
    <PressableScale
      style={s.profileCard}
      onPress={() => {
        hapticLight();
        onPress();
      }}
      accessibilityLabel="Edit profile"
    >
      <View style={[s.profileAvatar, { backgroundColor: colors.primary }]}>
        <Text style={[s.profileAvatarText, { color: colors.primaryForeground }]}>{initials}</Text>
      </View>
      <View style={s.profileCopy}>
        <Text style={s.profileEyebrow}>{eyebrow}</Text>
        <Text style={s.profileName} numberOfLines={2}>{name}</Text>
        <Text style={s.profileSub} numberOfLines={1}>
          {handle ? `@${handle}` : subtitle ?? 'Manage your account and preferences'}
        </Text>
      </View>
      <View style={s.profileEditBtn}>
        <Feather name="edit-2" size={14} color={colors.foreground} />
        <Text style={s.profileEditText} numberOfLines={1}>Edit</Text>
      </View>
    </PressableScale>
  );
}

// ─── Search ─────────────────────────────────────────────────────────────────

export function SettingsSearchBar({
  value,
  onChangeText,
  placeholder = 'Search settings',
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  const s = React.useMemo(() => makeCardStyles(colors), [colors]);
  return (
    <View style={s.searchWrap}>
      <Feather name="search" size={16} color={colors.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={s.searchInput}
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x-circle" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Section / group ────────────────────────────────────────────────────────

export function SettingsSection({
  title,
  footer,
  children,
  style,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const s = React.useMemo(() => makeCardStyles(colors), [colors]);
  return (
    <View style={[s.section, style]}>
      {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
      <View style={s.sectionCard}>{children}</View>
      {footer ? <Text style={s.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

export interface SettingsRowProps {
  icon: keyof typeof Feather.glyphMap;
  iconColor?: string;
  iconBg?: string;
  label: string;
  value?: string;
  subtitle?: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  last?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  badge?: string;
  soon?: boolean;
  right?: React.ReactNode;
}

export function SettingsRow({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  subtitle,
  onPress,
  destructive,
  disabled,
  last,
  switchValue,
  onSwitchChange,
  badge,
  soon,
  right,
}: SettingsRowProps) {
  const colors = useColors();
  const s = React.useMemo(() => makeCardStyles(colors), [colors]);
  const isSwitch = onSwitchChange !== undefined;
  const inert = disabled || soon;
  const labelColor = destructive ? colors.destructive : inert ? colors.mutedForeground : colors.foreground;
  const iconTint = inert ? colors.mutedForeground : destructive ? colors.destructive : iconColor ?? colors.foreground;
  const iconChipBg = inert ? colors.secondary : iconBg ?? colors.secondary;

  const content = (
    <View style={[s.row, !last && s.rowDivider]}>
      <View style={[s.rowIcon, { backgroundColor: iconChipBg }]}>
        <Feather name={icon} size={16} color={iconTint} />
      </View>
      <View style={s.rowCopy}>
        <Text style={[s.rowLabel, { color: labelColor }]} numberOfLines={1}>{label}</Text>
        {subtitle ? <Text style={[s.rowSubtitle, inert && { color: colors.mutedForeground }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View style={s.rowBadge}>
          <Text style={s.rowBadgeText}>{badge}</Text>
        </View>
      ) : null}
      {soon ? (
        <View style={s.rowSoonBadge}>
          <Text style={s.rowSoonBadgeText}>Soon</Text>
        </View>
      ) : null}
      {value ? <Text style={s.rowValue} numberOfLines={1}>{value}</Text> : null}
      {right}
      {isSwitch ? (
        <HapticSwitch
          value={!!switchValue}
          onValueChange={onSwitchChange}
          disabled={disabled}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.background}
        />
      ) : onPress && !inert ? (
        <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
      ) : null}
    </View>
  );

  if (isSwitch || !onPress || inert) {
    return <View>{content}</View>;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.65}
      onPress={() => {
        hapticLight();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {content}
    </TouchableOpacity>
  );
}

/** Row that just navigates to an existing route via expo-router. */
export function SettingsLinkRow(props: Omit<SettingsRowProps, 'onPress'> & { route: string }) {
  const router = useRouter();
  const { route, ...rest } = props;
  return <SettingsRow {...rest} onPress={() => router.push(route as never)} />;
}

// ─── Confirm sheet (destructive actions) ────────────────────────────────────

export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const s = React.useMemo(() => makeCardStyles(colors), [colors]);
  const translateY = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 4 }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(40);
      fade.setValue(0);
    }
  }, [visible, translateY, fade]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <Animated.View style={[s.sheetCard, { opacity: fade, transform: [{ translateY }] }]}>
          <SheetHandle />
          <Text style={s.sheetTitle}>{title}</Text>
          <Text style={s.sheetMessage}>{message}</Text>
          <PressableScale
            style={[s.sheetConfirmBtn, { backgroundColor: destructive ? colors.destructive : colors.primary }]}
            onPress={() => {
              hapticSelection();
              onConfirm();
            }}
            disabled={loading}
          >
            <Text style={[s.sheetConfirmText, { color: destructive ? '#FFFFFF' : colors.primaryForeground }]}>
              {loading ? 'Please wait…' : confirmLabel}
            </Text>
          </PressableScale>
          <TouchableOpacity style={s.sheetCancelBtn} onPress={onCancel} disabled={loading}>
            <Text style={s.sheetCancelText}>{cancelLabel}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeCardStyles(colors: Colors) {
  return StyleSheet.create({
    // Profile
    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS.lg,
      padding: 14,
      marginBottom: 18,
    },
    profileAvatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
    profileAvatarText: { fontSize: 18, fontFamily: FONT.bold },
    profileCopy: { flex: 1, minWidth: 0 },
    profileEyebrow: { fontSize: 11, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.mutedForeground, marginBottom: 2 },
    profileName: { fontSize: 17, fontFamily: FONT.bold, color: colors.foreground, flexShrink: 1 },
    profileSub: { fontSize: 12, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
    profileEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 7, flexShrink: 0 },
    profileEditText: { fontSize: 12, fontFamily: FONT.semibold, color: colors.foreground },

    // Search
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.secondary, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 20 },
    searchInput: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: colors.foreground },

    // Section
    section: { marginBottom: 22 },
    sectionTitle: { fontSize: 12, fontFamily: FONT.semibold, color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8, marginLeft: 2 },
    sectionCard: { backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    sectionFooter: { fontSize: 11, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 8, marginLeft: 2, lineHeight: 15 },

    // Row
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, minHeight: 52 },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    rowCopy: { flex: 1, minWidth: 0 },
    rowLabel: { fontSize: FS.sm, lineHeight: 18, fontFamily: FONT.medium },
    rowSubtitle: { fontSize: 12, lineHeight: 16, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
    rowValue: { fontSize: 13, lineHeight: 17, fontFamily: FONT.regular, color: colors.mutedForeground, maxWidth: 120 },
    rowBadge: { backgroundColor: colors.destructive, borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 2, minWidth: 18, alignItems: 'center' },
    rowBadgeText: { fontSize: 11, lineHeight: 13, fontFamily: FONT.bold, color: '#FFFFFF' },
    rowSoonBadge: { backgroundColor: colors.secondary, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.border },
    rowSoonBadgeText: { fontSize: 11, lineHeight: 13, fontFamily: FONT.semibold, color: colors.mutedForeground, letterSpacing: 0.3 },

    // Confirm sheet
    sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: (colors as any).overlay ?? 'rgba(0,0,0,0.68)' },
    sheetCard: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, borderBottomWidth: 0, paddingHorizontal: 22, paddingBottom: 36, paddingTop: 2 },
    sheetTitle: { fontSize: 19, fontFamily: FONT.bold, color: colors.foreground, textAlign: 'center', marginTop: 10 },
    sheetMessage: { fontSize: 14, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center', marginTop: 8, marginBottom: 22, lineHeight: 19, paddingHorizontal: 8 },
    sheetConfirmBtn: { borderRadius: RADIUS.md, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
    sheetConfirmText: { fontSize: FS.base, fontFamily: FONT.bold },
    sheetCancelBtn: { paddingVertical: 13, alignItems: 'center' },
    sheetCancelText: { fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
  });
}
