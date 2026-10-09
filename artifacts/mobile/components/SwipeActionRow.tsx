import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';

import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

const ACTION_WIDTH = 92;
const TRIGGER_DISTANCE = 64;

interface SwipeActionRowProps {
  children: React.ReactNode;
  label: string;
  icon: IconName;
  color: string;
  onAction: () => void | Promise<void>;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export default function SwipeActionRow({
  children,
  label,
  icon,
  color,
  onAction,
  disabled = false,
  accessibilityLabel,
}: SwipeActionRowProps) {
  const { theme } = useAppTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const actionTriggered = useRef(false);

  const reset = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 220,
    }).start();
  };

  const runAction = async () => {
    if (disabled || actionTriggered.current) return;
    actionTriggered.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await onAction();
    } finally {
      actionTriggered.current = false;
      reset();
    }
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      !disabled &&
      gesture.dx < -10 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderMove: (_, gesture) => {
      translateX.setValue(Math.max(-ACTION_WIDTH, Math.min(0, gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx <= -TRIGGER_DISTANCE || gesture.vx <= -0.7) {
        Animated.timing(translateX, {
          toValue: -ACTION_WIDTH,
          duration: 120,
          useNativeDriver: true,
        }).start(() => { void runAction(); });
      } else {
        reset();
      }
    },
    onPanResponderTerminate: reset,
  }), [disabled, onAction, translateX]);

  return (
    <View style={styles.clip}>
      <AnimatedPressable
        // Only visible while the row is actually swiped: at rest it would show as a coloured sliver in the card's margin.
        style={[styles.action, { backgroundColor: color, opacity: translateX.interpolate({ inputRange: [-ACTION_WIDTH, -1, 0], outputRange: [1, 1, 0], extrapolate: 'clamp' }) }]}
        onPress={() => { void runAction(); }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <Icon name={icon} size={18} color={theme.onAccent} />
        <Text style={[styles.actionText, { color: theme.onAccent }]}>{label}</Text>
      </AnimatedPressable>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    position: 'relative',
  },
  action: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
  },
  actionText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
});