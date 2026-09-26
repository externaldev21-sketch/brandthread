import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';
import { getUnreadActivityCount, subscribeActivity, watchActivityRealtime } from '@/services/activityService';

/**
 * Unread Activity Center count. Refreshes when the host screen gains focus,
 * (debounced) whenever activity is read or dismissed anywhere in the app, and
 * short-polls every ~1.5s while this button is mounted so a new follow/like
 * elsewhere bumps the badge live (see watchActivityRealtime's own comment —
 * there is no websocket/SSE layer in this codebase).
 */
export function useActivityUnreadCount(): number {
  const [count, setCount] = useState(0);
  const mounted = useRef(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    void getUnreadActivityCount().then((next) => {
      if (mounted.current) setCount(next);
    });
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeActivity(() => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(refresh, 400);
    });
    const realtime = watchActivityRealtime(({ count: next }) => {
      if (mounted.current) setCount(next);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      realtime.stop();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [refresh]);

  return count;
}

/**
 * Header bell that opens the Activity Center, with an unread count badge.
 * `color` is the glyph colour (pass the host header's icon colour so it sits
 * naturally next to sibling icons); `size`/`style` match the host's icon
 * buttons.
 */
export default function ActivityBellButton({
  color,
  size = 20,
  style,
  badgeBorderColor,
  testID = 'activity-bell',
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Ring around the badge; defaults to the theme background. */
  badgeBorderColor?: string;
  testID?: string;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const unread = useActivityUnreadCount();
  const label = unread > 0
    ? `Activity, ${unread} unread`
    : 'Activity';

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.button, style]}
      activeOpacity={0.7}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        router.push('/activity-center' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* The badge is anchored to the glyph, so it sits correctly whatever
          hit-area size the host header gives the button. */}
      <View>
        <Feather name="bell" size={size} color={color ?? theme.text} />
        {unread > 0 && (
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.accent, borderColor: badgeBorderColor ?? theme.background },
            ]}
          >
            <Text style={[styles.badgeText, { color: theme.onAccent }]} allowFontScaling={false}>
              {unread > 99 ? '99+' : unread}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -7,
    left: '55%',
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  badgeText: {
    fontSize: FS.xs,
    lineHeight: 12,
    fontFamily: FONT.bold,
  },
});
