/**
 * The "..." menu of a profile, as one bottom sheet for every profile screen.
 * A visitor's menu is Share profile / Report / Block; the owner's is
 * Share profile / View as visitor (plus owner shortcuts). The rows are passed
 * in by the caller from `profileCapabilities`, so this component has no
 * opinion about who may see what.
 *
 * A real sheet (not Alert.alert) so the buttons also work on web.
 */
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export interface ProfileMenuItem {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export function ProfileMenuSheet({
  visible, title, items, onClose, testID = 'profile-menu-sheet',
}: {
  visible: boolean;
  title?: string;
  items: ProfileMenuItem[];
  onClose: () => void;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root} testID={testID}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.handle} />
          {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
          {items.map((item) => (
            <PressableScale
              key={item.key}
              style={styles.row}
              onPress={() => { onClose(); item.onPress(); }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              testID={`${testID}-${item.key}`}
            >
              <Feather name={item.icon} size={20} color={item.destructive ? theme.error : theme.text} />
              <Text style={[styles.label, { color: item.destructive ? theme.error : theme.text }]}>{item.label}</Text>
            </PressableScale>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end', backgroundColor: `${theme.shadowColor}8C` },
    sheet: {
      backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
      borderWidth: 1, borderBottomWidth: 0, borderColor: theme.border, paddingTop: SP.sm,
    },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.sm },
    title: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: SP.md, minHeight: 52 },
    label: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base },
  });
}
