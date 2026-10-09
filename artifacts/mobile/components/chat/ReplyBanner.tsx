import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS, SP, ICON } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

interface ReplyBannerProps {
  fromName: string;
  /** Already-resolved preview text — the quoted message's own text, or a
   *  fallback like "Photo"/"Voice message" for an attachment-only original. */
  previewText: string;
  onCancel: () => void;
  theme: AppThemePreset;
  testID?: string;
}

/**
 * "Replying to {name} / {quoted text}" — sits directly above the composer
 * while a swipe-to-reply (or the long-press sheet's Reply) is staged. A
 * clean fade + slight rise on mount, never a bounce/spring — this is UI
 * chrome, not the swipe-release gesture itself (see SwipeToReplyBubble's own
 * doc comment on that distinction).
 */
export function ReplyBanner({ fromName, previewText, onCancel, theme, testID }: ReplyBannerProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const s = styles(theme);
  return (
    <Animated.View
      testID={testID}
      style={[
        s.bar,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      <Icon name="corner-up-left" size={ICON.sm} color={theme.accent} />
      <View style={{ flex: 1, marginLeft: SP.sm }}>
        <Text style={s.fromName} numberOfLines={1}>Replying to {fromName}</Text>
        <Text style={s.previewText} numberOfLines={1}>{previewText}</Text>
      </View>
      <PressableScale rippleEnabled={false}
        onPress={onCancel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        testID={testID ? `${testID}-cancel` : undefined}
      >
        <Text style={s.close}>×</Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = (theme: AppThemePreset) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  fromName: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.accent,
  },
  previewText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 1,
  },
  close: {
    fontSize: FS.md,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginLeft: SP.sm,
  },
});
