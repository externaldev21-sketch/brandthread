import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';

import { FONT, FS, SP } from '@/lib/theme';

const ACTION_WIDTH = 72;

export interface InboxSwipeAction {
  key: string;
  label: string;
  icon: IconName;
  color: string;
  textColor: string;
  onPress: () => void | Promise<void>;
  accessibilityLabel?: string;
}

interface InboxSwipeRowProps {
  children: React.ReactNode;
  actions: InboxSwipeAction[];
  rowId: string;
  disabled?: boolean;
}

/**
 * A swipe-to-reveal row supporting several trailing actions (mute, delete,
 * mark read, …), unlike SwipeActionRow which only supports one. Swiping left
 * reveals a fixed action panel; tapping an action runs it and snaps back.
 */
export default function InboxSwipeRow({ children, actions, rowId, disabled = false }: InboxSwipeRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const panelWidth = ACTION_WIDTH * Math.max(actions.length, 1);

  const reset = () => {
    openRef.current = false;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 220,
    }).start();
  };

  const open = () => {
    openRef.current = true;
    Animated.spring(translateX, {
      toValue: -panelWidth,
      useNativeDriver: true,
      damping: 20,
      stiffness: 220,
    }).start();
  };

  const runAction = async (action: InboxSwipeAction) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    reset();
    await action.onPress();
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      !disabled &&
      Math.abs(gesture.dx) > 10 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderMove: (_, gesture) => {
      const base = openRef.current ? -panelWidth : 0;
      translateX.setValue(Math.max(-panelWidth, Math.min(0, base + gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      const base = openRef.current ? -panelWidth : 0;
      const projected = base + gesture.dx;
      if (projected <= -panelWidth / 2) {
        open();
      } else {
        reset();
      }
    },
    onPanResponderTerminate: reset,
  }), [disabled, panelWidth]);

  return (
    <View style={styles.clip}>
      <View style={[styles.actionPanel, { width: panelWidth }]}>
        {actions.map(action => (
          <Pressable
            key={action.key}
            style={[styles.action, { backgroundColor: action.color, width: ACTION_WIDTH }]}
            onPress={() => { void runAction(action); }}
            testID={`inbox-swipe-${action.key}-${rowId}`}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
          >
            <Icon name={action.icon} size={17} color={action.textColor} />
            <Text style={[styles.actionText, { color: action.textColor }]} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Animated.View
        style={[styles.foreground, { transform: [{ translateX }] }]}
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
  // Explicit stacking order (rather than relying on incidental DOM/paint
  // order) so the swipe actions can never show through the closed row on
  // web — without this, a sub-pixel layout rounding at the row's edge could
  // let a sliver of an action's tinted background peek past the foreground.
  actionPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    zIndex: 0,
    elevation: 0,
  },
  foreground: {
    zIndex: 1,
    elevation: 1,
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs / 2,
    height: '100%',
  },
  actionText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
});
