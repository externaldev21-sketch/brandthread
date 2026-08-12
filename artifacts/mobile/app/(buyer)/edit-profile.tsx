import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput, Switch, Alert, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { loadStyleBadge, saveStyleBadge, DEFAULT_STYLE_BADGE, type StyleBadgeState } from '@/lib/styleBadge';
import { loadBuyerProfile, saveBuyerProfile, DEFAULT_BUYER_PROFILE, type BuyerProfileFields } from '@/lib/buyerProfile';
import { BG, CARD, BORDER, FG, MUTED, PURPLE, CYAN, GRAD_PRIMARY } from '@/lib/theme';

export default function BuyerEditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bg      = BG;
  const card    = CARD;
  const border  = BORDER;
  const fg      = FG;
  const muted   = MUTED;
  const primary = PURPLE;
  const accent  = CYAN;

  const [badge, setBadge] = useState<StyleBadgeState>({ ...DEFAULT_STYLE_BADGE, enabled: true });
  const [fields, setFields] = useState<BuyerProfileFields>({ ...DEFAULT_BUYER_PROFILE });
  const [loaded, setLoaded] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  function set(key: keyof Omit<BuyerProfileFields, 'aiCreator'>, val: string) {
    setFields((prev) => ({ ...prev, [key]: val }));
  }

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to update your profile picture.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (!res.canceled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setAvatarUri(res.assets[0].uri);
    }
  }

  useEffect(() => {
    Promise.all([loadStyleBadge(), loadBuyerProfile()])
      .then(([badgeState, profileState]) => {
        setBadge(badgeState);
        setFields(profileState);
      })
      .catch(() => {
        // Keep the already-seeded defaults if loading fails.
      })
      .finally(() => setLoaded(true));
  }, []);

  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  async function handleSave() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const cleaned: StyleBadgeState = {
      label: badge.label.trim() || DEFAULT_STYLE_BADGE.label,
      emoji: badge.emoji.trim() || DEFAULT_STYLE_BADGE.emoji,
      enabled: badge.enabled,
    };
    const cleanedFields: BuyerProfileFields = {
      ...fields,
      username: fields.username.trim() || DEFAULT_BUYER_PROFILE.username,
      bio: fields.bio.trim(),
    };
    const [badgeOk, profileOk] = await Promise.all([
      saveStyleBadge(cleaned).then(() => true).catch(() => false),
      saveBuyerProfile(cleanedFields),
    ]);
    if (!badgeOk || !profileOk) {
      Alert.alert('Save failed', 'Something went wrong saving your profile. Please try again.');
      return;
    }
    router.back();
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
        {/* ─ Avatar ─ */}
        <View style={styles.avatarSection}>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <TouchableOpacity activeOpacity={0.8} onPress={pickAvatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={GRAD_PRIMARY} style={styles.avatar}>
                  <Text style={styles.avatarText}>😎</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.avatarOutline, { borderColor: border }]}
              onPress={pickAvatar}
            >
              <Feather name="camera" size={24} color={muted} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={pickAvatar}>
            <Text style={[styles.editPhotoLink, { color: accent }]}>Edit picture or avatar</Text>
          </TouchableOpacity>
        </View>

        {/* ─ Core fields ─ */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginBottom: 12 }]}>
          <EditRow label="Name" value={fields.name} placeholder="Name" onChange={(v) => set('name', v)} colors={{ fg, muted }} />
          <Divider color={border} />
          <EditRow label="Username" value={fields.username} placeholder="Username" onChange={(v) => set('username', v)} colors={{ fg, muted }} />
          <Divider color={border} />
          <EditRow label="Pronouns" value={fields.pronouns} placeholder="Pronouns" onChange={(v) => set('pronouns', v)} colors={{ fg, muted }} />
          <Divider color={border} />
          <EditRow label="Bio" value={fields.bio} placeholder="Bio" onChange={(v) => set('bio', v)} colors={{ fg, muted }} />
          <Divider color={border} />
          <EditRow label="Links" value={fields.links} placeholder="Add links" onChange={(v) => set('links', v)} colors={{ fg, muted }} />
        </View>

        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginBottom: 12 }]}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/story-creator' as never); }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: fg, width: 'auto' }]}>Banners</Text>
              <Text style={[styles.rowHint, { color: muted }]}>Add music, profiles and more.</Text>
            </View>
            <Text style={[styles.chevronLabel, { color: muted }]}>Add banners</Text>
            <Feather name="chevron-right" size={17} color={muted} />
          </TouchableOpacity>
          <Divider color={border} />
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/ai-studio' as never); }}
          >
            <Text style={[styles.rowLabel, { color: fg, width: 'auto', flex: 1 }]}>Reorder grid</Text>
            <Feather name="chevron-right" size={17} color={muted} />
          </TouchableOpacity>
          <Divider color={border} />
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert('Gender', 'Choose how your gender is displayed.', [
                { text: 'Woman', onPress: () => set('gender', 'Woman') },
                { text: 'Man', onPress: () => set('gender', 'Man') },
                { text: 'Non-binary', onPress: () => set('gender', 'Non-binary') },
                { text: 'Prefer not to say', onPress: () => set('gender', 'Prefer not to say') },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
          >
            <Text style={[styles.rowLabel, { color: fg, width: 'auto', flex: 1 }]}>Gender</Text>
            <Text style={[styles.chevronLabel, { color: muted }]}>{fields.gender || 'Gender'}</Text>
            <Feather name="chevron-right" size={17} color={muted} />
          </TouchableOpacity>
          <Divider color={border} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: fg, width: 'auto' }]}>AI creator</Text>
              <Text style={[styles.rowHint, { color: muted }]}>Add this label to your profile if your content often uses AI.</Text>
            </View>
            <View style={[styles.newPill, { backgroundColor: accent }]}>
              <Text style={styles.newPillText}>New</Text>
            </View>
            <Switch
              value={fields.aiCreator}
              onValueChange={(v) => { Haptics.selectionAsync(); setFields((prev) => ({ ...prev, aiCreator: v })); }}
              trackColor={{ false: border, true: primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginBottom: 12 }]}>
          <TouchableOpacity
            style={styles.linkRow}
            activeOpacity={0.7}
            onPress={() => router.push('/(tabs)/profile' as never)}
          >
            <Text style={[styles.linkText, { color: accent }]}>Switch to professional account</Text>
          </TouchableOpacity>
          <Divider color={border} />
          <TouchableOpacity
            style={styles.linkRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings' as never)}
          >
            <Text style={[styles.linkText, { color: accent }]}>Personal information settings</Text>
          </TouchableOpacity>
          <Divider color={border} />
          <TouchableOpacity
            style={styles.linkRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings' as never)}
          >
            <Text style={[styles.linkText, { color: accent }]}>Show your profile is verified</Text>
          </TouchableOpacity>
        </View>

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

function EditRow({
  label, value, placeholder, onChange, colors,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  colors: { fg: string; muted: string };
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.fg }]}>{label}</Text>
      <TextInput
        style={[styles.rowInput, { color: colors.fg }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        returnKeyType="done"
      />
      <Feather name="chevron-right" size={17} color={colors.muted} />
    </View>
  );
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
  rowHint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3 },
  rowInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', padding: 0, textAlign: 'right' },
  chevronLabel: { fontSize: 13.5, fontFamily: 'Inter_400Regular' },
  linkRow: { paddingHorizontal: 16, paddingVertical: 14 },
  linkText: { fontSize: 14.5, fontFamily: 'Inter_500Medium' },
  newPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  newPillText: { fontSize: 10.5, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  avatarSection: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32 },
  avatarOutline: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  editPhotoLink: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  previewLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 8 },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
  },
  previewEmoji: { fontSize: 14 },
  previewText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
