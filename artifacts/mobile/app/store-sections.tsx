import React, { useState } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard,
} from '@/components/BrandthreadUI';
import { createSection, getStorefront } from '@/services/storeService';
import { StoreSectionType, SECTION_TYPE_LABELS } from '@/services/storeTypes';

const SECTION_CATALOG = [
  {
    category: 'Hero', sections: [
      { type: 'hero_image', icon: 'maximize', desc: 'Full-width image with heading and button.' },
      { type: 'hero_video', icon: 'play-circle', desc: 'Autoplay video with overlay text.' },
      { type: 'hero_slideshow', icon: 'image', desc: 'Multiple images or videos in a carousel.' },
    ],
  },
  {
    category: 'Products', sections: [
      { type: 'featured_collection', icon: 'grid', desc: 'Showcase a specific collection.' },
      { type: 'product_grid', icon: 'layout', desc: 'Grid of products from your catalog.' },
      { type: 'featured_product', icon: 'shopping-bag', desc: 'Spotlight a single product.' },
    ],
  },
  {
    category: 'Content', sections: [
      { type: 'image_with_text', icon: 'align-left', desc: 'Image next to a text block.' },
      { type: 'video_with_text', icon: 'film', desc: 'Video next to a text block.' },
      { type: 'brand_story', icon: 'book-open', desc: 'Your brand narrative and values.' },
      { type: 'lookbook', icon: 'camera', desc: 'Editorial photo grid.' },
    ],
  },
  {
    category: 'Social Proof', sections: [
      { type: 'customer_reviews', icon: 'star', desc: 'Display buyer reviews and ratings.' },
      { type: 'seller_posts', icon: 'video', desc: 'Your Thread posts on the storefront.' },
      { type: 'social_feed', icon: 'rss', desc: 'Social media content (upload required).' },
      { type: 'logo_list', icon: 'award', desc: 'Partner or press logos.' },
    ],
  },
  {
    category: 'Marketing', sections: [
      { type: 'drop_countdown', icon: 'clock', desc: 'Countdown timer for your next drop.' },
      { type: 'announcement', icon: 'bell', desc: 'Banner with text and optional link.' },
      { type: 'newsletter', icon: 'mail', desc: 'Email capture with call to action.' },
      { type: 'before_after', icon: 'columns', desc: 'Side-by-side comparison slider.' },
    ],
  },
  {
    category: 'Utility', sections: [
      { type: 'faq', icon: 'help-circle', desc: 'Frequently asked questions.' },
      { type: 'text_banner', icon: 'type', desc: 'Bold text headline.' },
      { type: 'spacer', icon: 'minus', desc: 'Empty space between sections.' },
      { type: 'custom_block', icon: 'code', desc: 'Custom content block.' },
    ],
  },
];

export default function StoreSectionsScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState<string | null>(null);

  async function handleAdd(sectionType: string) {
    if (adding) return;
    setAdding(sectionType);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await createSection(sectionType as StoreSectionType);
      Alert.alert('Section added.', undefined, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Error', 'Failed to add section. Please try again.');
    } finally {
      setAdding(null);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Section</Text>
      </View>

      <Text style={styles.subtitle}>Choose a section to add to your homepage.</Text>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SP.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {SECTION_CATALOG.map((group) => (
          <View key={group.category} style={styles.group}>
            <SectionHeader title={group.category} style={styles.sectionHeader} />
            {group.sections.map((item) => {
              const isAdding = adding === item.type;
              const sectionLabel = (SECTION_TYPE_LABELS as Record<string, string>)[item.type] ?? item.type;
              return (
                <BrandthreadCard
                  key={item.type}
                  style={styles.sectionCard}
                  onPress={() => handleAdd(item.type)}
                >
                  <View style={styles.cardRow}>
                    <View style={styles.iconWrap}>
                      <Feather name={item.icon as any} size={ICON.md} color={PURPLE} />
                    </View>
                    <View style={styles.cardCenter}>
                      <Text style={styles.sectionName}>{sectionLabel}</Text>
                      <Text style={styles.sectionDesc}>{item.desc}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.addBtn, isAdding && styles.addBtnDisabled]}
                      onPress={() => handleAdd(item.type)}
                      disabled={isAdding}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Feather name="plus" size={ICON.xs} color={isAdding ? MUTED : PURPLE} />
                      <Text style={[styles.addBtnText, isAdding && { color: MUTED }]}>
                        {isAdding ? '…' : 'Add'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </BrandthreadCard>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const BORDER_ACTIVE = theme.accentLight;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    minHeight: 56,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  scrollContent: {
    paddingHorizontal: SP.md,
    gap: SP.md,
  },
  group: {
    gap: SP.sm,
  },
  sectionHeader: {
    paddingHorizontal: 0,
    marginBottom: 0,
  },
  sectionCard: {
    marginBottom: SP.sm,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCenter: {
    flex: 1,
    gap: 2,
  },
  sectionName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  sectionDesc: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 16,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    paddingHorizontal: SP.sm,
    paddingVertical: 5,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  });
};
