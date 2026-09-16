import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED, GROWTH_STUDIO_TOOLS } from '@/lib/growthTools';
import { BG, BORDER, CARD, CARD_ELEVATED, FG, FONT, FS, MUTED, RADIUS, SP, SUBTLE } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type MenuAction = {
  id: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  /** Growth plan required to access this action */
  growthOnly: boolean;
};

// ─── Studio actions (existing six, Growth-gated) ─────────────────────────────

const GROWTH_ROUTES: Record<string, string> = {
  'design-studio':  '/design',
  'ai-photoshoot':  '/design-ai-photoshoot',
  'mockup-to-model':'/design-mockup-to-model',
  'remove-bg':      '/design-bg-removal',
  'ai-design':      '/design-text-to-design',
  'campaign-gen':   '/design-campaign',
};

const STUDIO_TOOL_IDS = [
  'design-studio',
  'mockup-to-model',
  'remove-bg',
  'ai-design',
  'campaign-gen',
  'ai-photoshoot',
] as const;

const STUDIO_ACTIONS: MenuAction[] = STUDIO_TOOL_IDS.map((id) => {
  const tool = GROWTH_STUDIO_TOOLS.find((c) => c.id === id);
  if (!tool) throw new Error(`Missing Studio tool definition: ${id}`);
  return {
    id: tool.id,
    label: tool.title,
    icon: tool.icon,
    route: GROWTH_ROUTES[tool.id],
    growthOnly: true,
  };
});

// ─── Shortcut actions (not Growth-gated here; destinations handle access) ────

const SHORTCUT_ACTIONS: MenuAction[] = [
  { id: 'create-post',  label: 'Create post',       icon: 'video',       route: '/create-post', growthOnly: false },
  { id: 'add-product',  label: 'Add new product',   icon: 'package',     route: '/add-product', growthOnly: false },
  { id: 'boost',        label: 'Boost',              icon: 'trending-up', route: '/boost',        growthOnly: false },
];

// ─── Layout constants ─────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const SHEET_WIDTH  = Math.min(SCREEN_WIDTH - 48, 360);
const ROW_HEIGHT   = 60;
const STAGGER_MS   = 32; // ms between each row animating in

// Total animated items = studio (6) + shortcuts (3) = 9
const ALL_ACTIONS  = [...STUDIO_ACTIONS, ...SHORTCUT_ACTIONS];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SellerStudioRadialMenu() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { theme } = useAppTheme();
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } =
    useSubscriptionPlan();

  // One progress value drives backdrop + close-button.
  const progress  = useRef(new Animated.Value(0)).current;
  // One animated value per row (studio + shortcuts in order).
  const itemAnims = useRef(ALL_ACTIONS.map(() => new Animated.Value(0))).current;

  const [open, setOpen]               = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  useEffect(() => () => {
    progress.stopAnimation();
    itemAnims.forEach((a) => a.stopAnimation());
  }, [progress, itemAnims]);

  // ── Open ──────────────────────────────────────────────────────────────────

  const expand = () => {
    setOpen(true);
    progress.setValue(0);
    itemAnims.forEach((a) => a.setValue(0));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    requestAnimationFrame(() => {
      Animated.spring(progress, {
        toValue: 1,
        damping: 22,
        stiffness: 220,
        mass: 0.6,
        useNativeDriver: true,
      }).start();

      ALL_ACTIONS.forEach((_, i) => {
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

  // ── Close ─────────────────────────────────────────────────────────────────

  const collapse = (after?: () => void) => {
    [...itemAnims].reverse().forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 90,
        delay: i * 18,
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

  // ── Choose ────────────────────────────────────────────────────────────────

  const choose = (action: MenuAction) => {
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

  // ── Row renderer ──────────────────────────────────────────────────────────

  const renderRow = (action: MenuAction, globalIndex: number) => {
    const anim = itemAnims[globalIndex];
    const opacity    = anim;
    const translateY = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [20 + globalIndex * 4, 0],
    });
    const scale = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.9, 1],
    });

    return (
      <Animated.View
        key={action.id}
        style={[
          styles.rowWrap,
          { width: SHEET_WIDTH, opacity, transform: [{ translateY }, { scale }] },
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
          <View style={[styles.actionIcon, { borderColor: BORDER, backgroundColor: CARD }]}>
            <Feather name={action.icon} size={20} color={theme.accentLight} />
          </View>
          <Text style={styles.actionLabel} numberOfLines={1}>
            {action.label}
          </Text>
          <Feather name="chevron-right" size={16} color={MUTED} />
        </Pressable>
      </Animated.View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Lightning-bolt trigger — hidden while modal is open */}
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
        {/* Solid dark backdrop */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}
          pointerEvents="none"
        />

        {/* Full-screen tap-to-dismiss */}
        <Pressable
          accessibilityLabel="Close Studio tools"
          onPress={() => collapse()}
          style={StyleSheet.absoluteFill}
        />

        {/* ── Scrollable centered content ── */}
        <View
          style={[
            styles.outerWrap,
            {
              paddingTop: insets.top + 88,
              paddingBottom: Math.max(insets.bottom + 32, 48),
            },
          ]}
          pointerEvents="box-none"
        >
          <ScrollView
            style={{
              width: SHEET_WIDTH,
              maxHeight: Math.max(320, screenHeight - insets.top - insets.bottom - 136),
            }}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            scrollEnabled
            alwaysBounceVertical={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Section: Main menu ── */}
            <Text style={styles.sectionHeading}>Main menu</Text>

            {STUDIO_ACTIONS.map((action, i) => renderRow(action, i))}

            {/* ── Spacer between sections ── */}
            <View style={styles.sectionSpacer} />

            {/* ── Section: Shortcuts ── */}
            <Text style={styles.sectionHeading}>Shortcuts</Text>

            {SHORTCUT_ACTIONS.map((action, i) =>
              renderRow(action, STUDIO_ACTIONS.length + i),
            )}
          </ScrollView>
        </View>

        {/* Close button at the trigger position */}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Lightning-bolt / close toggle
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

  // Backdrop: 0.88 black — substantially darker than the previous BG alias
  backdrop: {
    backgroundColor: BG,
  },

  // Outer wrapper centers the scroll list on screen
  outerWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: SP.lg,
  },

  // Section heading — uppercase label above each group
  sectionHeading: {
    width: SHEET_WIDTH,
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.sm,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
    paddingHorizontal: 4,
  },

  // Gap between the two sections
  sectionSpacer: {
    height: SP.lg,
  },

  rowWrap: {
    // width set inline per SHEET_WIDTH
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
