import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Platform, TextInput, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useApi } from '@/hooks/useApi';

const bg     = '#000000';
const card   = '#161616';
const border = '#2A2A2A';
const fg     = '#FFFFFF';
const muted  = '#8C8C8C';
const accent = '#1DA1F2'; // TikTok-style teal/blue for links

type Row = {
  label: string;
  value: string;
  placeholder?: string;
  key: string;
};

type DragRow = { label: string };

const DRAG_ROWS: DragRow[] = [
  { label: 'Brand Studio' },
  { label: 'Your orders'  },
  { label: 'Analytics'    },
];

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [fields, setFields] = useState<Record<string, string>>({
    name:     'Brandthread',
    username: '@brandthread',
    bio:      '',
    pronoun:  '',
    category: '',
    website:  '',
  });

  const [order, setOrder] = useState(DRAG_ROWS.map((r) => r.label));
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    api.seller.getProfile()
      .then((profile) => {
        setAvatarUri(profile.profileImageUrl ?? null);
        setFields((current) => ({
          ...current,
          name: profile.brandName ?? profile.displayName ?? current.name,
          username: profile.username ? `@${profile.username}` : current.username,
          bio: profile.bio ?? '',
          website: profile.website ?? '',
        }));
      })
      .catch(() => {});
  }, [api]);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to update your brand avatar.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      mediaTypes: ['images'],
    });
    if (res.canceled || !res.assets[0]) return;
    setUploadingAvatar(true);
    try {
      const updated = await api.seller.uploadAvatar(res.assets[0]);
      setAvatarUri(updated.profileImageUrl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Could not update photo', 'Check your connection and try again.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  function set(key: string, val: string) {
    setFields((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (saving || uploadingAvatar) return;
    setSaving(true);
    try {
      await api.seller.updateProfile({
        name:        fields.name,
        brandName:   fields.name,
        username:    fields.username.replace(/^@/, ''),
        bio:         fields.bio,
        website:     fields.website,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleCopyLink() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Link copied', 'brandthread.app/@brandthread');
  }

  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => router.back()}
        >
          <Feather name="chevron-left" size={24} color={fg} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity activeOpacity={0.8} onPress={pickAvatar} disabled={uploadingAvatar}>
            <View style={styles.avatarWrap}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={['#9F7AEA', '#5B3FA0']} style={styles.avatar}>
                  <Text style={styles.avatarText}>BT</Text>
                </LinearGradient>
              )}
              <View style={styles.cameraOverlay}>
                <Feather name="camera" size={18} color={fg} />
              </View>
            </View>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={pickAvatar}>
            <Text style={styles.editPhotoLink}>{uploadingAvatar ? 'Uploading photo…' : 'Edit photo or avatar'}</Text>
          </TouchableOpacity>
        </View>

        {/* Profile fields card */}
        <View style={[styles.card, { marginBottom: 8 }]}>
          <EditRow
            label="Name"
            value={fields.name}
            onChange={(v) => set('name', v)}
          />
          <Divider />
          <EditRow
            label="Username"
            value={fields.username}
            onChange={(v) => set('username', v)}
          />
          <Divider />
          {/* Non-editable link row with copy */}
          <View style={styles.row}>
            <Text style={styles.rowLabel} />
            <Text style={[styles.rowValue, { color: muted, flex: 1 }]} numberOfLines={1}>
              brandthread.app/{fields.username.replace('@', '')}
            </Text>
            <TouchableOpacity onPress={handleCopyLink} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="copy" size={17} color={muted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Basic info */}
        <Text style={styles.sectionLabel}>Basic info</Text>
        <View style={[styles.card, { marginBottom: 8 }]}>
          <EditRow
            label="Bio"
            value={fields.bio}
            placeholder="Write a short description about your brand"
            multiline
            onChange={(v) => set('bio', v)}
          />
          <Divider />
          <EditRow
            label="Pronoun"
            value={fields.pronoun}
            placeholder="Add pronouns"
            onChange={(v) => set('pronoun', v)}
          />
          <Divider />
          <EditRow
            label="Category"
            value={fields.category}
            placeholder="Add category"
            onChange={(v) => set('category', v)}
          />
        </View>

        {/* Others */}
        <Text style={styles.sectionLabel}>Others</Text>
        <View style={[styles.card, { marginBottom: 8 }]}>
          <EditRow
            label="Website"
            value={fields.website}
            placeholder="Add website"
            onChange={(v) => set('website', v)}
          />
        </View>

        {/* Change display order */}
        <Text style={styles.sectionLabel}>Change display order</Text>
        <View style={styles.card}>
          {order.map((label, i) => (
            <View key={label}>
              {i > 0 && <Divider />}
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: fg, flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15 }]}>
                  {label}
                </Text>
                <TouchableOpacity
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (i > 0) {
                      const next = [...order];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setOrder(next);
                    }
                  }}
                >
                  <Feather name="menu" size={20} color={muted} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function Divider() {
  return <View style={{ height: 1, backgroundColor: border, marginLeft: 16 }} />;
}

function EditRow({
  label, value, placeholder, multiline, onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <View style={[styles.row, multiline && { alignItems: 'flex-start', paddingVertical: 14 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        style={[styles.rowInput, multiline && { height: 64 }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? value}
        placeholderTextColor={muted}
        multiline={multiline}
        returnKeyType={multiline ? 'default' : 'done'}
        autoCorrect={false}
      />
      {!multiline && <Feather name="chevron-right" size={17} color={muted} />}
    </View>
  );
}

/* ── Styles ──────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 16,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: fg },
  saveText:    { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: accent },

  avatarSection: { alignItems: 'center', paddingVertical: 22 },
  avatarWrap: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', position: 'relative' },
  avatar: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, fontFamily: 'Inter_700Bold', color: fg },
  cameraOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 32,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  editPhotoLink: { marginTop: 10, fontSize: 14, fontFamily: 'Inter_500Medium', color: accent },

  sectionLabel: {
    fontSize: 13, fontFamily: 'Inter_500Medium', color: muted,
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8,
  },

  card: {
    backgroundColor: card, marginHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: border, overflow: 'hidden',
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  rowLabel: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: fg, width: 90,
  },
  rowValue: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: muted,
  },
  rowInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: fg,
    padding: 0,   // Remove default TextInput padding
  },
});
