import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { FONT, FS, FG, SP } from '@/lib/theme';

const ACTION_WIDTH = 92;
const TRIGGER_DISTANCE = 64;

interface SwipeActionRowProps {
  children: React.ReactNode;
  label: string;
  icon: keyof typeof Feather.glyphMap;
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
      <Pressable
        style={[styles.action, { backgroundColor: color }]}
        onPress={() => { void runAction(); }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <Feather name={icon} size={18} color={FG} />
        <Text style={styles.actionText}>{label}</Text>
      </Pressable>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

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
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
});