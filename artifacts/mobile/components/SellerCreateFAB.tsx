import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';

const ACTIONS = [
  { label: 'New post', description: 'Share content with your audience', icon: 'video' as const, route: '/create-post' },
  { label: 'New product', description: 'Add a piece to your catalog', icon: 'package' as const, route: '/add-product' },
  { label: 'Start a boost', description: 'Promote a product or post', icon: 'trending-up' as const, route: '/boost' },
];

export default function SellerCreateFAB() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { role, isLoaded: isRoleLoaded } = useRole();
  const [open, setOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const blockedRoute = [
    '/add-product',
    '/seller-drop-create',
    '/create-post',
    '/buyer-checkout',
    '/camera',
    '/capture',
    '/live',
    '/store-preview',
    '/design-canvas',
    '/onboarding',
    '/sign-in',
    '/sign-up',
  ].some(route => pathname.includes(route));

  if (!isRoleLoaded || role !== 'seller' || keyboardVisible || Platform.OS === 'web' || blockedRoute) return null;

  const choose = (route: string) => {
    setOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTimeout(() => router.push(route as never), 0);
  };

  return (
    <>
      <Pressable
        testID="seller-create-fab"
        style={({ pressed }) => [
          styles.fab,
          {
            // Keep the primary create control above the existing AI side-tab.
            bottom: insets.bottom + 144,
            backgroundColor: theme.accent,
            shadowColor: theme.shadowColor,
          },
          pressed && styles.pressed,
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Create"
      >
        <Feather name="plus" size={26} color={theme.onAccent} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View>
              <Text style={styles.title}>Create</Text>
              <Text style={styles.subtitle}>What do you want to make?</Text>
            </View>
            <Pressable style={styles.close} onPress={() => setOpen(false)} accessibilityLabel="Close create menu">
              <Feather name="x" size={20} color={theme.muted} />
            </Pressable>
          </View>
          {ACTIONS.map(action => (
            <Pressable
              testID={`seller-create-action-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
              key={action.label}
              style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.accentDim }]}
              onPress={() => choose(action.route)}
            >
              <View style={[styles.actionIcon, { backgroundColor: theme.accentDim }]}>
                <Feather name={action.icon} size={19} color={theme.accent} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionLabel}>{action.label}</Text>
                <Text style={styles.actionDescription}>{action.description}</Text>
              </View>
               <Feather name="chevron-right" size={18} color={theme.muted} />
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (theme: { background: string; border: string; card: string; text: string; muted: string }) => StyleSheet.create({
  fab: {
    position: 'absolute',
    right: SP.md,
    zIndex: 1000,
    elevation: 12,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  pressed: { transform: [{ scale: 0.92 }], opacity: 0.9 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: `${theme.background}CC` },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.xs,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    marginBottom: SP.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  title: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.xl },
  subtitle: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 3 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  action: { minHeight: 72, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.sm, gap: SP.sm },
  actionIcon: { width: 42, height: 42, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { flex: 1 },
  actionLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.md },
  actionDescription: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
});