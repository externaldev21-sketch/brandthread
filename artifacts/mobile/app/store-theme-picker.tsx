import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Header } from '@/components/layout';
import {
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard,
} from '@/components/BrandthreadUI';
import { getThemes, getStorefront, applyTheme } from '@/services/storeService';
import { StoreTheme, TYPOGRAPHY_STYLES } from '@/services/storeTypes';

export default function StoreThemePicker() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [themes, setThemes] = useState<StoreTheme[]>([]);
  const [currentThemeId, setCurrentThemeId] = useState<string | null>(null);
  const [previewingThemeId, setPreviewingThemeId] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const loaded = getThemes();
      setThemes(loaded);
      getStorefront().then(store => {
        setCurrentThemeId(store.themeSettings.themeId);
      });
    }, [])
  );

  const previewingTheme = previewingThemeId
    ? themes.find(t => t.id === previewingThemeId) ?? null
    : null;

  function handleApply(themeId: string, presetId?: string, andNavigate = false) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) return;
    Alert.alert(
      `Apply ${theme.name}`,
      `Switch your storefront to the ${theme.name} theme? Fonts, palette, button style, and corner rounding will update to match.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: async () => {
            setApplying(themeId);
            try {
              await applyTheme(themeId, presetId);
              setCurrentThemeId(themeId);
              setPreviewingThemeId(null);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              if (andNavigate) {
                router.push('/store-editor' as never);
              }
            } catch {
              Alert.alert('Error', 'Failed to apply theme.');
            } finally {
              setApplying(null);
            }
          },
        },
      ]
    );
  }

  function renderThemeCard({ item }: { item: StoreTheme }) {
    const isCurrent = currentThemeId === item.id;
    const isPreviewing = previewingThemeId === item.id;
    const isApplying = applying === item.id;

    return (
      <View style={styles.themeCard}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            Haptics.selectionAsync();
            setPreviewingThemeId(item.id);
            setSelectedPresetId(item.presets[0]?.paletteId ?? null);
          }}
        >
          <View style={styles.swatchArea}>
            <LinearGradient
              colors={[item.previewColor, item.accentColor]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.swatchGradient}
            />
            {/* Color dots */}
            <View style={styles.colorDots}>
              {item.presets[0]?.colors && [
                item.presets[0].colors.primary,
                item.presets[0].colors.accent,
                item.presets[0].colors.background,
              ].map((c, i) => (
                <View key={i} style={[styles.colorDot, { backgroundColor: c }]} />
              ))}
            </View>
            {isCurrent && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>CURRENT</Text>
              </View>
            )}
            {isPreviewing && !isCurrent && (
              <View style={styles.previewingBadge}>
                <Text style={styles.previewingBadgeText}>PREVIEWING</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.themeInfo}>
          <Text style={styles.themeName}>{item.name}</Text>
          <Text style={styles.themeMeta}>
            {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
            {'  ·  '}
            {item.supportedModes.join(', ')}
          </Text>
          <Text style={styles.themeBestFor} numberOfLines={1}>{item.bestFor}</Text>

          <View style={styles.themeActions}>
            <TouchableOpacity
              style={styles.previewBtn}
              onPress={() => {
                Haptics.selectionAsync();
                setPreviewingThemeId(item.id);
                setSelectedPresetId(item.presets[0]?.paletteId ?? null);
              }}
            >
              <Text style={styles.previewBtnText}>Preview</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.useBtn, isCurrent && styles.useBtnDisabled]}
              onPress={() => !isCurrent && handleApply(item.id)}
              disabled={isCurrent || isApplying}
            >
              {isApplying ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <Text style={styles.useBtnText}>{isCurrent ? 'Active' : 'Use Theme'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        title="Storefront Theme"
        onBack={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
      />

      {/* Thread Theme */}
      <FlatList
        data={themes}
        keyExtractor={item => item.id}
        numColumns={1}
        contentContainerStyle={[
          styles.gridContent,
          { paddingBottom: insets.bottom + (previewingTheme ? 380 : 24) },
        ]}
        renderItem={renderThemeCard}
        showsVerticalScrollIndicator={false}
      />

      {/* Theme Detail Panel */}
      {previewingTheme && (
        <View style={[styles.detailPanel, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.detailHandle} />

          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailName}>{previewingTheme.name}</Text>
              <Text style={styles.detailCategory}>
                {previewingTheme.category.charAt(0).toUpperCase() + previewingTheme.category.slice(1)}
              </Text>
              <Text style={styles.detailDesc}>{previewingTheme.description}</Text>
              <Text style={styles.detailBestFor}>
                <Text style={{ color: theme.muted }}>Best for: </Text>
                {previewingTheme.bestFor}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setPreviewingThemeId(null)}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={ICON.md} color={theme.muted} />
            </TouchableOpacity>
          </View>

          {/* Supported Modes */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modesRow}>
            {previewingTheme.supportedModes.map(mode => (
              <View key={mode} style={styles.modeChip}>
                <Text style={styles.modeChipText}>{mode}</Text>
              </View>
            ))}
            <View style={styles.modeChip}>
              <Text style={styles.modeChipText}>{previewingTheme.supportedSections.length} sections</Text>
            </View>
          </ScrollView>

          {/* Style sheet: typography, button style, corner rounding */}
          <View style={styles.styleSheetRow}>
            <View style={styles.styleSheetChip}>
              <Text style={styles.styleSheetLabel}>Font</Text>
              <Text style={styles.styleSheetValue}>
                {TYPOGRAPHY_STYLES.find(t => t.value === previewingTheme.defaultTypography)?.heading ?? previewingTheme.defaultTypography}
              </Text>
            </View>
            <View style={styles.styleSheetChip}>
              <Text style={styles.styleSheetLabel}>Button</Text>
              <Text style={styles.styleSheetValue}>{previewingTheme.defaultButtonStyle}</Text>
            </View>
            <View style={styles.styleSheetChip}>
              <Text style={styles.styleSheetLabel}>Corners</Text>
              <Text style={styles.styleSheetValue}>{previewingTheme.defaultCornerRadius}</Text>
            </View>
          </View>

          {/* Preset Variants */}
          {previewingTheme.presets.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetsRow}>
              {previewingTheme.presets.map(preset => {
                const isSelected = selectedPresetId === preset.paletteId;
                return (
                  <TouchableOpacity
                    key={preset.paletteId}
                    style={[styles.presetChip, isSelected && styles.presetChipActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSelectedPresetId(preset.paletteId);
                    }}
                  >
                    <View style={[styles.presetDot, { backgroundColor: preset.colors.primary }]} />
                    <View style={[styles.presetDot, { backgroundColor: preset.colors.accent }]} />
                    <Text style={[styles.presetLabel, isSelected && styles.presetLabelActive]}>
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Action Buttons */}
          <View style={styles.detailButtons}>
            <PrimaryButton
              label={`Use ${previewingTheme.name}`}
              onPress={() => handleApply(previewingTheme.id, selectedPresetId ?? undefined)}
              style={{ flex: 1 }}
            />
            <SecondaryButton
              label="Customize First"
              onPress={() => handleApply(previewingTheme.id, selectedPresetId ?? undefined, true)}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const CYAN = theme.secondary;
  const BORDER_ACTIVE = theme.accentLight;
  const CARD = theme.card;
  const CARD_ELEVATED = theme.cardElevated;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const SUCCESS = theme.success;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  categoryRow: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.sm,
  },
  gridRow: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  gridContent: {
    paddingTop: SP.sm,
  },
  themeCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    marginBottom: SP.sm,
  },
  swatchArea: {
    height: 120,
    overflow: 'hidden',
    position: 'relative',
  },
  swatchGradient: {
    ...StyleSheet.absoluteFill,
  },
  colorDots: {
    position: 'absolute',
    bottom: SP.sm,
    right: SP.sm,
    flexDirection: 'row',
    gap: 4,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  currentBadge: {
    position: 'absolute',
    top: SP.sm,
    left: SP.sm,
    backgroundColor: `${SUCCESS}26`,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  currentBadgeText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: SUCCESS,
    letterSpacing: 0.5,
  },
  previewingBadge: {
    position: 'absolute',
    top: SP.sm,
    left: SP.sm,
    backgroundColor: `${CYAN}26`,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  previewingBadgeText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: CYAN,
    letterSpacing: 0.5,
  },
  themeInfo: {
    padding: SP.sm,
    gap: 3,
  },
  themeName: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
  },
  themeMeta: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  themeBestFor: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    marginBottom: SP.xs,
  },
  themeActions: {
    flexDirection: 'row',
    gap: SP.xs,
    marginTop: 4,
  },
  previewBtn: {
    flex: 1,
    height: 30,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PURPLE_DIM,
  },
  previewBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
  useBtn: {
    flex: 1,
    height: 30,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useBtnDisabled: {
    backgroundColor: CARD_ELEVATED,
  },
  useBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: theme.onAccent,
  },
  // Detail Panel
  detailPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 360,
    backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
  },
  detailHandle: {
    width: 36,
    height: 4,
    backgroundColor: BORDER,
    borderRadius: RADIUS.pill,
    alignSelf: 'center',
    marginBottom: SP.sm,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SP.sm,
  },
  detailName: {
    fontSize: FS.lg,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },
  detailCategory: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
    marginTop: 1,
  },
  detailDesc: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: SP.xs,
    lineHeight: 18,
  },
  detailBestFor: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
    marginTop: SP.xs,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD_ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modesRow: {
    flexGrow: 0,
    marginBottom: SP.sm,
  },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    marginRight: SP.xs,
  },
  modeChipText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  styleSheetRow: {
    flexDirection: 'row',
    gap: SP.xs,
    marginBottom: SP.sm,
  },
  styleSheetChip: {
    flex: 1,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ELEVATED,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  styleSheetLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  styleSheetValue: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
    marginTop: 1,
    textTransform: 'capitalize',
  },
  presetsRow: {
    flexGrow: 0,
    marginBottom: SP.sm,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    marginRight: SP.xs,
  },
  presetChipActive: {
    borderColor: BORDER_ACTIVE,
    backgroundColor: PURPLE_DIM,
  },
  presetDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  presetLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  presetLabelActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },
  detailButtons: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.xs,
  },
  });
};
