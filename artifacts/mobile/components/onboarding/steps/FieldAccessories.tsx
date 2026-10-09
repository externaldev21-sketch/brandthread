/**
 * Trailing accessories for the onboarding Input: Instagram's clear (x) button,
 * the show/hide password eye, and the "available" check on the username field.
 */
import React from 'react';
import { Pressable } from 'react-native';
import { Icon } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

/** Switch-on green: the one accent Dev allows besides LIVE red and Thread Cash. */
export const AVAILABLE_GREEN = '#34C759';

export function ClearButton({ visible, onPress, label = 'Clear' }: { visible: boolean; onPress: () => void; label?: string }) {
  const palette = useColors();
  if (!visible) return null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} testID="onboarding-input-clear">
      <Icon name="x" size={20} color={palette.mutedForeground} />
    </Pressable>
  );
}

export function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const palette = useColors();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={shown ? 'Hide password' : 'Show password'}
      hitSlop={10}
    >
      <Icon name={shown ? 'eye-off' : 'eye'} size={20} color={palette.mutedForeground} />
    </Pressable>
  );
}

export function AvailableCheck({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <Icon name="check-circle" size={20} color={AVAILABLE_GREEN} testID="onboarding-username-available" />;
}
