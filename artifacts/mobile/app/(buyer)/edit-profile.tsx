import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput, Switch, useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { loadStyleBadge, saveStyleBadge, DEFAULT_STYLE_BADGE, type StyleBadgeState } from '@/lib/styleBadge';

export default function BuyerEditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';

  const bg      = isDark ? '#121110' : '#F5F1E7';
  const card    = isDark ? '#1B1917' : '#FFFFFF';
  const border  = isDark ? '#33302A' : '#E3DCC9';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#6E6759';
  const primary = isDark ? '#39FF88' : '#00C853';

  const [badge, setBadge] = useState<StyleBadgeState>({ ...DEFAULT_STYLE_BADGE, enabled: true });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadStyleBadge().then((state) => { setBadge(state); setLoaded(true); });
  }, []);

  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  function handleSave() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const cleaned: StyleBadgeState = {
      label: badge.label.trim() || DEFAULT_STYLE_BADGE.label,
      emoji: badge.emoji.trim() || DEFAULT_STYLE_BADGE.emoji,
      enabled: badge.enabled,
    };
    saveStyleBadge(cleaned).then(() => router.back());
  }

  if (!loaded) return <View style={{ flex: 1, backgroundColor: bg }} />;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => router.back()}
        >
          <Feather name="chevron-left" size={24} color={fg} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: fg }]}>Edit profile</Text>
        <TouchableOpacity onPress={handleSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.saveText, { color: primary }]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={[styles.sectionLabel, { color: muted }]}>Style badge</Text>
        <Text style={[styles.sectionHint, { color: muted }]}>
          Shown next to your name on your profile.
        </Text>

        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: fg }]}>Show badge</Text>
            <View style={{ flex: 1 }} />
            <Switch
              value={badge.enabled}
              onValueChange={(v) => { Haptics.selectionAsync(); setBadge((b) => ({ ...b, enabled: v })); }}
              trackColor={{ false: border, true: primary }}
              thumbColor="#FFFFFF"
            />
          </View>
          <Divider color={border} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: fg }]}>Emoji</Text>
            <TextInput
              style={[styles.rowInput, { color: fg }]}
              value={badge.emoji}
              onChangeText={(v) => setBadge((b) => ({ ...b, emoji: v }))}
              placeholder="🎞️"
              placeholderTextColor={muted}
              maxLength={4}
            />
          </View>
          <Divider color={border} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: fg }]}>Label</Text>
            <TextInput
              style={[styles.rowInput, { color: fg }]}
              value={badge.label}
              onChangeText={(v) => setBadge((b) => ({ ...b, label: v }))}
              placeholder="Archive Fashion"
              placeholderTextColor={muted}
              maxLength={24}
              returnKeyType="done"
            />
          </View>
        </View>

        {badge.enabled && (
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <Text style={[styles.previewLabel, { color: muted }]}>Preview</Text>
            <View style={[styles.previewBadge, { backgroundColor: primary + '18', borderColor: primary + '40' }]}>
              <Text style={styles.previewEmoji}>{badge.emoji}</Text>
              <Text style={[styles.previewText, { color: primary }]}>{badge.label || 'Your style'}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Divider({ color }: { color: string }) {
  return <View style={{ height: 1, backgroundColor: color, marginLeft: 16 }} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 16,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  saveText:    { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 20, paddingTop: 8 },
  sectionHint:  { fontSize: 12.5, fontFamily: 'Inter_400Regular', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  card: {
    marginHorizontal: 14, borderRadius: 12, borderWidth: 1, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_400Regular', width: 90 },
  rowInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', padding: 0, textAlign: 'right' },
  previewLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 8 },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
  },
  previewEmoji: { fontSize: 14 },
  previewText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
