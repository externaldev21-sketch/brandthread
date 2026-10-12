/**
 * The bottom sheet My Store uses everywhere (Add Product, Design, ship date,
 * socials): solid #1C1C1E, grabber, title and ✕, swipe down / backdrop / ✕
 * to close. Built on the app's shared useSheetTransition.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { useSheetTransition } from '@/components/ui/BottomSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FILL_ELEVATED } from '@/lib/theme';
import { RADII } from '@/constants/radii';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Left of the ✕ (e.g. a back arrow inside a two-step sheet). */
  onBack?: () => void;
  testID?: string;
}

export function StoreSheet({ visible, title, onClose, onBack, children, testID }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout } = useSheetTransition(visible, onClose);
  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose}>
      <View style={s.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: 0.6 }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            onLayout={onSheetLayout}
            style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: '88%' }, sheetStyle]}
            accessibilityViewIsModal
            testID={testID}
          >
            <View style={s.grabberWrap}><View style={[s.grabber, { backgroundColor: theme.subtle }]} /></View>
            <View style={s.head}>
              {onBack ? (
                <Pressable onPress={onBack} style={s.back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                  <Icon name="chevron-left" size={24} color={theme.text} />
                </Pressable>
              ) : null}
              <Text style={[s.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
              <Pressable onPress={onClose} style={[s.close, { backgroundColor: theme.background }]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={17} color={theme.text} />
              </Pressable>
            </View>
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: FILL_ELEVATED, borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet },
  grabberWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  grabber: { width: 36, height: 5, borderRadius: 3, opacity: 0.5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, minHeight: 48 },
  back: { width: 32, height: 44, justifyContent: 'center', marginLeft: -6 },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
