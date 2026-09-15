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
import { BG, CARD, FG, FONT, FS, SP } from '@/lib/theme';
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

const POSITION_OFFSETS = [
  { top: 84, right: 18 },
  { top: 146, right: 42 },
  { top: 208, right: 54 },
  { top: 106, right: 188 },
  { top: 168, right: 212 },
  { top: 230, right: 224 },
] as const;

export default function SellerStudioRadialMenu() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();
  const progress = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  useEffect(() => () => progress.stopAnimation(), [progress]);

  const expand = () => {
    setOpen(true);
    progress.setValue(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    requestAnimationFrame(() => {
      Animated.spring(progress, {
        toValue: 1,
        damping: 18,
        stiffness: 180,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    });
  };

  const collapse = (after?: () => void) => {
    Animated.timing(progress, {
      toValue: 0,
      duration: 150,
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

      <Modal visible={open} transparent animationType="none" onRequestClose={() => collapse()}>
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            accessibilityLabel="Close Studio tools"
            onPress={() => collapse()}
            style={styles.backdrop}
          />

          {ACTIONS.map((action, index) => {
            const offset = POSITION_OFFSETS[index];
            const start = Math.min(index * 0.035, 0.3);
            const itemProgress = progress.interpolate({
              inputRange: [start, 1],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={action.id}
                style={[
                  styles.actionPosition,
                  {
                    top: insets.top + offset.top,
                    right: offset.right,
                    opacity: itemProgress,
                    transform: [
                      { translateY: itemProgress.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) },
                      { scale: itemProgress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
                    ],
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => choose(action)}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                >
                  <Text style={styles.actionLabel} numberOfLines={2}>{action.label}</Text>
                  <View style={[styles.actionIcon, { borderColor: theme.accent, backgroundColor: CARD }]}>
                    <Feather name={action.icon} size={18} color={theme.accentLight} />
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Studio tools"
            onPress={() => collapse()}
            style={[
              styles.toggle,
              {
                top: insets.top + SP.xl,
                backgroundColor: theme.accent,
                shadowColor: theme.shadowColor,
              },
            ]}
          >
            <Feather name="x" size={22} color={theme.onAccent} />
          </Pressable>
        </View>
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
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BG,
    opacity: 0.9,
  },
  actionPosition: {
    position: 'absolute',
    width: 166,
  },
  action: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SP.xs,
  },
  actionLabel: {
    flex: 1,
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    textAlign: 'right',
  },
  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BG,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});