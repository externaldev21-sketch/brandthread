/**
 * Renders the two menus driven by lib/contextMenu.ts. Mounted once in
 * app/_layout.tsx.
 *
 * Long-press preview menu — reference: Instagram, long-press a grid post.
 * The screen behind blurs, an enlarged card of the item (its media, with the
 * author row) springs in, and the action list sits right under it. Tapping
 * the card opens the item; tapping outside dismisses.
 *
 * Pull-down menu — reference: Apple HIG "Pull-down buttons" (UIMenu). It
 * drops from the ⋯ button, labels on the left with their symbol on the
 * right, destructive items red, hairline separators, no dimming behind it.
 * Tapping outside dismisses.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { springTo } from '@/constants/motion';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { haptics } from '@/lib/haptics';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { a11yModalProps } from '@/lib/a11y/modal';
import {
  closeContextMenu, closePullDownMenu, placePullDown, previewAspectRatio, subscribeMenus,
  type ContextMenuRequest, type MenuItem, type PullDownRequest,
} from '@/lib/contextMenu';

/** Solid menu surface: #1C1C1E on the default Monochrome theme
 *  (BRANDTHREAD_DESIGN: inputs and sheets #1C1C1E), the theme's own card
 *  colour on the other Appearance themes. */
export function menuSurface(theme: AppThemePreset): string {
  return theme.id === 'monochrome' ? '#1C1C1E' : theme.cardElevated;
}
const PULLDOWN_WIDTH = 250;
const ROW_HEIGHT = 44;
const nativeDriver = Platform.OS !== 'web';

export function ContextMenuHost() {
  const [context, setContext] = useState<ContextMenuRequest | null>(null);
  const [pullDown, setPullDown] = useState<PullDownRequest | null>(null);
  useEffect(() => subscribeMenus((s) => { setContext(s.context); setPullDown(s.pullDown); }), []);
  return (
    <>
      {context ? <PreviewMenu key={context.id} req={context} /> : null}
      {pullDown ? <PullDown key={pullDown.id} req={pullDown} /> : null}
    </>
  );
}

/** Runs the item's action after the menu has gone, like UIKit does. */
function useClosing(anim: Animated.Value, onClosed: () => void) {
  const closing = useRef(false);
  return (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(anim, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver }).start(() => {
      onClosed();
      after?.();
    });
  };
}

function MenuRows({ items, onPick, compact }: { items: MenuItem[]; onPick: (item: MenuItem) => void; compact?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <>
      {items.map((item, index) => {
        const color = item.destructive ? theme.error : theme.text;
        return (
          <Pressable
            key={item.key ?? `${item.label}-${index}`}
            disabled={item.disabled}
            onPress={() => onPick(item)}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: !!item.disabled, checked: item.checked }}
            style={({ pressed }) => [
              styles.row,
              compact && styles.rowCompact,
              index > 0 && [styles.rowSeparator, { borderTopColor: theme.border }],
              pressed && { backgroundColor: theme.card },
              item.disabled && styles.rowDisabled,
            ]}
            testID={`menu-item-${index}`}
          >
            {item.checked !== undefined ? (
              <View style={styles.check}>{item.checked ? <Icon name="check" size={16} color={theme.text} /> : null}</View>
            ) : null}
            <Text style={[styles.rowLabel, { color }]} numberOfLines={1}>{item.label}</Text>
            {item.icon ? <Icon name={item.icon} size={18} color={color} style={styles.rowIcon} /> : null}
          </Pressable>
        );
      })}
    </>
  );
}

function PreviewMenu({ req }: { req: ContextMenuRequest }) {
  const { theme } = useAppTheme();
  const surface = menuSurface(theme);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const close = useClosing(anim, closeContextMenu);

  useEffect(() => {
    haptics.rigid();
    // The design foundation's one spring (no overshoot).
    springTo(anim, 1).start();
  }, [anim]);

  const { preview } = req;
  const cardWidth = Math.min(width - 48, 420);
  const listHeight = req.items.length * 48;
  const hasHeader = !!(preview.title || preview.avatarUri);
  const chrome = (hasHeader ? 52 : 0) + 12 + listHeight;
  const maxMedia = Math.max(160, height - insets.top - insets.bottom - 48 - chrome);
  const ratio = previewAspectRatio(preview.aspectRatio);
  const mediaHeight = preview.imageUri ? Math.min(maxMedia, cardWidth / ratio) : 0;
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 1 : 0.92, 1] });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => close()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <BlurView intensity={Platform.OS === 'ios' ? 60 : 40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.previewScrim, { backgroundColor: theme.surfaceGlass }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityRole="button" accessibilityLabel="Close menu" />
      </Animated.View>
      <View pointerEvents="box-none" style={[styles.previewColumn, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Animated.View {...a11yModalProps()} style={{ width: cardWidth, opacity: anim, transform: [{ scale }] }}>
          <Pressable
            onPress={req.onPreviewPress ? () => close(req.onPreviewPress) : undefined}
            disabled={!req.onPreviewPress}
            accessibilityRole={req.onPreviewPress ? 'button' : undefined}
            accessibilityLabel={preview.title ?? undefined}
            style={[styles.previewCard, { backgroundColor: surface }]}
            testID="context-menu-preview"
          >
            {hasHeader ? (
              <View style={styles.previewHeader}>
                {preview.avatarUri ? <Image source={{ uri: preview.avatarUri }} style={[styles.previewAvatar, { backgroundColor: theme.card }]} contentFit="cover" /> : null}
                <View style={styles.previewHeaderText}>
                  {preview.title ? <Text style={[styles.previewTitle, { color: theme.text }]} numberOfLines={1}>{preview.title}</Text> : null}
                  {preview.subtitle ? <Text style={[styles.previewSubtitle, { color: theme.muted }]} numberOfLines={1}>{preview.subtitle}</Text> : null}
                </View>
              </View>
            ) : null}
            {preview.imageUri ? (
              <Image source={{ uri: preview.imageUri }} style={{ width: cardWidth, height: mediaHeight }} contentFit="cover" transition={0} />
            ) : null}
            {preview.body ? (
              <Text style={[styles.previewBody, { color: theme.text }]} numberOfLines={8}>{preview.body}</Text>
            ) : null}
          </Pressable>
          <ScrollView style={[styles.previewList, { backgroundColor: surface }]} scrollEnabled={listHeight > 360} bounces={false}>
            <MenuRows items={req.items} onPick={(item) => close(item.onPress)} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function PullDown({ req }: { req: PullDownRequest }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const close = useClosing(anim, closePullDownMenu);

  useEffect(() => {
    springTo(anim, 1).start();
  }, [anim]);

  const menuHeight = req.items.length * ROW_HEIGHT + (req.title ? 34 : 0);
  const pos = placePullDown(req.anchor, { width: PULLDOWN_WIDTH, height: Math.min(menuHeight, height * 0.6) }, {
    width, height, top: insets.top, bottom: insets.bottom,
  });
  // Grow out of the button corner, as UIMenu does.
  const dx = (pos.origin === 'right' ? 1 : -1) * PULLDOWN_WIDTH * 0.4;
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 1 : 0.2, 1] });
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : dx, 0] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : -menuHeight * 0.4, 0] });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => close(req.onDismiss)}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => close(req.onDismiss)} accessibilityRole="button" accessibilityLabel="Close menu" />
      <Animated.View
        {...a11yModalProps()}
        accessibilityRole="menu"
        style={[
          styles.pullDown,
          { backgroundColor: menuSurface(theme), shadowColor: theme.shadowColor },
          { left: pos.left, top: pos.top, maxHeight: height * 0.6, opacity: anim, transform: [{ translateX }, { translateY }, { scale }] },
        ]}
        testID="pulldown-menu"
      >
        <ScrollView bounces={false} scrollEnabled={menuHeight > height * 0.6}>
          {req.title ? <Text style={[styles.pullDownTitle, { color: theme.muted, borderBottomColor: theme.border }]} numberOfLines={1}>{req.title}</Text> : null}
          <MenuRows items={req.items} onPick={(item) => close(item.onPress)} compact />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  previewScrim: {},
  previewColumn: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  previewCard: { borderRadius: 16, overflow: 'hidden' },
  previewHeader: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 12, gap: 10 },
  previewAvatar: { width: 32, height: 32, borderRadius: 16 },
  previewHeaderText: { flex: 1, minWidth: 0 },
  previewTitle: { fontSize: 14, fontFamily: FONT.semibold },
  previewSubtitle: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  previewBody: { fontSize: 15, lineHeight: 20, fontFamily: FONT.regular, padding: 14 },
  previewList: { marginTop: 12, borderRadius: 14, maxHeight: 360 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  rowCompact: { minHeight: ROW_HEIGHT },
  rowSeparator: { borderTopWidth: StyleSheet.hairlineWidth },
  rowDisabled: { opacity: 0.4 },
  rowLabel: { flex: 1, fontSize: 17, fontFamily: FONT.regular },
  rowIcon: { marginLeft: 12 },
  check: { width: 22, marginLeft: -4 },
  pullDown: {
    position: 'absolute',
    width: PULLDOWN_WIDTH,
    borderRadius: 13,
    overflow: 'hidden',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  pullDownTitle: {
    fontSize: 13, fontFamily: FONT.regular,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
