import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ImageSourcePropType } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { APP_THEME_PRESETS, AppThemeId, AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { BG, CARD, BORDER, FG, MUTED, FONT, FS, SP, RADIUS } from '@/lib/theme';

type ThemeImageContext = {
  (key: string): ImageSourcePropType;
  keys: () => string[];
};

const themeImageContext = (require as unknown as {
  context: (directory: string, useSubdirectories: boolean, pattern: RegExp) => ThemeImageContext;
}).context('../assets/images/themes', false, /\.png$/);

const THEME_IMAGE_PATHS: Record<AppThemeId, string> = {
  purple: '../assets/images/themes/theme-purple.png',
  olive: '../assets/images/themes/theme-olive.png',
  navy: '../assets/images/themes/theme-navy.png',
  champagne: '../assets/images/themes/theme-champagne.png',
  black: '../assets/images/themes/theme-black.png',
  silver: '../assets/images/themes/theme-silver.png',
  'black-gold': '../assets/images/themes/theme-black-gold.png',
  'emerald-gold': '../assets/images/themes/theme-emerald-gold.png',
  'leopard-red': '../assets/images/themes/theme-leopard-red.png',
  maroon: '../assets/images/themes/theme-maroon.png',
  gold: '../assets/images/themes/theme-gold.png',
};

function getOptionalThemeImage(id: AppThemeId): ImageSourcePropType | null {
  const contextKey = `./${THEME_IMAGE_PATHS[id].split('/').pop()}`;
  return themeImageContext.keys().includes(contextKey) ? themeImageContext(contextKey) : null;
}

function ThemePreview({ option, selected }: { option: AppThemePreset; selected: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = getOptionalThemeImage(option.id);
  const showImage = source !== null && !imageFailed;

  return (
    <View style={[styles.preview, { backgroundColor: option.accent }]}>
      {showImage && (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          accessibilityIgnoresInvertColors
        />
      )}
      {selected && (
        <View style={[styles.selected, { backgroundColor: option.accent }]}>
          <Feather name="check" size={13} color={option.onAccent} />
        </View>
      )}
    </View>
  );
}

export default function AppThemeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, selectTheme } = useAppTheme();

  async function chooseTheme(id: typeof theme.id) {
    if (id === theme.id) return;
    Haptics.selectionAsync();
    await selectTheme(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="Back to settings">
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>App Theme</Text>
          <Text style={styles.subtitle}>Choose your Brandthread finish</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.current, { borderColor: theme.accent + '66', backgroundColor: theme.accentDim }]}>
          <View style={[styles.currentDot, { backgroundColor: theme.accent }]} />
          <Text style={styles.currentText}>Using {theme.name}</Text>
          <Feather name="check" size={16} color={theme.accentLight} />
        </View>
        <Text style={styles.helper}>Your theme updates primary buttons, selected tabs, focus states, gradients, and highlights across buyer and seller views.</Text>

        <View style={styles.grid}>
          {APP_THEME_PRESETS.map((option) => {
            const selected = option.id === theme.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.tile, selected && { borderColor: option.accent, shadowColor: option.accent, shadowOpacity: 0.32, elevation: 5 }]}
                onPress={() => chooseTheme(option.id)}
                activeOpacity={0.84}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.name} theme${selected ? ', selected' : ''}`}
              >
                <ThemePreview option={option} selected={selected} />
                <Text style={[styles.name, selected && { color: option.accentLight }]} numberOfLines={1}>{option.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  back: { width: 38, height: 38, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.2 },
  subtitle: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  content: { padding: SP.md },
  current: { minHeight: 46, borderRadius: RADIUS.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13 },
  currentDot: { width: 10, height: 10, borderRadius: 5 },
  currentText: { flex: 1, color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  helper: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: SP.md, marginBottom: SP.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  tile: { width: '47.8%', borderRadius: RADIUS.lg, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  preview: { height: 138, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  selected: { position: 'absolute', top: 9, right: 9, width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  name: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, paddingHorizontal: 11, paddingTop: 10, paddingBottom: 12 },
});