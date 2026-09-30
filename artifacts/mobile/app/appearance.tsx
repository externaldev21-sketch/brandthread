import React, { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { useAppIconPreference, type AppIconPreference } from '@/contexts/AppIconContext';
import { APP_THEME_PRESETS, type AppThemeId, type AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { APPEARANCE_ICON_IMAGES, APPEARANCE_THEME_IMAGES, preloadAppearanceAssets } from '@/lib/appearanceAssets';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const presetById = (id: AppThemeId): AppThemePreset =>
  APP_THEME_PRESETS.find((preset) => preset.id === id) ?? APP_THEME_PRESETS[0];

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const { theme, selectTheme } = useAppTheme();
  const { preference, resolvedIconId, followsTheme, selectIcon } = useAppIconPreference();

  useEffect(() => { void preloadAppearanceAssets(); }, []);

  const heroPreset = presetById(resolvedIconId);

  async function chooseTheme(id: AppThemeId) {
    if (id === theme.id) return;
    Haptics.selectionAsync();
    await selectTheme(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function chooseIcon(nextPreference: AppIconPreference) {
    if (nextPreference === preference) return;
    await Haptics.selectionAsync();
    await selectIcon(nextPreference);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function toggleFollowTheme(follow: boolean) {
    chooseIcon(follow ? null : theme.id);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Appearance" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP.xl }]}
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
          <Text style={[styles.heroName, { color: theme.text }]}>{heroPreset.name}</Text>
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
                    <Feather name="check" size={11} color={option.onAccent} />
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
            <Text style={[styles.followSubtitle, { color: theme.muted }]}>
              Automatically matches your icon to {theme.name}
            </Text>
          </View>
          <HapticSwitch
            value={followsTheme}
            onValueChange={toggleFollowTheme}
            trackColor={{ false: theme.border, true: theme.accent }}
            thumbColor={followsTheme ? theme.onAccent : theme.text}
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
                      <Feather name="check" size={11} color={option.onAccent} />
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SP.md, paddingTop: SP.md },

  hero: { alignItems: 'center', paddingVertical: SP.xl, borderRadius: RADIUS.lg, overflow: 'hidden' },
  heroIcon: { width: 120, height: 120, borderRadius: 28 },
  heroName: { fontFamily: FONT.bold, fontSize: FS.xxl, marginTop: SP.md },
  heroSubtitle: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4 },

  sectionLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: SP.lg, marginBottom: SP.sm },

  themeRow: { gap: SP.sm, paddingRight: SP.md },
  themeCard: { width: 64, height: 84, borderRadius: RADIUS.md, borderWidth: 2, overflow: 'hidden' },
  themeCardImage: { width: '100%', height: '100%' },
  themeCardCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  followRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md, marginTop: SP.lg },
  followTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  followSubtitle: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: SP.lg },
  item: { width: '23%', alignItems: 'center' },
  iconRing: { width: '100%', aspectRatio: 1, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  icon: { width: '100%', height: '100%', borderRadius: 18 },
  selectedBadge: { position: 'absolute', right: -2, top: -2, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000' },
  label: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 6, textAlign: 'center' },
});
