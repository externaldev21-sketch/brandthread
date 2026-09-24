import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { setNotificationBannerListener, type BannerPayload } from '@/lib/notificationBannerBus';
import { createNotificationResponseHandler } from '@/lib/notificationNavigation';

const AUTO_DISMISS_MS = 4500;
const ICON_BY_CATEGORY: Record<string, keyof typeof Feather.glyphMap> = {
  order: 'package', orders: 'package',
  message: 'message-circle', messages: 'message-circle',
  drop: 'zap', drops: 'zap',
  social: 'users',
  stock: 'tag', pricing: 'tag',
  payout: 'dollar-sign', payouts: 'dollar-sign', finance: 'dollar-sign',
  return: 'refresh-ccw', returns: 'refresh-ccw',
  production: 'tool',
  dispute: 'alert-triangle', disputes: 'alert-triangle',
  subscription: 'star',
};

/**
 * Mounted once near the app root (app/_layout.tsx). Foreground pushes are
 * suppressed at the OS level (see the notification handler in _layout.tsx)
 * and routed here instead, so the banner always matches the active theme
 * rather than the system's native alert styling.
 */
export default function NotificationBanner() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [payload, setPayload] = useState<BannerPayload | null>(null);
  const translateY = useRef(new Animated.Value(-200)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(false);

  const hide = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (!visibleRef.current) return;
    visibleRef.current = false;
    Animated.timing(translateY, {
      toValue: -200,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setPayload(null));
  }, [translateY]);

  useEffect(() => {
    const onShow = (next: BannerPayload) => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      visibleRef.current = true;
      setPayload(next);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      translateY.setValue(-200);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 16,
        bounciness: 6,
      }).start();
      dismissTimer.current = setTimeout(hide, AUTO_DISMISS_MS);
    };
    setNotificationBannerListener(onShow);
    return () => setNotificationBannerListener(null);
  }, [hide, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => gesture.dy < -6,
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy < 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy < -24) hide();
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  if (!payload) return null;

  const icon = ICON_BY_CATEGORY[payload.category ?? ''] ?? 'bell';

  const handlePress = () => {
    hide();
    const navigate = createNotificationResponseHandler({ push: (href) => router.push(href as never) });
    navigate({
      notification: {
        request: {
          identifier: payload.id,
          content: { data: payload.data ?? {} },
        },
      },
    } as any);
  };

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + SP.xs }]}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.card,
          {
            backgroundColor: theme.cardElevated,
            borderColor: theme.border,
            shadowColor: theme.shadowColor,
            transform: [{ translateY }],
          },
        ]}
      >
        <TouchableOpacity activeOpacity={0.85} onPress={handlePress} style={styles.content}>
          <View style={[styles.iconWrap, { backgroundColor: theme.accentDim }]}>
            <Feather name={icon} size={18} color={theme.accent} />
          </View>
          <View style={styles.textWrap}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{payload.title}</Text>
            {!!payload.body && (
              <Text style={[styles.body, { color: theme.muted }]} numberOfLines={2}>{payload.body}</Text>
            )}
          </View>
          <TouchableOpacity hitSlop={12} onPress={hide} style={styles.closeButton}>
            <Feather name="x" size={16} color={theme.muted} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    width: '94%',
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SP.sm,
    paddingHorizontal: SP.sm,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SP.sm,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  body: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    marginTop: 2,
  },
  closeButton: {
    padding: SP.xs,
    marginLeft: SP.xs,
  },
});
