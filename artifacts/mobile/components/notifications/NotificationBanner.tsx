import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAuth } from '@clerk/expo';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { TYPE_SCALE } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import * as Haptics from 'expo-haptics';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { setNotificationBannerListener, type BannerPayload } from '@/lib/notificationBannerBus';
import { createNotificationResponseHandler } from '@/lib/notificationNavigation';

const AUTO_DISMISS_MS = 4500;
/** Solid sheet gray (BRANDTHREAD_DESIGN.md: sheets may use #1C1C1E, never translucent). */
const SHEET_SURFACE = '#1C1C1E';

const ICON_BY_CATEGORY: Record<string, IconName> = {
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
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();
  const { userId } = useAuth();
  // The chat on screen already shows its new messages live; like Instagram,
  // no banner for the conversation you're in.
  const pathname = usePathname();
  const { id: routeId } = useGlobalSearchParams<{ id?: string }>();
  const openChatRef = useRef<string | null>(null);
  openChatRef.current = /(?:buyer|seller)-conversation$/.test(pathname ?? '') && typeof routeId === 'string' ? routeId : null;
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
      const target = next.data?.targetType === 'conversation' ? next.data?.targetId : null;
      if (target && target === openChatRef.current) return;
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

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const actorName = typeof data.actorName === 'string' && data.actorName ? data.actorName : null;
  // A push for another signed-in account says which one (tap switches to it).
  const accountId = typeof data.accountId === 'string' ? data.accountId : null;
  const accountHandle = typeof data.accountHandle === 'string' && data.accountHandle ? data.accountHandle : null;
  const forOtherAccount = !!accountId && !!userId && accountId !== userId && !!accountHandle;

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
    <View pointerEvents="box-none" style={[styles.host, { top: headerTopInset + SP.xs }]}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.card, { backgroundColor: SHEET_SURFACE, transform: [{ translateY }] }]}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handlePress}
          style={styles.content}
          accessibilityRole="button"
          accessibilityLabel={payload.body ? `${payload.title}. ${payload.body}` : payload.title}
          accessibilityHint="Opens the notification. Swipe up to dismiss."
          testID="notification-banner"
        >
          {actorName ? (
            <Avatar name={actorName} size={40} />
          ) : (
            <View style={[styles.iconWrap, { backgroundColor: theme.background }]}>
              <Icon name={ICON_BY_CATEGORY[payload.category ?? ''] ?? 'bell'} size={17} color={theme.text} />
            </View>
          )}
          <View style={styles.textWrap}>
            {forOtherAccount ? (
              <Text style={[styles.account, { color: theme.muted }]} numberOfLines={1}>@{accountHandle!.replace(/^@/, '')}</Text>
            ) : null}
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{payload.title}</Text>
            {!!payload.body && (
              <Text style={[styles.body, { color: theme.text }]} numberOfLines={2}>{payload.body}</Text>
            )}
          </View>
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
    borderRadius: RADII.sheet,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.sm,
    paddingHorizontal: SP.md,
    minHeight: 64,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  account: {
    ...TYPE_SCALE.caption,
    marginBottom: 1,
  },
  title: {
    ...TYPE_SCALE.callout,
    fontFamily: FONT.semibold,
  },
  body: {
    ...TYPE_SCALE.callout,
    marginTop: 1,
  },
});
