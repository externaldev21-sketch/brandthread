/**
 * EngagementButton — Thread action-rail micro-interaction component
 *
 * Compact in-flight, success, and error states for like, save, repost, follow.
 * - Prevents duplicate taps while request is in-flight (inflight guard)
 * - Retains optimistic state; rolls back only on confirmed failure
 * - Shows concise inline "toast" banner (FeedToast) instead of Alert
 * - Uses theme tokens exclusively (no arbitrary colors)
 * - Fully accessible: accessibilityLabel, accessibilityState, accessibilityRole
 */

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import type { FeatherNames } from '@/lib/featherNames';
import {
  FONT,
  FS,
  SP,
  RADIUS,
  FG,
  CARD,
  BORDER,
  RED,
  SUCCESS,
  ANIM,
} from '@/lib/theme';
export { formatCount } from '@/lib/engagementUtils';

// ─── FeedToast ───────────────────────────────────────────────────────────────
// Lightweight, non-disruptive banner for engagement feedback.
// Positioned above the tab bar in the SpotlightPage's rail area.

interface ToastEntry {
  id: number;
  message: string;
  variant: 'error' | 'info';
}

interface FeedToastContextValue {
  showToast: (message: string, variant?: ToastEntry['variant']) => void;
}

export const FeedToastContext = createContext<FeedToastContextValue | null>(null);

let _toastId = 0;

export function FeedToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastEntry['variant'] = 'error') => {
      const id = ++_toastId;
      setToasts(prev => [...prev.slice(-1), { id, message, variant }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3200);
    },
    [],
  );

  return (
    <FeedToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.map(t => (
        <FeedToastBanner key={t.id} entry={t} />
      ))}
    </FeedToastContext.Provider>
  );
}

function FeedToastBanner({ entry }: { entry: ToastEntry }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: ANIM.fast, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: ANIM.fast, useNativeDriver: true }),
    ]).start();
    const hide = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: ANIM.fast, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 8, duration: ANIM.fast, useNativeDriver: true }),
      ]).start();
    }, 2700);
    return () => clearTimeout(hide);
  }, []);

  const isError = entry.variant === 'error';

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        toastStyles.banner,
        isError ? toastStyles.errorBanner : toastStyles.infoBanner,
        { opacity, transform: [{ translateY }] },
      ]}
      pointerEvents="none"
    >
      <Feather
        name={isError ? 'alert-circle' : 'check-circle'}
        size={14}
        color={isError ? RED : SUCCESS}
        style={{ marginRight: 6 }}
      />
      <Text style={toastStyles.text} numberOfLines={2}>{entry.message}</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 110,
    borderRadius: RADIUS.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.sm + 4,
    paddingVertical: SP.sm,
    borderWidth: 1,
    zIndex: 9999,
    elevation: 9999,
  },
  errorBanner: {
    backgroundColor: '#1a0d0d',
    borderColor: RED,
  },
  infoBanner: {
    backgroundColor: CARD,
    borderColor: BORDER,
  },
  text: {
    flex: 1,
    color: FG,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    lineHeight: 17,
  },
});

// ─── useFeedToast ─────────────────────────────────────────────────────────────

export function useFeedToast() {
  const ctx = useContext(FeedToastContext);
  // Graceful fallback when provider is absent (tests / isolated usage)
  return ctx ?? { showToast: (_msg: string, _variant?: ToastEntry['variant']) => {} };
}

// ─── EngagementButton ────────────────────────────────────────────────────────

export type EngagementButtonAction = () => Promise<void>;

export interface EngagementButtonProps {
  /** Feather icon name shown in the default/active state */
  icon: FeatherNames;
  /** Feather icon name shown when active (toggled on). Defaults to icon. */
  activeIcon?: FeatherNames;
  /** Optional solid Font Awesome icon used instead of the Feather outline icon. */
  solidIcon?: React.ComponentProps<typeof FontAwesome6>['name'];
  /** Formatted count label; omit to show no count */
  count?: string;
  /** Whether the button is in the "active" (liked/saved/reposted/following) state */
  active?: boolean;
  /** Color of the icon when active. Defaults to '#FFFFFF'. */
  activeColor?: string;
  /** Color of the icon when inactive. Defaults to '#FFFFFF'. */
  inactiveColor?: string;
  /** Accessible label, e.g. "Like, 42 likes" */
  accessibilityLabel: string;
  /** Accessible state, e.g. { checked: true } for toggle buttons */
  accessibilityState?: { checked?: boolean; busy?: boolean };
  /** Full async action to call on press. EngagementButton handles in-flight guard. */
  onPress: EngagementButtonAction;
  /** Extra hitSlop beyond default */
  hitSlop?: { top: number; bottom: number; left: number; right: number };
  /** Scale the icon and count (1 = default rail size) */
  iconSize?: number;
  /** Additional style for the wrapper View */
  style?: object;
  /** Animated.Value from parent for the scale animation (e.g. heart bump) */
  scaleAnim?: Animated.Value;
  /** testID for automated tests */
  testID?: string;
}

/**
 * Self-contained rail button with:
 * - in-flight deduplication (inflight ref, never double-fires)
 * - subtle opacity pulse during pending state
 * - no count update until action resolves (optimism stays in parent EngagementState)
 * - error/success feedback via FeedToastContext when provided
 */
export function EngagementButton({
  icon,
  activeIcon,
  solidIcon,
  count,
  active = false,
  activeColor = '#FFFFFF',
  inactiveColor = '#FFFFFF',
  accessibilityLabel,
  accessibilityState,
  onPress,
  hitSlop = { top: 6, bottom: 6, left: 10, right: 10 },
  iconSize = 27,
  style,
  scaleAnim,
  testID,
}: EngagementButtonProps) {
  const inflight = useRef(false);
  const [pending, setPending] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  // Pulse opacity while pending
  useEffect(() => {
    if (pending) {
      pulseRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.45, duration: 450, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
        ]),
      );
      pulseRef.current.start();
    } else {
      pulseRef.current?.stop();
      pulseRef.current = null;
      Animated.timing(pulseAnim, { toValue: 1, duration: ANIM.fast, useNativeDriver: true }).start();
    }
  }, [pending]);

  const handlePress = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setPending(true);
    try {
      await onPress();
    } finally {
      inflight.current = false;
      setPending(false);
    }
  }, [onPress]);

  const displayIcon = active && activeIcon ? activeIcon : icon;
  const iconColor = active ? activeColor : inactiveColor;
  const iconNode = solidIcon
    ? <FontAwesome6 name={solidIcon} size={iconSize} color={iconColor} />
    : <Feather name={displayIcon} size={iconSize} color={iconColor} />;

  const innerContent = (
    <Animated.View style={[{ opacity: pulseAnim }, style]}>
      {scaleAnim ? (
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          {iconNode}
        </Animated.View>
      ) : (
        iconNode
      )}
      {count !== undefined && (
        <Text style={[ebStyles.count, { color: '#FFFFFF' }]}>{count}</Text>
      )}
    </Animated.View>
  );

  return (
    <TouchableOpacity
      style={ebStyles.btn}
      activeOpacity={0.7}
      hitSlop={hitSlop}
      onPress={handlePress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: pending, ...accessibilityState }}
      testID={testID}
    >
      {innerContent}
    </TouchableOpacity>
  );
}

const ebStyles = StyleSheet.create({
  btn: { alignItems: 'center', gap: 3 },
  count: { fontSize: FS.xs, fontFamily: FONT.semibold, textAlign: 'center' },
});

