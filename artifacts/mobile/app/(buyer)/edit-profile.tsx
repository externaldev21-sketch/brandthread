import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput, Modal, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Animated,
} from 'react-native';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from 'expo-router';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { loadStyleBadge, saveStyleBadge, DEFAULT_STYLE_BADGE, type StyleBadgeState } from '@/lib/styleBadge';
import { loadBuyerProfile, saveBuyerProfile, DEFAULT_BUYER_PROFILE, type BuyerProfileFields } from '@/lib/buyerProfile';
import { updateMyProfile, getMyProfile } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { pickProfileImage } from '@/lib/pickProfileImage';
import { uploadImageWithProgress } from '@/lib/uploadWithProgress';
import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';

const GENDER_OPTIONS = ['Woman', 'Man', 'Non-binary', 'Prefer not to say', 'Custom'] as const;
const BIO_MAX = 150;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const LINK_RE = /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i;

type CoreFields = { name: string; username: string; bio: string; link: string };

function Divider({ theme }: { theme: AppThemePreset }) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 16 }} />;
}

function GenderPicker({
  visible, current, onSelect, onClose, theme,
}: {
  visible: boolean;
  current: string;
  onSelect: (v: string) => void;
  onClose: () => void;
  theme: AppThemePreset;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.pickerSheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.pickerHandle, { backgroundColor: theme.border }]} />
          <Text style={[styles.pickerTitle, { color: theme.muted }]}>Gender</Text>
          {GENDER_OPTIONS.map(option => (
            <TouchableOpacity
              key={option}
              style={[styles.pickerRow, current === option && { backgroundColor: theme.accentDim }]}
              onPress={() => { onSelect(option); onClose(); }}
            >
              <Text style={[styles.pickerRowText, { color: theme.text }, current === option && { color: theme.accent }]}>{option}</Text>
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
  const barInset = useBuyerTabBarInset();
  const router = useRouter();
  const navigation = useNavigation();
  const { theme } = useAppTheme();
  const api = useApi();
  const { getToken } = useAuth();

  const [badge, setBadge] = useState<StyleBadgeState>({ ...DEFAULT_STYLE_BADGE, enabled: true });
  const [extra, setExtra] = useState<Pick<BuyerProfileFields, 'pronouns' | 'gender' | 'aiCreator'>>({
    pronouns: '', gender: '', aiCreator: false,
  });
  const [fields, setFields] = useState<CoreFields>({ name: '', username: '', bio: '', link: '' });
  const [initial, setInitial] = useState<CoreFields>({ name: '', username: '', bio: '', link: '' });
  // Fields this screen doesn't edit (phone, location) but must round-trip unchanged on save.
  const [loadedProfile, setLoadedProfile] = useState<BuyerProfileFields>({ ...DEFAULT_BUYER_PROFILE });
  const [loaded, setLoaded] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [genderPickerOpen, setGenderPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof CoreFields, string>>>({});

  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [usernameError, setUsernameError] = useState('');

  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, visible: true });
    Animated.timing(toastOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      setToast(t => ({ ...t, visible: false }));
    }, 2200);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  async function checkUsernameAvailability(raw: string): Promise<boolean> {
    const u = raw.trim().toLowerCase();
    if (!u) { setUsernameStatus('invalid'); setUsernameError('Username is required'); return false; }
    if (!USERNAME_RE.test(u)) {
      setUsernameStatus('invalid');
      setUsernameError('Letters, numbers and underscores only (3–30 chars)');
      return false;
    }
    setUsernameStatus('checking');
    try {
      const result = await api.auth.checkUsername(u);
      if (result.available) {
        setUsernameStatus('ok');
        setUsernameError('');
        return true;
      }
      setUsernameStatus('taken');
      setUsernameError(result.error ?? 'Username already taken');
      return false;
    } catch {
      setUsernameStatus('idle');
      setUsernameError('');
      return true; // don't block save on a network hiccup — server re-validates
    }
  }

  function set(key: keyof CoreFields, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  }

  async function pickAvatar() {
    const asset = await pickProfileImage({ aspect: [1, 1], title: 'Update profile photo' });
    if (!asset) return;
    setAvatarError(null);
    setAvatarUploading(true);
    setAvatarProgress(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const previousUri = avatarUri;
    setAvatarUri(asset.uri); // optimistic local preview while it uploads
    try {
      const token = await getToken();
      const result = await uploadImageWithProgress<{ profileImageUrl: string }>(
        '/api/seller/profile/avatar/upload',
        { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' },
        token,
        setAvatarProgress,
      );
      setAvatarUri(result.profileImageUrl);
      setLoadedProfile(prev => ({ ...prev, avatarUri: result.profileImageUrl }));
      await saveBuyerProfile({ ...loadedProfile, avatarUri: result.profileImageUrl });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('Photo updated');
    } catch {
      setAvatarUri(previousUri);
      setAvatarError('Could not upload photo. Check your connection and try again.');
    } finally {
      setAvatarUploading(false);
    }
  }

  const loadProfile = useCallback(() => {
    Promise.all([loadStyleBadge(), loadBuyerProfile(), getMyProfile()])
      .then(([badgeState, profileState, socialProfile]) => {
        setBadge(badgeState);
        const merged: CoreFields = {
          name: profileState.name || socialProfile.name,
          username: profileState.username || socialProfile.username || DEFAULT_BUYER_PROFILE.username,
          bio: (profileState.bio && profileState.bio !== DEFAULT_BUYER_PROFILE.bio ? profileState.bio : socialProfile.bio) || '',
          link: profileState.links || socialProfile.website || '',
        };
        setExtra({
          pronouns: profileState.pronouns || socialProfile.pronouns || '',
          gender: profileState.gender || '',
          aiCreator: profileState.aiCreator,
        });
        setFields(merged);
        setInitial(merged);
        setLoadedProfile(profileState);
        if (profileState.avatarUri) setAvatarUri(profileState.avatarUri);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const isDirty = useMemo(
    () => fields.name !== initial.name || fields.username !== initial.username
      || fields.bio !== initial.bio || fields.link !== initial.link,
    [fields, initial],
  );

  // Warn on back navigation (header button, swipe, or hardware back) if there are unsaved text-field edits.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty || saving) return;
      e.preventDefault();
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. If you leave now, they will be lost.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, saving]);

  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  function validate(): boolean {
    const nextErrors: Partial<Record<keyof CoreFields, string>> = {};
    if (!fields.name.trim()) nextErrors.name = 'Name is required';
    if (!fields.username.trim()) nextErrors.username = 'Username is required';
    else if (!USERNAME_RE.test(fields.username.trim())) nextErrors.username = 'Letters, numbers and underscores only (3–30 chars)';
    if (fields.link.trim() && !LINK_RE.test(fields.link.trim())) nextErrors.link = 'Enter a valid link';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSave() {
    if (saving || avatarUploading) return;
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const rawUsername = fields.username.trim().toLowerCase();
    if (rawUsername !== initial.username.trim().toLowerCase()) {
      const available = await checkUsernameAvailability(rawUsername);
      if (!available) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
    }

    setSaving(true);
    try {
      const cleanedBadge: StyleBadgeState = {
        label: badge.label.trim() || DEFAULT_STYLE_BADGE.label,
        emoji: badge.emoji.trim() || DEFAULT_STYLE_BADGE.emoji,
        enabled: badge.enabled,
      };
      const cleanedFields: BuyerProfileFields = {
        ...loadedProfile,
        name: fields.name.trim(),
        username: rawUsername,
        bio: fields.bio.trim(),
        links: fields.link.trim(),
        pronouns: extra.pronouns,
        gender: extra.gender,
        aiCreator: extra.aiCreator,
        avatarUri: avatarUri || '',
      };
      const nameParts = cleanedFields.name.trim().split(' ').filter(Boolean);
      const initials = nameParts.length >= 2
        ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
        : (nameParts[0] ?? '').slice(0, 2).toUpperCase();

      await Promise.all([
        saveStyleBadge(cleanedBadge),
        saveBuyerProfile(cleanedFields),
        updateMyProfile({
          name: cleanedFields.name,
          username: cleanedFields.username,
          pronouns: cleanedFields.pronouns,
          bio: cleanedFields.bio,
          website: cleanedFields.links,
          avatarInitials: initials,
        }),
        api.auth.updateProfile({
          username: rawUsername || undefined,
          displayName: cleanedFields.name,
          name: cleanedFields.name,
          bio: cleanedFields.bio,
          website: cleanedFields.links,
        }),
      ]);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setInitial(fields);
      setLoadedProfile(cleanedFields);
      showToast('Profile updated');
      setTimeout(() => router.back(), 500);
    } catch {
      Alert.alert('Could not save', 'Something went wrong saving your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 10 }]}>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => router.back()}>
            <Feather name="chevron-left" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>Edit profile</Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={!isDirty || saving || avatarUploading}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <Text style={[styles.saveText, { color: theme.accent }, (!isDirty || avatarUploading) && { opacity: 0.35 }]}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity, backgroundColor: theme.success }]}>
          <Feather name="check-circle" size={14} color={theme.onAccent} />
          <Text style={[styles.toastText, { color: theme.onAccent }]}>{toast.message}</Text>
        </Animated.View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: barInset + SP.lg }}>
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <TouchableOpacity activeOpacity={0.8} onPress={pickAvatar} disabled={avatarUploading}>
              <View style={styles.avatarWrap}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatar} />
                ) : (
                  <LinearGradient colors={[...theme.primaryGradient]} style={styles.avatar}>
                    <Text style={[styles.avatarText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      {fields.name ? fields.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '🙂'}
                    </Text>
                  </LinearGradient>
                )}
                {avatarUploading && (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator color="#FFF" size="small" />
                    <Text style={styles.avatarOverlayText}>{avatarProgress}%</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7} onPress={pickAvatar} disabled={avatarUploading}>
              <Text style={[styles.editPhotoLink, { color: theme.accentLight }]}>
                {avatarUploading ? `Uploading… ${avatarProgress}%` : 'Change profile photo'}
              </Text>
            </TouchableOpacity>
            {avatarError && (
              <View style={styles.retryRow}>
                <Text style={[styles.errorText, { color: theme.error }]}>{avatarError}</Text>
                <TouchableOpacity onPress={pickAvatar}>
                  <Text style={[styles.retryLink, { color: theme.accentLight }]}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Core fields */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>Name</Text>
                <TextInput
                  style={[styles.rowInput, { color: theme.text }]}
                  value={fields.name}
                  onChangeText={v => set('name', v)}
                  placeholder="Your name"
                  placeholderTextColor={theme.muted}
                  autoCorrect={false}
                  returnKeyType="done"
                  maxLength={50}
                />
              </View>
              {errors.name && <Text style={[styles.inlineError, { color: theme.error }]}>{errors.name}</Text>}
            </View>
            <Divider theme={theme} />

            {/* Username — format validated live, availability checked on blur */}
            <View>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>Username</Text>
                <TextInput
                  style={[
                    styles.rowInput,
                    { color: theme.text },
                    usernameStatus === 'taken' && { color: theme.error },
                    usernameStatus === 'invalid' && { color: theme.warning },
                  ]}
                  value={fields.username}
                  onChangeText={v => {
                    const cleaned = v.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
                    set('username', cleaned);
                    if (cleaned.length === 0) { setUsernameStatus('idle'); setUsernameError(''); }
                    else if (cleaned.length < 3) { setUsernameStatus('invalid'); setUsernameError('At least 3 characters'); }
                    else if (usernameStatus === 'taken' || usernameStatus === 'ok') { setUsernameStatus('idle'); setUsernameError(''); }
                  }}
                  onBlur={() => { if (fields.username.trim()) void checkUsernameAvailability(fields.username); }}
                  placeholder="e.g. alex_style"
                  placeholderTextColor={theme.muted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                />
                {usernameStatus === 'checking' && <ActivityIndicator size="small" color={theme.accent} style={{ marginLeft: 6 }} />}
                {usernameStatus === 'ok' && <Feather name="check-circle" size={17} color={theme.success} style={{ marginLeft: 6 }} />}
                {usernameStatus === 'taken' && <Feather name="x-circle" size={17} color={theme.error} style={{ marginLeft: 6 }} />}
                {usernameStatus === 'invalid' && <Feather name="alert-circle" size={17} color={theme.warning} style={{ marginLeft: 6 }} />}
              </View>
              {(usernameError || errors.username || fields.username.length > 0) && (
                <Text style={[
                  styles.usernameHint,
                  { color: theme.muted },
                  (usernameStatus === 'taken' || errors.username) && { color: theme.error },
                  usernameStatus === 'ok' && { color: theme.success },
                  usernameStatus === 'invalid' && { color: theme.warning },
                ]}>
                  {errors.username || usernameError || `@${fields.username.toLowerCase()}`}
                </Text>
              )}
            </View>
            <Divider theme={theme} />

            {/* Bio with character counter */}
            <View style={[styles.row, { alignItems: 'flex-start', paddingTop: 13 }]}>
              <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>Bio</Text>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[styles.rowInput, { color: theme.text, textAlignVertical: 'top', minHeight: 60 }]}
                  value={fields.bio}
                  onChangeText={v => set('bio', v.slice(0, BIO_MAX))}
                  placeholder="Write a short bio"
                  placeholderTextColor={theme.muted}
                  multiline
                  maxLength={BIO_MAX}
                />
                <Text style={[styles.charCounter, { color: fields.bio.length >= BIO_MAX ? theme.warning : theme.muted }]}>
                  {fields.bio.length}/{BIO_MAX}
                </Text>
              </View>
            </View>
            <Divider theme={theme} />

            <View>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>Link</Text>
                <TextInput
                  style={[styles.rowInput, { color: theme.text }, errors.link && { color: theme.error }]}
                  value={fields.link}
                  onChangeText={v => set('link', v)}
                  placeholder="Add a link (optional)"
                  placeholderTextColor={theme.muted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  keyboardType="url"
                  returnKeyType="done"
                />
              </View>
              {errors.link && <Text style={[styles.inlineError, { color: theme.error }]}>{errors.link}</Text>}
            </View>
          </View>

          {/* More — kept out of the primary Instagram-style flow, but still reachable */}
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>More</Text>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setGenderPickerOpen(true); }}
            >
              <Text style={[styles.rowLabel, { color: theme.text, flex: 1 }]} numberOfLines={1}>Gender</Text>
              <Text style={[styles.chevronLabel, { color: theme.muted }]}>{extra.gender || 'Add'}</Text>
              <Feather name="chevron-right" size={17} color={theme.muted} />
            </TouchableOpacity>
            <Divider theme={theme} />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>AI creator</Text>
                <Text style={[styles.rowHint, { color: theme.muted }]}>Add this label if your content often uses AI.</Text>
              </View>
              <HapticSwitch
                value={extra.aiCreator}
                onValueChange={v => setExtra(prev => ({ ...prev, aiCreator: v }))}
                trackColor={{ false: theme.border, true: theme.accent }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>

          {/* Style badge */}
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>Style badge</Text>
          <Text style={[styles.sectionHint, { color: theme.muted }]}>Shown next to your name on your profile.</Text>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: theme.text, flex: 1 }]} numberOfLines={1}>Show badge</Text>
              <HapticSwitch
                value={badge.enabled}
                onValueChange={v => setBadge(b => ({ ...b, enabled: v }))}
                trackColor={{ false: theme.border, true: theme.accent }}
                thumbColor="#FFFFFF"
              />
            </View>
            <Divider theme={theme} />
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>Emoji</Text>
              <TextInput
                style={[styles.rowInput, { color: theme.text }]}
                value={badge.emoji}
                onChangeText={v => setBadge(b => ({ ...b, emoji: v }))}
                placeholder="🎞️"
                placeholderTextColor={theme.muted}
                maxLength={4}
              />
            </View>
            <Divider theme={theme} />
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>Label</Text>
              <TextInput
                style={[styles.rowInput, { color: theme.text }]}
                value={badge.label}
                onChangeText={v => setBadge(b => ({ ...b, label: v }))}
                placeholder="Archive Fashion"
                placeholderTextColor={theme.muted}
                maxLength={24}
                returnKeyType="done"
              />
            </View>
          </View>

          {badge.enabled && (
            <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
              <Text style={[styles.previewLabel, { color: theme.muted }]}>Preview</Text>
              <View style={[styles.previewBadge, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
                <Text style={styles.previewEmoji}>{badge.emoji}</Text>
                <Text style={[styles.previewText, { color: theme.accent }]}>{badge.label || 'Your style'}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        <GenderPicker
          visible={genderPickerOpen}
          current={extra.gender}
          onSelect={v => setExtra(prev => ({ ...prev, gender: v }))}
          onClose={() => setGenderPickerOpen(false)}
          theme={theme}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 16 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  saveText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 20, paddingTop: 16 },
  sectionHint: { fontSize: 12.5, fontFamily: 'Inter_400Regular', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  card: { marginHorizontal: 14, marginTop: 8, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_400Regular', width: 90 },
  rowHint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3 },
  rowInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', padding: 0, textAlign: 'right' },
  chevronLabel: { fontSize: 13.5, fontFamily: 'Inter_400Regular' },
  avatarSection: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  avatarWrap: { width: 96, height: 96, borderRadius: 48 },
  avatar: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontFamily: 'Inter_700Bold' },
  avatarOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 48,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 4, // theme-exempt: scrim over avatar media
  },
  avatarOverlayText: { color: '#FFF', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  editPhotoLink: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  errorText: { fontSize: 12.5, fontFamily: 'Inter_400Regular' },
  retryLink: { fontSize: 12.5, fontFamily: 'Inter_600SemiBold' },
  inlineError: { fontSize: 11.5, fontFamily: 'Inter_400Regular', paddingHorizontal: 16, paddingBottom: 10, marginTop: -6 },
  charCounter: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'right', marginTop: 4 },
  previewLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 8 },
  previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  previewEmoji: { fontSize: 14 },
  previewText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  usernameHint: { fontSize: 11.5, fontFamily: 'Inter_400Regular', paddingHorizontal: 16, paddingBottom: 10, paddingTop: 0, marginTop: -6 },
  toast: {
    position: 'absolute', top: 56, alignSelf: 'center', zIndex: 99,
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  toastText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 16 },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  pickerTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, paddingVertical: 8, marginBottom: 4 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 4, borderRadius: 14 },
  pickerRowText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
});
