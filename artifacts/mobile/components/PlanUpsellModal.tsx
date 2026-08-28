/**
 * PlanUpsellModal — shown when a Starter seller taps a Growth-only feature.
 *
 * Displays the full list of Growth-only Studio tools with icons and
 * descriptions so sellers can see everything they'd unlock — not just the
 * single tool they tapped.
 *
 * Props:
 *   visible      — controls modal visibility
 *   onClose      — called when the user dismisses without upgrading
 *   onUpgrade    — called when the user taps the upgrade CTA
 *   featureName  — the locked feature the seller tapped, e.g. "AI Design Studio"
 *   requiredPlan — the minimum plan needed (default: 'growth')
 */

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, GOLD, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  featureName: string;
  requiredPlan?: 'growth' | 'pro';
}

// ─── Growth-only Studio tools (mirrors GROWTH_REQUIRED_TOOLS in studio.tsx) ──

interface GrowthTool {
  id: string;
  title: string;
  desc: string;
  icon: keyof typeof Feather.glyphMap;
  accent: string;
  accentDim: string;
}

const getGrowthStudioTools = (theme: ReturnType<typeof useAppTheme>['theme']): GrowthTool[] => [
  {
    id: 'design-studio',
    title: 'Design Studio',
    desc: 'Create product artwork, graphics and custom designs.',
    icon: 'edit-3',
    accent: theme.accent,
    accentDim: theme.accentDim,
  },
  {
    id: 'ai-photoshoot',
    title: 'AI Photoshoot',
    desc: 'Generate professional product photos with AI.',
    icon: 'camera',
    accent: BLUE,
    accentDim: BLUE_DIM,
  },
  {
    id: 'mockup-to-model',
    title: 'Mockup to Model',
    desc: 'Place your design on a realistic model.',
    icon: 'user',
    accent: ORANGE,
    accentDim: ORANGE_DIM,
  },
  {
    id: 'remove-bg',
    title: 'Remove Background',
    desc: 'Remove product backgrounds in one tap.',
    icon: 'scissors',
    accent: SUCCESS,
    accentDim: SUCCESS_DIM,
  },
  {
    id: 'bg-replace',
    title: 'Background Replace',
    desc: 'Swap or generate stunning new backgrounds.',
    icon: 'image',
    accent: theme.secondary,
    accentDim: theme.secondaryDim,
  },
  {
    id: 'ai-design',
    title: 'AI Design',
    desc: 'Describe your idea and watch unique designs appear.',
    icon: 'zap',
    accent: theme.accentLight,
    accentDim: theme.accentDim,
  },
  {
    id: 'brand-assets',
    title: 'Brand Assets',
    desc: 'Store and access logos, colors, fonts and saved assets.',
    icon: 'layers',
    accent: GOLD,
    accentDim: '#3D2A0A',
  },
  {
    id: 'campaign-gen',
    title: 'Campaign Generator',
    desc: 'Generate full marketing content and campaigns.',
    icon: 'trending-up',
    accent: '#F472B6',
    accentDim: '#4A1230',
  },
];

// Extra non-tool Growth perks shown beneath the tool list
const GROWTH_EXTRAS = [
  { icon: 'package' as const,   label: 'Unlimited products' },
  { icon: 'globe' as const,     label: 'Custom storefront + domain' },
  { icon: 'truck' as const,     label: 'Manufacturer Hub access' },
  { icon: 'bar-chart-2' as const, label: 'Advanced sales analytics' },
];

const PRO_FEATURES = [
  'Everything in Growth',
  'Advanced analytics',
  'Priority support',
  'Dedicated account manager',
  'Custom integrations',
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanUpsellModal({
  visible,
  onClose,
  onUpgrade,
  featureName,
  requiredPlan = 'growth',
}: Props) {
  const { theme } = useAppTheme();
  const growthStudioTools = React.useMemo(() => getGrowthStudioTools(theme), [theme]);
  const planLabel = requiredPlan === 'pro' ? 'Pro' : 'Growth';
  const planPrice = requiredPlan === 'pro' ? '$79' : '$29';

  function handleUpgrade() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onUpgrade();
  }

  function handleClose() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }

  // For Growth plan, show the rich tool list; for Pro, fall back to the
  // original plain-text list.
  const isGrowth = requiredPlan !== 'pro';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={handleClose}>
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>

          {/* ── Gradient header ── */}
          <LinearGradient
            colors={[...theme.primaryGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.header}
          >
            {/* Close button */}
            <TouchableOpacity style={s.closeBtn} onPress={handleClose} hitSlop={8}>
              <Feather name="x" size={18} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>

            {/* Lock icon */}
            <View style={[s.lockCircle, { backgroundColor: theme.accentDim }]}>
              <Feather name="lock" size={24} color={theme.accentLight} />
            </View>

            <Text style={s.headerTitle}>Upgrade to {planLabel}</Text>
            <Text style={s.headerSubtitle}>
              <Text style={s.featureNameText}>{featureName}</Text>
              {' '}and {isGrowth ? (growthStudioTools.length - 1) + ' more tools are' : 'more features are'} available on the {planLabel} plan ({planPrice}/mo).
            </Text>
          </LinearGradient>

          {/* ── Scrollable body ── */}
          <ScrollView
            style={s.bodyScroll}
            contentContainerStyle={s.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {isGrowth ? (
              <>
                {/* Section label */}
                <Text style={s.sectionLabel}>Studio tools you'll unlock</Text>

                {/* Full tool list */}
                {growthStudioTools.map((tool) => {
                  const isTapped = tool.title === featureName;
                  return (
                    <View
                      key={tool.id}
                      style={[s.toolRow, isTapped && { backgroundColor: theme.accentDim, borderColor: `${theme.accent}40` }]}
                    >
                      {/* Colored icon */}
                      <View style={[s.toolIconBg, { backgroundColor: tool.accentDim }]}>
                        <Feather name={tool.icon} size={16} color={tool.accent} />
                      </View>

                      {/* Labels */}
                      <View style={s.toolLabels}>
                        <View style={s.toolTitleRow}>
                          <Text style={s.toolTitle}>{tool.title}</Text>
                          {isTapped && (
                            <View style={[s.tappedBadge, { backgroundColor: `${theme.accent}30` }]}>
                              <Text style={[s.tappedBadgeText, { color: theme.accentLight }]}>You tapped this</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.toolDesc}>{tool.desc}</Text>
                      </View>
                    </View>
                  );
                })}

                {/* Divider */}
                <View style={s.divider} />

                {/* Extra perks */}
                <Text style={s.sectionLabel}>Also included</Text>
                {GROWTH_EXTRAS.map((perk) => (
                  <View key={perk.label} style={s.perkRow}>
                    <View style={s.checkCircle}>
                      <Feather name="check" size={12} color={SUCCESS} />
                    </View>
                    <Text style={s.perkText}>{perk.label}</Text>
                  </View>
                ))}
              </>
            ) : (
              <>
                <Text style={s.sectionLabel}>What you'll unlock</Text>
                {PRO_FEATURES.map((f) => (
                  <View key={f} style={s.perkRow}>
                    <View style={s.checkCircle}>
                      <Feather name="check" size={12} color={SUCCESS} />
                    </View>
                    <Text style={s.perkText}>{f}</Text>
                  </View>
                ))}
              </>
            )}

            {/* ── CTA ── */}
            <TouchableOpacity style={[s.upgradeBtn, { backgroundColor: theme.accent }]} onPress={handleUpgrade} activeOpacity={0.85}>
              <Feather name="zap" size={16} color="#FFF" />
              <Text style={s.upgradeBtnText}>Upgrade to {planLabel} — {planPrice}/mo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.laterBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={s.laterText}>Maybe later</Text>
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    overflow: 'hidden',
    maxHeight: '88%',
  },

  // ── Header ──
  header: {
    paddingTop: SP.xl,
    paddingBottom: SP.xl,
    paddingHorizontal: SP.xl,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: SP.md,
    right: SP.md,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.md,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: FS.xl,
    fontFamily: FONT.semibold,
    marginBottom: SP.xs,
    textAlign: 'center',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    lineHeight: 20,
  },
  featureNameText: {
    fontFamily: FONT.semibold,
    color: 'rgba(255,255,255,0.9)',
  },

  // ── Scrollable body ──
  bodyScroll: {
    flexGrow: 0,
  },
  body: {
    padding: SP.xl,
    paddingBottom: SP.xl,
  },

  sectionLabel: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SP.md,
  },

  // ── Tool rows ──
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    marginBottom: SP.sm,
    paddingVertical: SP.xs,
    paddingHorizontal: SP.xs,
    borderRadius: RADIUS.sm,
  },
  toolIconBg: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toolLabels: {
    flex: 1,
    paddingTop: 2,
  },
  toolTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    flexWrap: 'wrap',
  },
  toolTitle: {
    color: FG,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },
  tappedBadge: {
    borderRadius: RADIUS.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tappedBadgeText: {
    fontSize: 10,
    fontFamily: FONT.medium,
  },
  toolDesc: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    marginTop: 2,
    lineHeight: 16,
  },

  // ── Divider ──
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: SP.md,
  },

  // ── Perk rows (extras + Pro) ──
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginBottom: SP.sm,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: `${SUCCESS}18`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  perkText: {
    color: FG,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    flex: 1,
  },

  // ── CTA buttons ──
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    borderRadius: RADIUS.md,
    paddingVertical: SP.md,
    marginTop: SP.lg,
  },
  upgradeBtnText: {
    color: '#FFFFFF',
    fontSize: FS.md,
    fontFamily: FONT.semibold,
  },
  laterBtn: {
    alignItems: 'center',
    paddingVertical: SP.md,
  },
  laterText: {
    color: SUBTLE,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
  },
});
