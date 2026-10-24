import React, { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

import { Image } from 'expo-image';

import { LinearGradient } from 'expo-linear-gradient';

import { Icon } from '@/components/ui/Icon';

import { haptics, haptic } from '@/lib/haptics';

import { Feather } from '@expo/vector-icons';


import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';

import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

import { HapticSwitch } from '@/components/BrandthreadUI';
import { isUnlockableIconId, useAppIconPreference, type AppIconPreference } from '@/contexts/AppIconContext';
import { useBestMembershipLevel } from '@/hooks/useBestMembershipLevel';
import { UNLOCKABLE_ICONS, isIconUnlocked, lockedCaption, unlockableIconName } from '@/lib/unlockableIcons';
import { APP_THEME_PRESETS, type AppThemeId, type AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';

import { APPEARANCE_ICON_IMAGES, APPEARANCE_THEME_IMAGES, preloadAppearanceAssets } from '@/lib/appearanceAssets';

import { FONT, FS, RADIUS, SP } from '@/lib/theme';

import { showAlert } from '@/lib/actionSheet';

import { friendlyError } from '@/lib/friendlyError';

const presetById = (id: AppThemeId): AppThemePreset =>
  APP_THEME_PRESETS.find((preset) => preset.id === id) ?? APP_THEME_PRESETS[0];

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const tabBarInset = useSellerTabBarInset();
  const { theme, selectTheme } = useAppTheme();
  const { preference, resolvedIconId, followsTheme, selectIcon } = useAppIconPreference();

  useEffect(() => { void preloadAppearanceAssets(); }, []);

  const bestLevel = useBestMembershipLevel();
  // Unlockable icons aren't themes: the hero shows their name over the monochrome glow.
  const heroPreset = presetById(isUnlockableIconId(resolvedIconId) ? 'monochrome' : resolvedIconId);
  const heroName = isUnlockableIconId(resolvedIconId) ? unlockableIconName(resolvedIconId) : heroPreset.name;

  async function chooseTheme(id: AppThemeId) {
    if (id === theme.id) return;
    haptic('select');
    try {
      await selectTheme(id);
    } catch (err) {
      showAlert('Couldn’t change the theme', friendlyError(err, 'Try again.'));
    }
  }

  async function chooseIcon(nextPreference: AppIconPreference) {
    if (nextPreference === preference) return;
    haptic('select');
    try {
      await selectIcon(nextPreference);
    } catch (err) {
      showAlert('Couldn’t change the app icon', friendlyError(err, 'Try again.'));
    }
  }

  function toggleFollowTheme(follow: boolean) {
    chooseIcon(follow ? null : theme.id);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Appearance" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP.xl + tabBarInset }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — big icon preview with a glow in the selected icon's color */}
        <View style={styles.hero}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient
              colors={heroPreset.glowGradient as unknown as [string, string, ...string[]]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <Image
            source={APPEARANCE_ICON_IMAGES[resolvedIconId]}
            style={styles.heroIcon}
            cachePolicy="memory-disk"
            transition={0}
          />
          <Text style={[styles.heroName, { color: theme.text }]}>{heroName}</Text>
          <Text style={[styles.heroSubtitle, { color: theme.muted }]}>
            {followsTheme ? 'Following app theme' : 'Custom app icon'}
          </Text>
        </View>

        {/* Theme row — mini app-preview cards, tap to apply instantly */}
        <Text style={[styles.sectionLabel, { color: theme.muted }]}>Theme</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeRow}>
          {APP_THEME_PRESETS.map((option) => {
            const selected = option.id === theme.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.themeCard, { borderColor: selected ? option.accent : theme.border }]}
                onPress={() => chooseTheme(option.id)}
                activeOpacity={0.84}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.name} theme${selected ? ', selected' : ''}`}
              >
                <Image
                  source={APPEARANCE_THEME_IMAGES[option.id]}
                  style={styles.themeCardImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
                {selected && (
                  <View style={[styles.themeCardCheck, { backgroundColor: option.accent }]}>
                    <Icon name="check" size={11} color={option.onAccent} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Follow app theme */}
        <View style={[styles.followRow, { borderColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.followTitle, { color: theme.text }]}>Follow app theme</Text>
          </View>
          <HapticSwitch
            value={followsTheme}
            onValueChange={toggleFollowTheme}
          />
        </View>

        {/* Icon grid — icons only, white ring + check on the selected one */}
        <Text style={[styles.sectionLabel, { color: theme.muted }]}>App icon</Text>
        <View style={styles.grid}>
          {APP_THEME_PRESETS.map((option) => {
            const selected = preference === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={styles.item}
                onPress={() => chooseIcon(option.id)}
                activeOpacity={0.82}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.name} app icon${selected ? ', selected' : ''}`}
              >
                <View style={[styles.iconRing, selected && { borderColor: '#FFFFFF' }]}>
                  <Image
                    source={APPEARANCE_ICON_IMAGES[option.id]}
                    style={styles.icon}
                    cachePolicy="memory-disk"
                    transition={0}
                  />
                  {selected && (
                    <View style={[styles.selectedBadge, { backgroundColor: option.accent, borderColor: theme.background }]}>
                      <Icon name="check" size={11} color={option.onAccent} />
                    </View>
                  )}
                </View>
                <Text style={[styles.label, { color: selected ? theme.text : theme.muted }]} numberOfLines={1}>
                  {option.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Unlockable — earned with brand membership levels; locked ones show the level that opens them */}
        <Text style={[styles.sectionLabel, { color: theme.muted }]}>Unlockable</Text>
        <View style={styles.grid} testID="appearance-unlockable-icons">
          {UNLOCKABLE_ICONS.map((option) => {
            const unlocked = isIconUnlocked(option.id, bestLevel);
            const selected = preference === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={styles.item}
                onPress={() => { if (unlocked) chooseIcon(option.id); }}
                disabled={!unlocked}
                activeOpacity={0.82}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !unlocked }}
                accessibilityLabel={unlocked
                  ? `${option.name} app icon${selected ? ', selected' : ''}`
                  : `${option.name} app icon, unlocks at ${lockedCaption(option.id)}`}
                testID={`unlockable-icon-${option.id}`}
              >
                <View style={[styles.iconRing, selected && { borderColor: '#FFFFFF' }]}>
                  <Image
                    source={APPEARANCE_ICON_IMAGES[option.id]}
                    style={[styles.icon, !unlocked && styles.iconLocked]}
                    cachePolicy="memory-disk"
                    transition={0}
                  />
                  {!unlocked ? (
                    <View style={styles.lockBadge}>
                      <Feather name="lock" size={11} color="#FFFFFF" />
                    </View>
                  ) : selected ? (
                    <View style={[styles.selectedBadge, { backgroundColor: theme.text, borderColor: theme.background }]}>
                      <Feather name="check" size={11} color={theme.background} />
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.label, { color: selected ? theme.text : theme.muted }]} numberOfLines={1}>
                  {unlocked ? option.name : lockedCaption(option.id)}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* Keep the 4-column rhythm of the grid above (it spaces items between). */}
          {Array.from({ length: (4 - (UNLOCKABLE_ICONS.length % 4)) % 4 }, (_, i) => <View key={`pad-${i}`} style={styles.item} />)}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SP.md, paddingTop: SP.md },

  hero: { alignItems: 'center', paddingVertical: SP.xl, borderRadius: RADIUS.lg, overflow: 'hidden' },
  heroIcon: { width: 120, height: 120, borderRadius: 16 },
  heroName: { fontFamily: FONT.bold, fontSize: FS.xxl, marginTop: SP.md },
  heroSubtitle: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.xs },

  sectionLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, marginTop: SP.lg, marginBottom: SP.sm },

  themeRow: { gap: SP.sm, paddingRight: SP.md },
  themeCard: { width: 64, height: 84, borderRadius: RADIUS.md, borderWidth: 2, overflow: 'hidden' },
  themeCardImage: { width: '100%', height: '100%' },
  themeCardCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  followRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md, marginTop: SP.lg },
  followTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  followSubtitle: { fontFamily: FONT.regular, fontSize: FS.meta, marginTop: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: SP.lg },
  item: { width: '23%', alignItems: 'center' },
  iconRing: { width: '100%', aspectRatio: 1, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  icon: { width: '100%', height: '100%', borderRadius: 16 },
  iconLocked: { opacity: 0.35 },
  lockBadge: { position: 'absolute', right: -2, top: -2, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A2A2C', borderWidth: 2, borderColor: '#000' },
  selectedBadge: { position: 'absolute', right: -2, top: -2, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  label: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 6, textAlign: 'center' },
});
