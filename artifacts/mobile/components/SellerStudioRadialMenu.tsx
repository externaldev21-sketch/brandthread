import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED, GROWTH_STUDIO_TOOLS } from '@/lib/growthTools';
import { BG, BORDER, CARD, CARD_ELEVATED, FG, FONT, FS, MUTED, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

type StudioAction = {
  id: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  growthOnly: boolean;
};

const GROWTH_ROUTES: Record<string, string> = {
  'design-studio': '/design',
  'ai-photoshoot': '/design-ai-photoshoot',
  'mockup-to-model': '/design-mockup-to-model',
  'remove-bg': '/design-bg-removal',
  'ai-design': '/design-text-to-design',
  'campaign-gen': '/design-campaign',
};

const RADIAL_TOOL_IDS = [
  'design-studio',
  'mockup-to-model',
  'remove-bg',
  'ai-design',
  'campaign-gen',
  'ai-photoshoot',
] as const;

const ACTIONS: StudioAction[] = RADIAL_TOOL_IDS.map((id) => {
  const tool = GROWTH_STUDIO_TOOLS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Missing Studio tool definition: ${id}`);
  return {
    id: tool.id,
    label: tool.title,
    icon: tool.icon,
    route: GROWTH_ROUTES[tool.id],
    growthOnly: true,
  };
});

// Height per row: icon 44 + vertical padding
const ROW_HEIGHT = 60;
// Stagger delay (ms) between each row animating in
const STAGGER_MS = 38;

export default function SellerStudioRadialMenu() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();

  // Master progress for backdrop + close button
  const progress = useRef(new Animated.Value(0)).current;
  // Per-item animated values for staggered entry
  const itemAnims = useRef(ACTIONS.map(() => new Animated.Value(0))).current;

  const [open, setOpen] = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  useEffect(() => () => {
    progress.stopAnimation();
    itemAnims.forEach((a) => a.stopAnimation());
  }, [progress, itemAnims]);

  const expand = () => {
    setOpen(true);
    progress.setValue(0);
    itemAnims.forEach((a) => a.setValue(0));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    requestAnimationFrame(() => {
      // Backdrop + toggle button fade in quickly
      Animated.spring(progress, {
        toValue: 1,
        damping: 22,
        stiffness: 220,
        mass: 0.6,
        useNativeDriver: true,
      }).start();

      // Items stagger from center outward — animate sequentially with delay
      ACTIONS.forEach((_, i) => {
        Animated.spring(itemAnims[i], {
          toValue: 1,
          damping: 20,
          stiffness: 200,
          mass: 0.55,
          delay: i * STAGGER_MS,
          useNativeDriver: true,
        }).start();
      });
    });
  };

  const collapse = (after?: () => void) => {
    // Reverse stagger: last item out first
    const reverseAnims = [...itemAnims].reverse();
    reverseAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 100,
        delay: i * 20,
        useNativeDriver: true,
      }).start();
    });
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setOpen(false);
      after?.();
    });
  };

  const choose = (action: StudioAction) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      action.growthOnly &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      collapse(() => setUpsellFeature(action.label));
      return;
    }
    collapse(() => router.push(action.route as never));
  };

  return (
    <>
      {!open && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Studio tools"
          onPress={expand}
          style={({ pressed }) => [
            styles.toggle,
            {
              top: insets.top + SP.xl,
              backgroundColor: theme.accent,
              shadowColor: theme.shadowColor,
            },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="zap" size={22} color={theme.onAccent} />
        </Pressable>
      )}

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => collapse()}
      >
        {/* ── Backdrop — very dark so home content reads as inactive ── */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.backdrop,
            { opacity: progress },
          ]}
          pointerEvents="none"
        />

        {/* Tap-to-dismiss layer */}
        <Pressable
          accessibilityLabel="Close Studio tools"
          onPress={() => collapse()}
          style={StyleSheet.absoluteFill}
        />

        {/* ── Centered vertical list ── */}
        <View style={styles.listWrap} pointerEvents="box-none">
          {ACTIONS.map((action, index) => {
            const anim = itemAnims[index];

            // Each row travels from the lightning trigger's top-right area
            // into its final position in the centered list.
            const translateX = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [150, 0],
            });
            const translateY = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-(140 + index * (ROW_HEIGHT + 6)), 0],
            });
            const opacity = anim;
            const scale = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.88, 1],
            });

            return (
              <Animated.View
                key={action.id}
                style={[
                  styles.rowWrap,
                  { opacity, transform: [{ translateX }, { translateY }, { scale }] },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => choose(action)}
                  style={({ pressed }) => [
                    styles.actionRow,
                    pressed && styles.actionRowPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { borderColor: BORDER, backgroundColor: CARD },
                    ]}
                  >
                    <Feather name={action.icon} size={20} color={theme.accentLight} />
                  </View>
                  <Text style={styles.actionLabel} numberOfLines={1}>
                    {action.label}
                  </Text>
                  <Feather name="chevron-right" size={16} color={MUTED} />
                </Pressable>
              </Animated.View>
            );
          })}
        </View>

        {/* Close button — stays at its trigger position */}
        <Animated.View
          style={[
            styles.toggle,
            {
              top: insets.top + SP.xl,
              backgroundColor: theme.accent,
              shadowColor: theme.shadowColor,
              opacity: progress,
              transform: [
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Studio tools"
            onPress={() => collapse()}
            style={styles.toggleInner}
          >
            <Feather name="x" size={22} color={theme.onAccent} />
          </Pressable>
        </Animated.View>
      </Modal>

      <PlanUpsellModal
        visible={upsellFeature !== null}
        featureName={upsellFeature ?? ''}
        requiredPlan="growth"
        onClose={() => setUpsellFeature(null)}
        onUpgrade={() => {
          setUpsellFeature(null);
          router.push('/subscription' as never);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  toggle: {
    position: 'absolute',
    right: SP.md,
    zIndex: 1200,
    elevation: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  toggleInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },

  // Backdrop: substantially darker than before (was BG at 0.9 opacity which
  // made home content look nearly identical to the active state).
  backdrop: {
    backgroundColor: BG,
  },

  // Centered container — list sits in vertical center of screen
  listWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
    gap: 6,
  },

  rowWrap: {
    width: '100%',
    maxWidth: 360,
  },

  actionRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.sm,
    gap: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  actionRowPressed: {
    backgroundColor: CARD_ELEVATED,
    transform: [{ scale: 0.98 }],
  },

  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionLabel: {
    flex: 1,
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    letterSpacing: -0.1,
  },
});
