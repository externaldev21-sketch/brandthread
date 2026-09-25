/**
 * SellerTutorialOverlay — first-time seller walkthrough shown once after onboarding.
 * Highlights the four key workspace areas: Products, Orders, Analytics, Manufacturer Hub.
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  CARD, FG, MUTED, FONT, FS, RADIUS,
} from '@/lib/theme';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

const HIGHLIGHTS: { icon: keyof typeof Feather.glyphMap; title: string; desc: string; color?: string }[] = [
  { icon: 'package', title: 'Products', desc: 'Add, edit, and manage your inventory — sizes, variants, images, and pricing.' },
  { icon: 'shopping-bag', title: 'Orders', desc: 'Track, fulfill, and ship customer orders. See real-time status updates.' },
  {
    icon:  'bar-chart-2',
    title: 'Analytics',
    desc:  'Understand your revenue, traffic sources, and top-performing products.',
  },
  {
    icon:  'tool',
    title: 'Manufacturer Hub',
    desc:  'Source production partners, request samples, and manage bulk orders.',
  },
];

export default function SellerTutorialOverlay({ visible, onDismiss }: Props) {
  const { theme } = useAppTheme();
  const highlights = HIGHLIGHTS.map((highlight, index) => ({
    ...highlight,
    color:
      index === 0 ? theme.accent :
      index === 1 ? theme.secondary :
      index === 2 ? theme.warning :
      theme.success,
  }));
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={s.backdrop}>
        <View style={[s.card, { borderColor: `${theme.accent}33` }]}>
          {/* Header */}
          <View style={s.headerRow}>
            <View style={[s.iconWrap, { backgroundColor: theme.accentDim }]}>
              <Feather name="zap" size={22} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Welcome to your workspace 👋</Text>
              <Text style={s.subtitle}>Here's a quick look at your key tools</Text>
            </View>
          </View>

          {/* Highlights */}
          <View style={s.list}>
            {highlights.map((h) => (
              <View key={h.title} style={s.item}>
                <View style={[s.itemIcon, { backgroundColor: h.color + '22' }]}>
                  <Feather name={h.icon} size={18} color={h.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemTitle}>{h.title}</Text>
                  <Text style={s.itemDesc}>{h.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* CTA */}
          <PrimaryButton
            label="Got it, let's go!"
            onPress={onDismiss}
            style={{ marginTop: 4 }}
            icon="arrow-right"
          />

          <TouchableOpacity onPress={onDismiss} style={s.skipBtn} activeOpacity={0.7}>
            <Text style={s.skipText}>Skip tour</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.80)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: RADIUS.xl ?? 20,
    borderWidth: 1,
    padding: 20,
    width: '100%',
    maxWidth: 440,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FS.md ?? 17,
    fontFamily: FONT.bold ?? 'Inter_700Bold',
    color: FG,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: FS.sm ?? 13,
    fontFamily: FONT.regular ?? 'Inter_400Regular',
    color: MUTED,
  },
  list: { gap: 12 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: {
    fontSize: FS.sm ?? 13,
    fontFamily: FONT.semibold ?? 'Inter_600SemiBold',
    color: FG,
    marginBottom: 2,
  },
  itemDesc: {
    fontSize: FS.xs ?? 12,
    fontFamily: FONT.regular ?? 'Inter_400Regular',
    color: MUTED,
    lineHeight: 18,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  skipText: {
    fontSize: FS.sm ?? 13,
    fontFamily: FONT.regular ?? 'Inter_400Regular',
    color: MUTED,
  },
});
