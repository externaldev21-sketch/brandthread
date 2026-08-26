import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { APP_THEME_PRESETS, useAppTheme } from '@/contexts/AppThemeContext';
import { BG, CARD, BORDER, FG, MUTED, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { LOGO_SOURCE } from '@/constants/branding';

function ThemeMark({ color, shadow }: { color: string; shadow: string }) {
  return (
    <View style={styles.markWrap}>
      <Image source={LOGO_SOURCE} style={styles.logoImage} resizeMode="contain" />
      <View pointerEvents="none" style={[styles.finishVeil, { backgroundColor: color + '40' }]} />
      <View pointerEvents="none" style={[styles.markSheen, { backgroundColor: shadow + '38' }]} />
      <Text pointerEvents="none" style={[styles.markLetter, { color, textShadowColor: shadow }]}>B</Text>
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
                <LinearGradient colors={option.swatchBackground} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.preview}>
                  {option.id === 'leopard-red' && (
                    <View pointerEvents="none" style={styles.leopardPattern}>
                      <Text style={styles.leopardText}>●   •  ●  •   ●</Text>
                    </View>
                  )}
                  <ThemeMark color={option.markColor} shadow={option.markShadow} />
                  {selected && <View style={[styles.selected, { backgroundColor: option.accent }]}><Feather name="check" size={13} color="#FFF" /></View>}
                </LinearGradient>
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
  root: { flex: 1, backgroundColor: BG },
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
  markWrap: { width: 114, height: 114, alignItems: 'center', justifyContent: 'center', borderRadius: 57, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.24)' },
  logoImage: { width: 114, height: 114, opacity: 0.82 },
  finishVeil: { ...StyleSheet.absoluteFillObject, opacity: 0.38 },
  markSheen: { position: 'absolute', width: 180, height: 24, transform: [{ rotate: '-38deg' }], top: 23, left: -31, opacity: 0.7 },
  markLetter: { position: 'absolute', fontSize: 70, lineHeight: 76, fontFamily: FONT.extrabold, letterSpacing: -8, textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 5 },
  selected: { position: 'absolute', top: 9, right: 9, width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  name: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, paddingHorizontal: 11, paddingTop: 10, paddingBottom: 12 },
  leopardPattern: { position: 'absolute', opacity: 0.34, transform: [{ rotate: '-18deg' }], width: '130%' },
  leopardText: { color: '#2F160B', fontSize: 28, letterSpacing: 8, fontFamily: FONT.bold },
});