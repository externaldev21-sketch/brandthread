import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppIconPreference, type AppIconPreference } from '@/contexts/AppIconContext';
import { APP_THEME_PRESETS, type AppThemeId, useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const APP_ICON_IMAGES: Record<AppThemeId, ImageSourcePropType> = {
  monochrome: require('../assets/images/app-icons/monochrome.png'),
  purple: require('../assets/images/app-icons/purple.png'),
  olive: require('../assets/images/app-icons/olive.png'),
  navy: require('../assets/images/app-icons/navy.png'),
  champagne: require('../assets/images/app-icons/champagne.png'),
  black: require('../assets/images/app-icons/black.png'),
  silver: require('../assets/images/app-icons/silver.png'),
  'black-gold': require('../assets/images/app-icons/black-gold.png'),
  'emerald-gold': require('../assets/images/app-icons/emerald-gold.png'),
  'leopard-red': require('../assets/images/app-icons/leopard-red.png'),
  maroon: require('../assets/images/app-icons/maroon.png'),
  gold: require('../assets/images/app-icons/gold.png'),
};

export default function AppIconScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { preference, resolvedIconId, followsTheme, selectIcon } = useAppIconPreference();

  async function chooseIcon(nextPreference: AppIconPreference) {
    if (nextPreference === preference) return;
    await Haptics.selectionAsync();
    await selectIcon(nextPreference);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="App icon" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={[
            styles.followCard,
            {
              backgroundColor: theme.card,
              borderColor: followsTheme ? theme.accent : theme.border,
            },
          ]}
          activeOpacity={0.82}
          onPress={() => chooseIcon(null)}
          accessibilityRole="radio"
          accessibilityState={{ selected: followsTheme }}
          accessibilityLabel={`Follow app theme${followsTheme ? ', selected' : ''}`}
        >
          <Image source={APP_ICON_IMAGES[resolvedIconId]} style={styles.followIcon} />
          <View style={styles.followCopy}>
            <Text style={[styles.followTitle, { color: theme.text }]}>Follow app theme</Text>
            <Text style={[styles.followSubtitle, { color: theme.muted }]}>
              Automatically matches {theme.name}
            </Text>
          </View>
          <View
            style={[
              styles.radio,
              {
                borderColor: followsTheme ? theme.accent : theme.border,
                backgroundColor: followsTheme ? theme.accent : 'transparent',
              },
            ]}
          >
            {followsTheme ? <Feather name="check" size={13} color={theme.onAccent} /> : null}
          </View>
        </TouchableOpacity>

        <Text style={[styles.helper, { color: theme.muted }]}>
          Choose an icon override, or keep it synced to your app theme.
        </Text>

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
                <View
                  style={[
                    styles.iconFrame,
                    {
                      borderColor: selected ? option.accent : theme.border,
                      backgroundColor: theme.card,
                    },
                  ]}
                >
                  <Image source={APP_ICON_IMAGES[option.id]} style={styles.icon} />
                  {selected ? (
                    <View style={[styles.selectedBadge, { backgroundColor: option.accent }]}>
                      <Feather name="check" size={12} color={option.onAccent} />
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.label, { color: selected ? option.accentLight : theme.text }]}
                  numberOfLines={1}
                >
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
  followCard: {
    minHeight: 78,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: SP.sm,
    gap: SP.sm,
  },
  followIcon: { width: 54, height: 54, borderRadius: 13 },
  followCopy: { flex: 1 },
  followTitle: { fontFamily: FONT.semibold, fontSize: FS.md },
  followSubtitle: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 3 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helper: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginVertical: SP.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: SP.lg,
  },
  item: { width: '30.5%', alignItems: 'center' },
  iconFrame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 22,
    borderWidth: 1,
    padding: 5,
  },
  icon: { width: '100%', height: '100%', borderRadius: 17 },
  selectedBadge: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: FONT.semibold, fontSize: FS.xs, marginTop: 7, textAlign: 'center' },
});