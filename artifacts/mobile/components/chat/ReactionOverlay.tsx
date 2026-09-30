/**
 * Long-press message reactions — Glass overlay.
 *
 * Mobbin reference: Instagram DM "Tap and hold to super react"
 * (mobbin.com/screens/5d13fdd9-75ad-43d6-9089-7b236e362b73). Long-pressing a
 * bubble dims/blurs the thread behind it, floats a row of 6 emoji reactions
 * above the (now visually elevated) bubble with a hint label above the row,
 * and shows a standard context menu below the bubble at the same time.
 *
 * Built entirely on the shared `<Glass/>` primitive (components/ui/Glass.tsx)
 * — no new blur/overlay chrome. The glass/menu chrome stays monochrome; only
 * the emoji glyphs themselves are colorful. Reveal is a plain fade + scale
 * (Animated.timing, no spring) — never a bounce/overshoot.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, Modal, Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Glass } from '@/components/ui/Glass';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { RADII } from '@/constants/radii';
import { FADE_MS } from '@/constants/motion';
import { REACTION_CONFIG, ReactionGlyph } from './ReactionBar';
import type { ReactionType } from '@/services/socialTypes';

export type ReactionOverlayAnchor = { x: number; y: number; width: number; height: number };

export type ReactionOverlayMenuItem = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  destructive?: boolean;
  onPress: () => void;
};

export interface ReactionOverlayProps {
  visible: boolean;
  /** The pressed bubble's position/size, measured in window coordinates
   *  (View#measureInWindow) right before the overlay opens. `null` while
   *  that measurement hasn't resolved yet — the overlay stays hidden. */
  anchor: ReactionOverlayAnchor | null;
  isOwn: boolean;
  /** Style for the elevated bubble clone — should match the real bubble's
   *  background/corner-radius so it reads as the same bubble, just raised. */
  bubbleStyle: StyleProp<ViewStyle>;
  bubbleContent: React.ReactNode;
  selected: ReactionType | null;
  onSelectReaction: (type: ReactionType) => void;
  menuItems: ReactionOverlayMenuItem[];
  onClose: () => void;
}

const EMOJI_SIZE = 26;
const EMOJI_SIZE_SELECTED = 30;
const SCREEN_MARGIN = 16;

export function ReactionOverlay({
  visible, anchor, isOwn, bubbleStyle, bubbleContent, selected, onSelectReaction, menuItems, onClose,
}: ReactionOverlayProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const anim = useRef(new Animated.Value(0)).current;
  const [rowH, setRowH] = useState(0);
  const [menuH, setMenuH] = useState(0);
  const ready = anchor != null && rowH > 0 && (menuItems.length === 0 || menuH > 0);

  // A fresh long-press (new anchor position) invalidates any layout measured
  // for the previous message, so the next open re-measures instead of
  // reusing stale sizes for one frame.
  useEffect(() => { setRowH(0); setMenuH(0); }, [anchor?.x, anchor?.y]);

  useEffect(() => {
    if (visible && ready) {
      Animated.timing(anim, {
        toValue: 1,
        duration: FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    } else if (!visible) {
      anim.setValue(0);
    }
  }, [visible, ready, anim]);

  if (!visible || !anchor) return null;

  const { width: screenW, height: screenH } = Dimensions.get('window');
  const topInset = headerTopInset + 8;
  const bottomInset = insets.bottom + 8;
  const hintBlockH = 26;

  const rowTop = Math.max(topInset, anchor.y - rowH - hintBlockH - 10);
  const menuTop = Math.min(anchor.y + anchor.height + 10, screenH - menuH - bottomInset);
  const bubbleLeft = Math.min(Math.max(anchor.x, SCREEN_MARGIN), Math.max(SCREEN_MARGIN, screenW - anchor.width - SCREEN_MARGIN));
  const sidePos: ViewStyle = isOwn
    ? { right: Math.max(SCREEN_MARGIN, screenW - anchor.x - anchor.width) }
    : { left: Math.max(SCREEN_MARGIN, anchor.x) };

  // Clean fade-in only — no scale/bounce on the whole screen (which would
  // displace the precisely-anchored bubble clone as it scaled from center).
  const opacity = anim;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close reactions"
        >
          <Glass variant="regular" tint="dark" radius={0} style={StyleSheet.absoluteFill} />
        </Pressable>

        {/* Elevated bubble clone — visually raised above the blur. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: anchor.y, left: bubbleLeft, width: anchor.width }}>
          <View style={[bubbleStyle, s.elevatedShadow]}>{bubbleContent}</View>
        </View>

        {/* "Tap and hold to react" hint + floating emoji row */}
        <View onLayout={(e) => setRowH(e.nativeEvent.layout.height)} style={[s.rowWrap, { top: rowTop }]}>
          <Text style={s.hint}>Tap and hold to react</Text>
          <Glass variant="regular" tint="dark" radius={RADII.pill} style={s.row}>
            {REACTION_CONFIG.map((r) => {
              const isSelected = selected === r.type;
              return (
                <PressableScale
                  key={r.type}
                  rippleEnabled={false}
                  bounce={false}
                  noMinHeight
                  style={s.emojiBtn}
                  onPress={() => onSelectReaction(r.type)}
                  accessibilityLabel={r.label}
                  testID={`reaction-emoji-${r.type}`}
                >
                  <ReactionGlyph type={r.type} size={isSelected ? EMOJI_SIZE_SELECTED : EMOJI_SIZE} />
                </PressableScale>
              );
            })}
          </Glass>
        </View>

        {/* Context menu (Reply / Copy / Delete / Report, whichever apply) */}
        {menuItems.length > 0 && (
          <View
            onLayout={(e) => setMenuH(e.nativeEvent.layout.height)}
            style={[s.menuWrap, { top: menuTop }, sidePos]}
          >
            <Glass variant="regular" tint="dark" radius={RADII.card} style={s.menuGlass}>
              {menuItems.map((item, idx) => (
                <PressableScale
                  key={item.key}
                  rippleEnabled={false}
                  bounce={false}
                  style={[s.menuItem, idx > 0 && s.menuItemBorder]}
                  onPress={item.onPress}
                  testID={`reaction-menu-${item.key}`}
                >
                  <Text style={[s.menuLabel, item.destructive && { color: theme.error }]}>{item.label}</Text>
                  <Feather name={item.icon} size={16} color={item.destructive ? theme.error : '#fff'} />
                </PressableScale>
              ))}
            </Glass>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  rowWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hint: { fontSize: FS.xs, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.7)', marginBottom: 8 },
  row: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6, gap: 2 },
  emojiBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuWrap: { position: 'absolute', minWidth: 190, maxWidth: 260 },
  menuGlass: { paddingVertical: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  menuItemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#666666' },
  menuLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: '#fff' },
  elevatedShadow: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
});
