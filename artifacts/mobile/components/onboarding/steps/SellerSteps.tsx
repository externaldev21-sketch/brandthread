/**
 * Seller steps copied from Shopify's onboarding
 * (https://mobbin.com/flows/5d834cad-e1a4-4893-a1bf-e50ac56090ab), reskinned:
 *  - question screens: big title, a list of cards (checkbox or radio, icon,
 *    title, one-line description), a thin progress bar above the bottom area
 *    with Next plus "Skip all" / "Skip" side by side;
 *  - "Where's your business located?" with a single country row;
 *  - "Building your store": the seller's own store preview (name, logo,
 *    handle) before any plan or payment is mentioned.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, OptionSheet, type IconName } from '@/components/ui';
import { AiGeneratedBadge } from '@/components/AiGeneratedBadge';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { radius } from '@/constants/radii';
import { COUNTRIES } from '@/lib/addressRegions';

export interface ChoiceOption { value: string; label: string; description?: string; icon: IconName }

export const BRAND_STAGE_OPTIONS: ChoiceOption[] = [
  { value: 'idea', label: 'Just an idea', description: "I'm starting from zero.", icon: 'edit-3' },
  { value: 'build', label: 'Building now', description: "I'm designing or sourcing products.", icon: 'scissors' },
  { value: 'selling', label: 'Already selling', description: 'I have customers and active orders.', icon: 'shopping-bag' },
  { value: 'scale', label: 'Ready to scale', description: 'I need stronger systems and growth.', icon: 'trending-up' },
];

export const SELLER_GOAL_OPTIONS: ChoiceOption[] = [
  { value: 'Create designs', label: 'Create designs', description: 'Mockups, logos and product photos.', icon: 'edit-2' },
  { value: 'Find manufacturers', label: 'Find manufacturers', description: 'Source samples and production runs.', icon: 'search' },
  { value: 'Launch my store', label: 'Launch my store', description: 'A storefront buyers can shop today.', icon: 'shopping-bag' },
  { value: 'Manage production', label: 'Manage production', description: 'Track orders with your makers.', icon: 'layers' },
  { value: 'Grow sales', label: 'Grow sales', description: 'Promotions, drops and boosts.', icon: 'trending-up' },
  { value: 'Build content', label: 'Build content', description: 'Posts, threads and live shopping.', icon: 'camera' },
  { value: 'Manage inventory', label: 'Manage inventory', description: 'Stock levels across sizes and colors.', icon: 'package' },
  { value: 'Ship orders', label: 'Ship orders', description: 'Labels, tracking and returns.', icon: 'truck' },
  { value: 'Understand analytics', label: 'Understand analytics', description: 'What sells and who buys it.', icon: 'bar-chart-2' },
  { value: 'Manage customers', label: 'Manage customers', description: 'Messages, reviews and repeat buyers.', icon: 'users' },
];

export function ChoiceCard({ option, selected, multi, onPress, testID }: { option: ChoiceOption; selected: boolean; multi: boolean; onPress: () => void; testID?: string }) {
  const palette = useColors();
  return (
    <Pressable
      testID={testID ?? `onboarding-choice-${option.value.replace(/\s+/g, '-').toLowerCase()}`}
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={option.label}
      style={[styles.card, { borderColor: selected ? palette.foreground : 'transparent' }]}
    >
      <View
        style={[
          multi ? styles.checkbox : styles.radio,
          { borderColor: selected ? palette.foreground : palette.mutedForeground },
          selected && multi && { backgroundColor: palette.foreground },
        ]}
      >
        {selected && multi ? <Icon name="check" size={14} color={palette.background} /> : null}
        {selected && !multi ? <View style={[styles.radioDot, { backgroundColor: palette.foreground }]} /> : null}
      </View>
      <Icon name={option.icon} size={20} color={palette.foreground} />
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: palette.foreground }]}>{option.label}</Text>
        {option.description ? (
          <Text style={[styles.cardDesc, { color: palette.mutedForeground }]} numberOfLines={2}>{option.description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Shopify's bottom area: thin progress bar, Next, then Skip all / Skip of equal width. */
export function QuestionFooter({ progress, onNext, nextDisabled, onSkip, onSkipAll, nextLabel = 'Next', nextLoading }: {
  progress: number;
  onNext: () => void;
  nextDisabled?: boolean;
  onSkip?: () => void;
  onSkipAll?: () => void;
  nextLabel?: string;
  nextLoading?: boolean;
}) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
      <View style={[styles.track, { backgroundColor: palette.border }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
        <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: palette.foreground }]} />
      </View>
      <View style={styles.footerButtons}>
        <Button label={nextLabel} onPress={onNext} disabled={nextDisabled} loading={nextLoading} fullWidth testID="onboarding-question-next" style={nextDisabled ? styles.disabledFill : undefined} />
        {onSkip || onSkipAll ? (
          <View style={styles.skipRow}>
            {onSkipAll ? (
              <View style={styles.skipBtn}>
                <Button label="Skip all" variant="secondary" onPress={onSkipAll} fullWidth testID="onboarding-question-skip-all" />
              </View>
            ) : null}
            {onSkip ? (
              <View style={styles.skipBtn}>
                <Button label="Skip" variant="secondary" onPress={onSkip} fullWidth testID="onboarding-question-skip" />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function ChoiceCardsStep({
  title, subtitle, options, selected, multi, onToggle, progress, onNext, onSkip, onSkipAll, testID,
}: {
  title: string;
  subtitle?: string;
  options: ChoiceOption[];
  selected: string[];
  multi: boolean;
  onToggle: (value: string) => void;
  progress: number;
  onNext: () => void;
  onSkip: () => void;
  onSkipAll: () => void;
  testID?: string;
}) {
  const palette = useColors();
  return (
    <View style={styles.root} testID={testID}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>{subtitle}</Text> : null}
        <View style={styles.cards}>
          {options.map((o) => (
            <ChoiceCard key={o.value} option={o} multi={multi} selected={selected.includes(o.value)} onPress={() => onToggle(o.value)} />
          ))}
        </View>
      </ScrollView>
      <QuestionFooter progress={progress} onNext={onNext} nextDisabled={selected.length === 0} onSkip={onSkip} onSkipAll={onSkipAll} />
    </View>
  );
}

export function countryLabel(code: string): string {
  return COUNTRIES.find((c) => c.value === code)?.label ?? code;
}

export function LocationStep({ country, onChange, progress, onNext }: {
  country: string;
  onChange: (code: string) => void;
  progress: number;
  onNext: () => void;
}) {
  const palette = useColors();
  const [open, setOpen] = useState(false);
  const options = useMemo(() => COUNTRIES.map((c) => ({ id: c.value, label: c.label })), []);
  return (
    <View style={styles.root} testID="onboarding-location-step">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>Where's your business located?</Text>
        <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>We'll use this to set up your default shipping rates.</Text>
        <Pressable
          testID="onboarding-location-row"
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Business location, ${countryLabel(country)}`}
          style={styles.locationRow}
        >
          <Text style={[styles.locationText, { color: palette.foreground }]}>{countryLabel(country)}</Text>
          <Icon name="chevron-right" size={17} color={palette.mutedForeground} />
        </Pressable>
      </ScrollView>
      <QuestionFooter progress={progress} onNext={onNext} />
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Business location"
        options={options}
        selectedId={country}
        onSelect={(id) => { onChange(id); setOpen(false); }}
        testID="onboarding-location-sheet"
      />
    </View>
  );
}

// ─── Building your store ─────────────────────────────────────────────────────

export const LOGO_SAMPLE_STYLES = ['Minimalist', 'Bold', 'Vintage', 'Luxury', 'Streetwear', 'Playful'];

function StorePreview({ brandName, username, logoUri }: { brandName: string; username: string; logoUri: string | null }) {
  const palette = useColors();
  const initial = (brandName.trim()[0] ?? '?').toUpperCase();
  return (
    <View style={styles.preview} testID="onboarding-store-preview" accessibilityLabel={`Store preview for ${brandName}`}>
      <View style={styles.previewBanner} />
      <View style={styles.previewLogoWrap}>
        {logoUri ? (
          <View>
            <Image source={{ uri: logoUri }} style={[styles.previewLogo, { backgroundColor: palette.foreground }]} accessibilityLabel={`${brandName} logo`} />
            <AiGeneratedBadge position="topLeft" />
          </View>
        ) : (
          <View style={[styles.previewLogo, styles.previewInitialWrap, { backgroundColor: palette.foreground }]}>
            <Text style={[styles.previewInitial, { color: palette.background }]}>{initial}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.previewName, { color: palette.foreground }]} numberOfLines={1}>{brandName}</Text>
      {username ? <Text style={[styles.previewHandle, { color: palette.mutedForeground }]} numberOfLines={1}>@{username}</Text> : null}
      <View style={styles.previewGrid}>
        {[0, 1, 2].map((i) => <View key={i} style={styles.previewTile} />)}
      </View>
    </View>
  );
}

export function BuildingStoreStep({
  brandName, username, building, buildError, onRetryBuild, logoUri, sampleStyle, onSampleStyle,
  onGenerate, generating, sampleError, sampleUnavailable, onDone, finishing,
}: {
  brandName: string;
  username: string;
  building: boolean;
  buildError?: string | null;
  onRetryBuild: () => void;
  logoUri: string | null;
  sampleStyle: string;
  onSampleStyle: (style: string) => void;
  onGenerate: () => void;
  generating: boolean;
  sampleError?: string | null;
  /** The free sample was already used on this device/email; don't offer it again. */
  sampleUnavailable?: boolean;
  onDone: () => void;
  finishing?: boolean;
}) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const canOfferSample = !logoUri && !sampleUnavailable;
  return (
    <View style={styles.root} testID="onboarding-building-step">
      <ScrollView contentContainerStyle={[styles.scroll, styles.buildingScroll]} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, styles.centered, { color: palette.foreground }]}>
          {building ? 'Building your store' : 'Your store is ready'}
        </Text>
        <StorePreview brandName={brandName} username={username} logoUri={logoUri} />
        {building ? (
          <View style={styles.buildingRow}>
            <ActivityIndicator color={palette.foreground} />
          </View>
        ) : null}
        {buildError ? (
          <View style={styles.buildingRow}>
            <Text style={[styles.errorText, { color: palette.destructive }]}>{buildError}</Text>
            <Button label="Try again" variant="secondary" onPress={onRetryBuild} testID="onboarding-building-retry" />
          </View>
        ) : null}
        {!building && !buildError && canOfferSample ? (
          <View style={styles.sample}>
            <Text style={[styles.sampleTitle, { color: palette.foreground }]}>Try a free logo</Text>
            <Text style={[styles.sampleSub, { color: palette.mutedForeground }]}>One free logo for your brand name. Pick a style.</Text>
            <View style={styles.styleRow}>
              {LOGO_SAMPLE_STYLES.map((style) => {
                const on = sampleStyle === style;
                return (
                  <Pressable
                    key={style}
                    onPress={() => onSampleStyle(style)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.styleChip, { borderColor: on ? palette.foreground : palette.border }]}
                  >
                    <Text style={[styles.styleChipText, { color: on ? palette.foreground : palette.mutedForeground }]}>{style}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Button label="Generate logo" variant="secondary" onPress={onGenerate} loading={generating} fullWidth testID="onboarding-generate-sample" />
          </View>
        ) : null}
        {sampleError ? <Text style={[styles.errorText, { color: palette.destructive }]} testID="onboarding-sample-error">{sampleError}</Text> : null}
      </ScrollView>
      {!building && !buildError ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
          <Button label="Next" onPress={onDone} loading={finishing} disabled={generating} fullWidth testID="onboarding-building-done" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: SPACING.sm, paddingBottom: SPACING.xl },
  buildingScroll: { paddingTop: SPACING.xl },
  title: { ...TEXT.title1 },
  centered: { textAlign: 'center' },
  subtitle: { ...TEXT.subhead, marginTop: SPACING.sm },
  cards: { gap: SPACING.sm, marginTop: SPACING.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: 64,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: radius.md,
    backgroundColor: FILL_ELEVATED,
    borderWidth: 1,
  },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  cardText: { flex: 1 },
  cardTitle: { ...TEXT.headline },
  cardDesc: { ...TEXT.footnote, marginTop: 2 },
  footer: { paddingTop: 0 },
  track: { height: 2, marginHorizontal: -SPACING.md, overflow: 'hidden' },
  fill: { height: 2 },
  footerButtons: { gap: SPACING.sm, paddingTop: SPACING.md },
  skipRow: { flexDirection: 'row', gap: SPACING.sm },
  skipBtn: { flex: 1 },
  disabledFill: { backgroundColor: FILL_ELEVATED },
  locationRow: {
    marginTop: SPACING.xl,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    borderRadius: radius.md,
    backgroundColor: FILL_ELEVATED,
  },
  locationText: { ...TEXT.body },
  preview: {
    marginTop: SPACING.xl,
    alignSelf: 'center',
    width: '86%',
    maxWidth: 320,
    borderRadius: radius.lg,
    backgroundColor: FILL_ELEVATED,
    overflow: 'hidden',
    paddingBottom: SPACING.md,
    alignItems: 'center',
  },
  previewBanner: { alignSelf: 'stretch', height: 72, backgroundColor: '#2C2C2E' },
  previewLogoWrap: { marginTop: -36 },
  previewLogo: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: FILL_ELEVATED },
  previewInitialWrap: { alignItems: 'center', justifyContent: 'center' },
  previewInitial: { fontSize: 30, lineHeight: 36, fontFamily: FONT.bold },
  previewName: { ...TEXT.headline, marginTop: SPACING.sm, paddingHorizontal: SPACING.md },
  previewHandle: { ...TEXT.footnote, marginTop: 2 },
  previewGrid: { flexDirection: 'row', gap: 2, marginTop: SPACING.md, alignSelf: 'stretch', paddingHorizontal: SPACING.md },
  previewTile: { flex: 1, aspectRatio: 3 / 4, backgroundColor: '#2C2C2E' },
  buildingRow: { alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.xl },
  sample: { marginTop: SPACING.xl, gap: SPACING.xs },
  sampleTitle: { ...TEXT.headline },
  sampleSub: { ...TEXT.footnote },
  styleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginVertical: SPACING.xs },
  styleChip: { height: 36, paddingHorizontal: SPACING.sm, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  styleChipText: { ...TEXT.subhead, fontFamily: FONT.medium },
  errorText: { ...TEXT.footnote, marginTop: SPACING.sm, textAlign: 'center' },
});
