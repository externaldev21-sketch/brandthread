import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput, Switch, Modal, Image, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { loadStyleBadge, saveStyleBadge, DEFAULT_STYLE_BADGE, type StyleBadgeState } from '@/lib/styleBadge';
import { loadBuyerProfile, saveBuyerProfile, DEFAULT_BUYER_PROFILE, type BuyerProfileFields } from '@/lib/buyerProfile';
import { updateMyProfile, getMyProfile } from '@/services/socialService';
import { api } from '@/lib/api';
import {
  BG, SCREEN_BG, CARD, BORDER, FG, MUTED, SUBTLE,
  RED, ORANGE, SUCCESS,
  FONT, FS, SP, RADIUS, OVERLAY,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';

const GENDER_OPTIONS = ['Woman', 'Man', 'Non-binary', 'Prefer not to say', 'Custom'] as const;

function Divider() {
  return <View style={{ height: 1, backgroundColor: BORDER, marginLeft: 16 }} />;
}

function EditRow({
  label, value, placeholder, onChange, multiline,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <View style={[styles.row, multiline && { alignItems: 'flex-start', paddingTop: 13 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        style={[styles.rowInput, multiline && { textAlignVertical: 'top', minHeight: 60 }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        autoCorrect={false}
        returnKeyType={multiline ? 'default' : 'done'}
        multiline={multiline}
      />
      {!multiline && <Feather name="chevron-right" size={17} color={MUTED} />}
    </View>
  );
}

function GenderPicker({
  visible, current, onSelect, onClose,
}: {
  visible: boolean;
  current: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.pickerSheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.pickerHandle} />
          <Text style={styles.pickerTitle}>Gender</Text>
          {GENDER_OPTIONS.map(option => (
            <TouchableOpacity
              key={option}
              style={[styles.pickerRow, current === option && [styles.pickerRowActive, { backgroundColor: theme.accentDim }]]}
              onPress={() => { onSelect(option); onClose(); }}
            >
              <Text style={[styles.pickerRowText, current === option && { color: theme.accent }]}>{option}</Text>
              {current === option && <Feather name="check" size={16} color={theme.accent} />}
            </TouchableOpacity>
          ))}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function BuyerEditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useAppTheme();

  const [badge, setBadge] = useState<StyleBadgeState>({ ...DEFAULT_STYLE_BADGE, enabled: true });
  const [fields, setFields] = useState<BuyerProfileFields>({ ...DEFAULT_BUYER_PROFILE });
  const [loaded, setLoaded] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [genderPickerOpen, setGenderPickerOpen] = useState(false);
  // Username availability state
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [usernameError, setUsernameError]   = useState('');

  // Only letters, numbers, underscores — 3 to 30 characters
  const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

  /** Check username availability via API. Call on blur or before save. */
  async function checkUsernameAvailability(raw: string) {
    const u = raw.trim().toLowerCase();
    if (!u) { setUsernameStatus('idle'); setUsernameError(''); return; }
    if (!USERNAME_RE.test(u)) {
      setUsernameStatus('invalid');
      setUsernameError('Letters, numbers and underscores only (3–30 chars)');
      return;
    }
    setUsernameStatus('checking');
    try {
      const result = await api.auth.checkUsername(u);
      if (result.available) {
        setUsernameStatus('ok');
        setUsernameError('');
      } else {
        setUsernameStatus('taken');
        setUsernameError(result.error ?? 'Username already taken');
      }
    } catch {
      // Network issue — don't block save; server will re-validate
      setUsernameStatus('idle');
      setUsernameError('');
    }
  }

  function set(key: keyof Omit<BuyerProfileFields, 'aiCreator'>, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
  }

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to update your profile picture.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (!res.canceled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setAvatarUri(res.assets[0].uri);
    }
  }

  useEffect(() => {
    // Load both storage sources; social profile is the authoritative source for
    // the shared identity fields so an empty buyerProfile doesn't overwrite them.
    Promise.all([loadStyleBadge(), loadBuyerProfile(), getMyProfile()])
      .then(([badgeState, profileState, socialProfile]) => {
        setBadge(badgeState);
        // Merge: prefer buyerProfile for local-only fields; fall back to
        // socialProfile for shared identity fields to avoid clobbering a name
        // that was set via Personal Details or a prior Edit Profile save.
        const merged: BuyerProfileFields = {
          ...profileState,
          name:     profileState.name || socialProfile.name,
          username: profileState.username || socialProfile.username || DEFAULT_BUYER_PROFILE.username,
          pronouns: profileState.pronouns || socialProfile.pronouns,
          bio:      profileState.bio && profileState.bio !== DEFAULT_BUYER_PROFILE.bio
            ? profileState.bio
            : (socialProfile.bio || profileState.bio),
          links:    profileState.links || socialProfile.website,
          location: profileState.location || socialProfile.location,
        };
        setFields(merged);
        if (merged.avatarUri) setAvatarUri(merged.avatarUri);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  async function handleSave() {
    // ── Username validation (client + server) ──────────────────────────────
    const rawUsername = fields.username.trim().toLowerCase();
    if (rawUsername) {
      if (!USERNAME_RE.test(rawUsername)) {
        Alert.alert('Invalid username', 'Username may only contain letters, numbers, and underscores (3–30 characters).');
        return;
      }
      if (usernameStatus === 'taken') {
        Alert.alert('Username taken', usernameError || 'Please choose a different username.');
        return;
      }
      if (usernameStatus === 'checking') {
        Alert.alert('Please wait', 'Still checking username availability…');
        return;
      }
      // If status is idle (user never blurred), check now before saving
      if (usernameStatus === 'idle' || usernameStatus === 'invalid') {
        await checkUsernameAvailability(rawUsername);
        // Re-read status after check (usernameStatus closure won't update inside the same call)
        const rechecked = await api.auth.checkUsername(rawUsername).catch(() => null);
        if (rechecked && !rechecked.available) {
          Alert.alert('Username taken', rechecked.error || 'Please choose a different username.');
          return;
        }
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const cleanedBadge: StyleBadgeState = {
      label: badge.label.trim() || DEFAULT_STYLE_BADGE.label,
      emoji: badge.emoji.trim() || DEFAULT_STYLE_BADGE.emoji,
      enabled: badge.enabled,
    };
    const cleanedFields: BuyerProfileFields = {
      ...fields,
      username: fields.username.trim() || DEFAULT_BUYER_PROFILE.username,
      bio: fields.bio.trim(),
      avatarUri: avatarUri || '',
    };

    // Derive initials from name for the social profile
    const nameParts = cleanedFields.name.trim().split(' ');
    const initials = nameParts.length >= 2
      ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
      : nameParts[0].slice(0, 2).toUpperCase();

    await Promise.all([
      saveStyleBadge(cleanedBadge),
      saveBuyerProfile(cleanedFields),
      // Sync key identity fields to the local social profile
      updateMyProfile({
        name: cleanedFields.name,
        username: cleanedFields.username,
        pronouns: cleanedFields.pronouns,
        bio: cleanedFields.bio,
        website: cleanedFields.links,
        location: cleanedFields.location,
        avatarInitials: initials,
      }),
    ]);

    // Persist username + profile fields to the DB (fire-and-forget; server validates again)
    api.auth.updateProfile({
      username:    rawUsername || undefined,
      displayName: cleanedFields.name,
      name:        cleanedFields.name,
      bio:         cleanedFields.bio,
      website:     cleanedFields.links,
    }).catch(() => {});

    router.back();
  }

  if (!loaded) return <View style={{ flex: 1, backgroundColor: SCREEN_BG }} />;

  return (
    <View style={[styles.container, { backgroundColor: SCREEN_BG }]}>
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <TouchableOpacity onPress={handleSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.saveText, { color: theme.accent }]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <TouchableOpacity activeOpacity={0.8} onPress={pickAvatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={[...theme.primaryGradient]} style={styles.avatar}>
                  <Text style={[styles.avatarText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                    {fields.name ? fields.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2) : '😎'}
                  </Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.avatarOutline}
              onPress={pickAvatar}
            >
              <Feather name="camera" size={24} color={MUTED} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={pickAvatar}>
            <Text style={[styles.editPhotoLink, { color: theme.secondary }]}>Edit picture or avatar</Text>
          </TouchableOpacity>
        </View>

        {/* Core fields */}
        <View style={styles.card}>
          <EditRow label="Name" value={fields.name} placeholder="Name" onChange={v => set('name', v)} />
          <Divider />
          {/* Username — format validated in real time; availability checked on blur */}
          <View>
            <View style={[styles.row]}>
              <Text style={styles.rowLabel}>Username</Text>
              <TextInput
                style={[
                  styles.rowInput,
                  usernameStatus === 'taken'   && { color: RED },
                  usernameStatus === 'invalid' && { color: ORANGE },
                ]}
                value={fields.username}
                onChangeText={v => {
                  // Strip invalid chars immediately — no spaces or special chars allowed
                  const cleaned = v.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
                  set('username', cleaned);
                  if (cleaned.length === 0) {
                    setUsernameStatus('idle');
                    setUsernameError('');
                  } else if (cleaned.length < 3) {
                    setUsernameStatus('invalid');
                    setUsernameError('At least 3 characters');
                  } else {
                    // Clear any stale "taken" error while user is typing
                    if (usernameStatus === 'taken' || usernameStatus === 'ok') {
                      setUsernameStatus('idle');
                      setUsernameError('');
                    }
                  }
                }}
                onBlur={() => checkUsernameAvailability(fields.username)}
                placeholder="e.g. alex_style"
                placeholderTextColor={MUTED}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
              />
              {usernameStatus === 'checking' && (
                <ActivityIndicator size="small" color={theme.accent} style={{ marginLeft: 6 }} />
              )}
              {usernameStatus === 'ok' && (
                <Feather name="check-circle" size={17} color={SUCCESS} style={{ marginLeft: 6 }} />
              )}
              {usernameStatus === 'taken' && (
                <Feather name="x-circle" size={17} color={RED} style={{ marginLeft: 6 }} />
              )}
              {usernameStatus === 'invalid' && (
                <Feather name="alert-circle" size={17} color={ORANGE} style={{ marginLeft: 6 }} />
              )}
              {!['checking', 'ok', 'taken', 'invalid'].includes(usernameStatus) && (
                <Feather name="chevron-right" size={17} color={MUTED} />
              )}
            </View>
            {(usernameError || fields.username.length > 0) && (
              <Text style={[
                styles.usernameHint,
                usernameStatus === 'ok'      && { color: SUCCESS },
                usernameStatus === 'taken'   && { color: RED },
                usernameStatus === 'invalid' && { color: ORANGE },
              ]}>
                {usernameError || `@${fields.username.toLowerCase()}`}
              </Text>
            )}
          </View>
          <Divider />
          <EditRow label="Pronouns" value={fields.pronouns} placeholder="e.g. they/them" onChange={v => set('pronouns', v)} />
          <Divider />
          <EditRow label="Bio" value={fields.bio} placeholder="Write a short bio" onChange={v => set('bio', v)} multiline />
          <Divider />
          <EditRow label="Website" value={fields.links} placeholder="Add a link" onChange={v => set('links', v)} />
          <Divider />
          <EditRow label="Location" value={fields.location} placeholder="City, Country" onChange={v => set('location', v)} />
        </View>

        <View style={[styles.card, { marginTop: 12 }]}>
          {/* Gender — inline picker modal */}
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setGenderPickerOpen(true); }}
          >
            <Text style={[styles.rowLabel, { flex: 1 }]}>Gender</Text>
            <Text style={styles.chevronLabel}>{fields.gender || 'Gender'}</Text>
            <Feather name="chevron-right" size={17} color={MUTED} />
          </TouchableOpacity>
          <Divider />
          {/* AI creator toggle */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>AI creator</Text>
              <Text style={styles.rowHint}>Add this label if your content often uses AI.</Text>
            </View>
            <View style={[styles.newPill, { backgroundColor: theme.secondary }]}>
              <Text style={styles.newPillText}>New</Text>
            </View>
            <Switch
              value={fields.aiCreator}
              onValueChange={v => { Haptics.selectionAsync(); setFields(prev => ({ ...prev, aiCreator: v })); }}
              trackColor={{ false: BORDER, true: theme.accent }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Style badge */}
        <Text style={styles.sectionLabel}>Style badge</Text>
        <Text style={styles.sectionHint}>Shown next to your name on your profile.</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Show badge</Text>
            <Switch
              value={badge.enabled}
              onValueChange={v => { Haptics.selectionAsync(); setBadge(b => ({ ...b, enabled: v })); }}
              trackColor={{ false: BORDER, true: theme.accent }}
              thumbColor="#FFFFFF"
            />
          </View>
          <Divider />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Emoji</Text>
            <TextInput
              style={styles.rowInput}
              value={badge.emoji}
              onChangeText={v => setBadge(b => ({ ...b, emoji: v }))}
              placeholder="🎞️"
              placeholderTextColor={MUTED}
              maxLength={4}
            />
          </View>
          <Divider />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Label</Text>
            <TextInput
              style={styles.rowInput}
              value={badge.label}
              onChangeText={v => setBadge(b => ({ ...b, label: v }))}
              placeholder="Archive Fashion"
              placeholderTextColor={MUTED}
              maxLength={24}
              returnKeyType="done"
            />
          </View>
        </View>

        {badge.enabled && (
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <Text style={styles.previewLabel}>Preview</Text>
            <View style={[styles.previewBadge, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
              <Text style={styles.previewEmoji}>{badge.emoji}</Text>
              <Text style={[styles.previewText, { color: theme.accent }]}>{badge.label || 'Your style'}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Gender picker modal */}
      <GenderPicker
        visible={genderPickerOpen}
        current={fields.gender || ''}
        onSelect={v => set('gender', v)}
        onClose={() => setGenderPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 16 },
  headerTitle: { fontSize: 17, fontFamily: FONT.bold, color: FG },
  saveText: { fontSize: 15, fontFamily: FONT.semibold },
  sectionLabel: { fontSize: 13, fontFamily: FONT.semibold, color: MUTED, paddingHorizontal: 20, paddingTop: 16 },
  sectionHint: { fontSize: 12.5, fontFamily: FONT.regular, color: MUTED, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  card: { marginHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', backgroundColor: CARD },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
  rowLabel: { fontSize: 15, fontFamily: FONT.regular, color: FG, width: 90 },
  rowHint: { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginTop: 3 },
  rowInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular, color: FG, padding: 0, textAlign: 'right' },
  chevronLabel: { fontSize: 13.5, fontFamily: FONT.regular, color: MUTED },
  newPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  newPillText: { fontSize: 10.5, fontFamily: FONT.bold, color: '#FFFFFF' },
  avatarSection: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 28, color: '#FFF', fontFamily: FONT.bold },
  avatarOutline: { width: 84, height: 84, borderRadius: 42, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  editPhotoLink: { fontSize: 14, fontFamily: FONT.medium },
  previewLabel: { fontSize: 12, fontFamily: FONT.medium, color: MUTED, marginBottom: 8 },
  previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  previewEmoji: { fontSize: 14 },
  previewText: { fontSize: 12, fontFamily: FONT.semibold },

  // Username availability hint
  usernameHint: {
    fontSize: 11.5,
    fontFamily: FONT.regular,
    color: MUTED,
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 0,
    marginTop: -6,
  },
  // Gender picker
  pickerBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingTop: SP.sm, paddingHorizontal: SP.md },
  pickerHandle: { width: 36, height: 4, backgroundColor: BORDER, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  pickerTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: MUTED, paddingVertical: SP.sm, marginBottom: SP.xs },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: SP.xs, borderRadius: RADIUS.md },
  pickerRowActive: {},
  pickerRowText: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
});
