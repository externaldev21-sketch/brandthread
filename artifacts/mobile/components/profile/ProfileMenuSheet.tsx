/**
 * The "..." menu of a profile, as one bottom sheet for every profile screen.
 * A visitor's menu is Share profile / Report / Block; the owner's is
 * Share profile / View as visitor (plus owner shortcuts). The rows are passed
 * in by the caller from `profileCapabilities`, so this component has no
 * opinion about who may see what.
 *
 * Shown as the ⋯ pull-down menu (lib/contextMenu.ts, UIMenu style) anchored
 * at `anchor`; the bottom sheet below is only the fallback when the menu
 * host isn't mounted. A real menu (not Alert.alert) so it also works on web.
 *
 * `appearance="list"` is Instagram's profile action sheet, 1:1 (Mobbin
 * screen 5a8da308): grabber, centred title, full-width rows separated by
 * hairlines, label on the left and its icon on the right. Used by the
 * buyer's own ••• menu; every other caller keeps the default look.
 */
import React, { useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { hasMenuHost, openPullDownMenuAt, type MenuAnchor } from '@/lib/contextMenu';

export interface ProfileMenuItem {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /** Starts a new group: a full-width separator above this row. */
  separatorBefore?: boolean;
}

export function ProfileMenuSheet({
  visible, title, items, onClose, anchor = null, testID = 'profile-menu-sheet', appearance = 'default',
}: {
  visible: boolean;
  title?: string;
  items: ProfileMenuItem[];
  onClose: () => void;
  /** Where the ⋯ button was tapped (see `anchorFromEvent`). */
  anchor?: MenuAnchor | null;
  testID?: string;
  appearance?: 'default' | 'list';
}) {
  const list = appearance === 'list';
  const asPullDown = !list && hasMenuHost();
  useEffect(() => {
    if (!visible || !asPullDown) return;
    openPullDownMenuAt(anchor, items.map((item) => ({
      key: item.key, label: item.label, icon: item.icon, destructive: item.destructive, onPress: item.onPress,
    })), { title });
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible && !asPullDown} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root} testID={testID}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.handle} />
          {title ? <Text style={[styles.title, list && styles.listTitle]} numberOfLines={1}>{title}</Text> : null}
          {items.map((item, index) => {
            const color = item.destructive ? theme.error : theme.text;
            return (
              <React.Fragment key={item.key}>
                {item.separatorBefore ? <View style={styles.separator} testID={`${testID}-separator-${item.key}`} /> : null}
                {list && index > 0 && !item.separatorBefore ? <View style={styles.rowDivider} /> : null}
                <PressableScale
                  style={list ? styles.listRow : styles.row}
                  onPress={() => { onClose(); item.onPress(); }}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  testID={`${testID}-${item.key}`}
                >
                  {list ? null : <Icon name={item.icon} size={20} color={color} />}
                  <Text style={[list ? styles.listLabel : styles.label, { color }]}>{item.label}</Text>
                  {list ? <Icon name={item.icon} size={22} color={color} /> : null}
                </PressableScale>
              </React.Fragment>
            );
          })}
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
    // appearance="list" (Instagram's profile action sheet)
    listTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: 16, textAlign: 'center', paddingTop: SP.xs, paddingBottom: SP.md },
    listRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, minHeight: 52 },
    listLabel: { flex: 1, fontFamily: FONT.regular, fontSize: 16 },
    rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: SP.md },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: SP.sm },
  });
}
