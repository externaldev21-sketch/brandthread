import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Platform, TextInput, Image, Animated, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { useApi } from '@/hooks/useApi';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

type DragRow = { label: string };

const DRAG_ROWS: DragRow[] = [
  { label: 'Brand Studio' },
  { label: 'Your orders'  },
  { label: 'Analytics'    },
];

const EMPTY_FIELDS = {
  name:     '',
  username: '',
  bio:      '',
  pronoun:  '',
  category: '',
  website:  '',
};

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [fields, setFields] = useState<Record<string, string>>(EMPTY_FIELDS);
  const [order, setOrder] = useState(DRAG_ROWS.map((r) => r.label));
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Never overwrite the seller's real profile with placeholder defaults —
  // fields start empty and Save stays disabled until a real profile loads.
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState(false);

  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, visible: true });
    Animated.timing(toastOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      setToast((t) => ({ ...t, visible: false }));
    }, 2500);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const loadProfile = React.useCallback(() => {
    setProfileError(false);
    api.seller.getProfile()
      .then((profile) => {
        setAvatarUri(profile.profileImageUrl ?? null);
        setFields({
          name: profile.brandName ?? profile.displayName ?? '',
          username: profile.username ? `@${profile.username}` : '',
          bio: profile.bio ?? '',
          pronoun: '',
          category: '',
          website: profile.website ?? '',
        });
        setProfileLoaded(true);
      })
      .catch(() => setProfileError(true));
  }, [api]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

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
    if (saving || uploadingAvatar || !profileLoaded) return;
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

  async function handleCopyLink() {
    const username = fields.username.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!username) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(`https://brandthread.app/u/${username}`);
    showToast('Link copied');
  }

  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const username = fields.username.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => router.back()}
        >
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving || !profileLoaded} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.saveText, (saving || !profileLoaded) && { opacity: 0.4 }]}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      {/* Toast */}
      <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity }]}>
        <Feather name="check-circle" size={14} color={theme.onAccent} />
        <Text style={styles.toastText}>{toast.message}</Text>
      </Animated.View>

      {profileError ? (
        <View style={styles.errorState}>
          <Feather name="alert-circle" size={28} color={theme.muted} />
          <Text style={styles.errorTitle}>Couldn't load your profile</Text>
          <Text style={styles.errorBody}>Pull to retry.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadProfile} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : !profileLoaded ? (
        <View style={styles.errorState}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
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
                <LinearGradient colors={theme.primaryGradient as any} style={styles.avatar}>
                  <Text style={styles.avatarText}>{(fields.name || fields.username || '?').slice(0, 2).toUpperCase()}</Text>
                </LinearGradient>
              )}
              <View style={styles.cameraOverlay}>
                <Feather name="camera" size={18} color={theme.onAccent} />
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
            theme={theme}
          />
          <Divider theme={theme} />
          <EditRow
            label="Username"
            value={fields.username}
            onChange={(v) => set('username', v)}
            theme={theme}
          />
          <Divider theme={theme} />
          {/* Non-editable link row with copy */}
          <View style={styles.row}>
            <Text style={styles.rowLabel} />
            <Text style={[styles.rowValue, { flex: 1 }]} numberOfLines={1}>
              {username ? `brandthread.app/u/${username}` : 'Add a username to get your link'}
            </Text>
            <TouchableOpacity onPress={handleCopyLink} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={!username}>
              <Feather name="copy" size={17} color={theme.muted} />
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
            theme={theme}
          />
          <Divider theme={theme} />
          <EditRow
            label="Pronoun"
            value={fields.pronoun}
            placeholder="Add pronouns"
            onChange={(v) => set('pronoun', v)}
            theme={theme}
          />
          <Divider theme={theme} />
          <EditRow
            label="Category"
            value={fields.category}
            placeholder="Add category"
            onChange={(v) => set('category', v)}
            theme={theme}
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
            theme={theme}
          />
        </View>

        {/* Change display order */}
        <Text style={styles.sectionLabel}>Change display order</Text>
        <View style={styles.card}>
          {order.map((label, i) => (
            <View key={label}>
              {i > 0 && <Divider theme={theme} />}
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: theme.text, flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15 }]}>
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
                  <Feather name="menu" size={20} color={theme.muted} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      )}
    </View>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function Divider({ theme }: { theme: AppThemePreset }) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 16 }} />;
}

function EditRow({
  label, value, placeholder, multiline, onChange, theme,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (v: string) => void;
  theme: AppThemePreset;
}) {
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.row, multiline && { alignItems: 'flex-start', paddingVertical: 14 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        style={[styles.rowInput, multiline && { height: 64 }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? label}
        placeholderTextColor={theme.muted}
        multiline={multiline}
        returnKeyType={multiline ? 'default' : 'done'}
        autoCorrect={false}
      />
      {!multiline && <Feather name="chevron-right" size={17} color={theme.muted} />}
    </View>
  );
}

/* ── Styles ──────────────────────────────────────────────────────── */

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 16,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: theme.text },
  saveText:    { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: theme.accentLight },

  toast: {
    position: 'absolute', top: 56, alignSelf: 'center', zIndex: 99,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.success, borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  toastText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: theme.onAccent },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  errorTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: theme.text, marginTop: 4 },
  errorBody:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: theme.muted, textAlign: 'center' },
  retryBtn:   { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.accent },
  retryBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: theme.onAccent },

  avatarSection: { alignItems: 'center', paddingVertical: 22 },
  avatarWrap: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', position: 'relative' },
  avatar: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, fontFamily: 'Inter_700Bold', color: theme.onAccent },
  cameraOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 32,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', // theme-exempt: scrim over avatar media
  },
  editPhotoLink: { marginTop: 10, fontSize: 14, fontFamily: 'Inter_500Medium', color: theme.accentLight },

  sectionLabel: {
    fontSize: 13, fontFamily: 'Inter_500Medium', color: theme.muted,
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8,
  },

  card: {
    backgroundColor: theme.card, marginHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border, overflow: 'hidden',
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  rowLabel: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: theme.text, width: 90,
  },
  rowValue: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: theme.muted,
  },
  rowInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: theme.text,
    padding: 0,   // Remove default TextInput padding
  },
});
