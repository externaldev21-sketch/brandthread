/**
 * One category page of Settings → Notifications (e.g. "Posts, stories and
 * comments"), opened from app/notifications-settings.tsx.
 *
 * Instagram's category pages 1:1, reskinned
 * (Mobbin: https://mobbin.com/flows/058b1099-edb5-4d07-9493-89c5cf60a6f8):
 * a bold section title per notification type, radio rows Off / On — or
 * Off / From profiles I follow / From everyone — and an example of the
 * notification in grey underneath. Each choice saves to the server at once
 * (routes/notification-prefs.ts `pushTypes`; "Promotions and offers" is the
 * promotional opt-in).
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { useRole } from '@/contexts/RoleContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import { ListRow } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';
import { optionsFor, pageById, type PushTypeValue, type Role, type SettingSection } from '@/lib/notificationSettingsModel';

function RadioMark({ selected, color, idle }: { selected: boolean; color: string; idle: string }) {
  return (
    <View style={[styles.radio, { borderColor: selected ? color : idle }]}>
      {selected ? <View style={[styles.radioDot, { backgroundColor: color }]} /> : null}
    </View>
  );
}

export default function NotificationSettingsPage() {
  const router = useRouter();
  const api = useApi();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const appRole = useRole().role;
  const [role, setRole] = useState<Role | null>(null);
  const [values, setValues] = useState<Record<string, PushTypeValue>>({});
  const [promotions, setPromotions] = useState(false);

  useFocusEffect(useCallback(() => {
    api.notificationPrefs.get()
      .then((data) => {
        setRole(data.role);
        setValues((data.pushTypes ?? {}) as Record<string, PushTypeValue>);
        setPromotions(data.promotionalPush ?? false);
      })
      .catch(() => setRole((r) => r ?? (appRole === 'seller' ? 'seller' : 'buyer')));
  }, [api, appRole]));

  const page = role ? pageById(role, id) : undefined;

  function current(section: SettingSection): PushTypeValue {
    if (section.key === 'promotions') return promotions ? 'everyone' : 'off';
    return values[section.key] ?? 'everyone';
  }

  async function choose(section: SettingSection, value: PushTypeValue) {
    if (current(section) === value) return;
    hapticSelection();
    if (section.key === 'promotions') {
      const prior = promotions;
      setPromotions(value !== 'off');
      try {
        const saved = await api.notificationPrefs.update({ promotionalPush: value !== 'off' });
        setPromotions(saved.promotionalPush ?? value !== 'off');
      } catch {
        setPromotions(prior);
      }
      return;
    }
    const prior = values;
    setValues({ ...values, [section.key]: value });
    try {
      const saved = await api.notificationPrefs.update({ pushTypes: { [section.key]: value } });
      if (saved.pushTypes) setValues(saved.pushTypes as Record<string, PushTypeValue>);
    } catch {
      setValues(prior);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={page?.title ?? 'Notifications'}
        divider={false}
        onBack={() => goBackOr(router, '/notifications-settings')}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {page?.sections.map((section, index) => (
          <View key={section.key} style={index > 0 ? styles.sectionGap : undefined}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
            <View accessibilityRole="radiogroup">
              {optionsFor(section).map((option) => {
                const selected = current(section) === option.value;
                return (
                  <ListRow
                    key={option.value}
                    title={option.label}
                    right={<RadioMark selected={selected} color={colors.foreground} idle={colors.mutedForeground} />}
                    onPress={() => void choose(section, option.value)}
                    testID={`notification-setting-${section.key}-${option.value}`}
                  />
                );
              })}
            </View>
            <Text style={[styles.example, { color: colors.mutedForeground }]}>{section.example}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: 140 },
  sectionTitle: { ...TYPE_SCALE.headline, fontFamily: FONT.semibold, marginTop: SPACING.sm, marginBottom: SPACING.xs },
  sectionGap: { marginTop: SPACING.lg },
  example: { ...TYPE_SCALE.footnote, marginTop: SPACING.xs },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
