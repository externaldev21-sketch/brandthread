/**
 * Brandthread AI Brain — Floating Action Button (Nub Edition)
 *
 * Default state: a small purple nub sitting on the right edge of the screen.
 * Tapping the nub slides the full circular button into view (tap 1).
 * Tapping the expanded button opens the AI Brain screen (tap 2).
 * Auto-collapses back to nub after 3 s if the user doesn't proceed.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Keyboard, Platform, Pressable, StyleSheet, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { AIScreenContext } from '@/services/aiTypes';
import * as Haptics from 'expo-haptics';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AIBrainFABProps {
  context: AIScreenContext;
  /**
   * Additional bottom offset — use when tab bar is present.
   * Default: 0 (the component already respects safeArea.bottom).
   */
  bottomOffset?: number;
  /** Hides the FAB completely — useful when a local overlay is open */
  hidden?: boolean;
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

const SIZE    = 52;  // diameter of the full circular button
const MARGIN  = 16;  // right margin when fully expanded
const NUB_PX  = 18;  // visible pixels of the circle in collapsed state

// translateX needed so only NUB_PX of the circle peeks from the right edge.
// container sits at `right: MARGIN`. Its right edge = MARGIN from screen right.
// Left edge of button = MARGIN + SIZE from screen right.
// With translateX = T, left edge → MARGIN + SIZE - T from screen right.
// Visible width = MARGIN + SIZE - T → set equal to NUB_PX:
//   T = MARGIN + SIZE - NUB_PX = 16 + 52 - 18 = 50
const COLLAPSED_TX = MARGIN + SIZE - NUB_PX; // 50

const AUTO_COLLAPSE_MS = 3000;

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIBrainFAB({
  context,
  bottomOffset = 0,
  hidden = false,
}: AIBrainFABProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [expanded, setExpanded] = useState(false);
  const slideX  = useRef(new Animated.Value(COLLAPSED_TX)).current; // starts collapsed
  const opacity = useRef(new Animated.Value(1)).current;
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Keyboard hide/show ──────────────────────────────────────────────────────
  useEffect(() => {
    const listeners = [
      Keyboard.addListener(
        Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
        _hideForKeyboard,
      ),
      Keyboard.addListener(
        Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
        _showAfterKeyboard,
      ),
    ];
    return () => listeners.forEach(l => l.remove());
  }, []);

  function _hideForKeyboard() {
    Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
  }
  function _showAfterKeyboard() {
    if (hidden) return;
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }

  // ── React to `hidden` prop ─────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: hidden ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [hidden]);

  // ── Cleanup timer on unmount ───────────────────────────────────────────────
  useEffect(() => () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function collapseToNub() {
    setExpanded(false);
    Animated.spring(slideX, {
      toValue: COLLAPSED_TX,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
    }).start();
  }

  function scheduleAutoCollapse() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(collapseToNub, AUTO_COLLAPSE_MS);
  }

  // ── Press handler ──────────────────────────────────────────────────────────

  function handlePress() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);

    if (!expanded) {
      // Tap 1: slide the full button into view
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setExpanded(true);
      Animated.spring(slideX, {
        toValue: 0,
        useNativeDriver: true,
        damping: 16,
        stiffness: 200,
      }).start();
      scheduleAutoCollapse();
    } else {
      // Tap 2: open AI Brain, then collapse
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      collapseToNub();
      router.push({
        pathname: '/ai-brain',
        params: { context: JSON.stringify(context) },
      });
    }
  }

  // ── Don't render on web ────────────────────────────────────────────────────
  if (Platform.OS === 'web') return null;

  // Slightly lower than the old 16px base — now 8px above safe area / offset.
  const bottom = 8 + insets.bottom + bottomOffset;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom,
          opacity,
          transform: [{ translateX: slideX }],
        },
      ]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        accessibilityLabel={expanded ? 'Open Brandthread AI' : 'Reveal Brandthread AI button'}
        accessibilityRole="button"
      >
        {/* Purple glow ring — bleeds left of the circle; visible even when collapsed */}
        <View style={styles.glow} />

        {/* Main gradient circle */}
        <LinearGradient
          colors={['#8B5CF6', '#6D28D9']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <BrandthreadLogo size={22} opacity={1} />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: MARGIN,
    zIndex: 9999,
    elevation: 10,
  },
  pressable: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.93 }],
  },
  glow: {
    position: 'absolute',
    width: SIZE + 16,
    height: SIZE + 16,
    borderRadius: (SIZE + 16) / 2,
    backgroundColor: 'rgba(139,92,246,0.22)',
    top: -8,
    left: -8,
  },
  gradient: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 8,
  },
});
