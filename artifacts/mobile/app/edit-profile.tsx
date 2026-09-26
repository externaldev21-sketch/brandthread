import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Platform, TextInput, Image, Animated, ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { NavigationCard } from '@/components/BrandthreadUI';
import { pickProfileImage } from '@/lib/pickProfileImage';
import { uploadImageWithProgress } from '@/lib/uploadWithProgress';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';
import { SkeletonBlock, SkeletonLine } from '@/components/ui';
import { isSellerDevPreview } from '@/lib/devPreview';
import { Avatar } from '@/components/ui/Avatar';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_RE = /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i;
const BIO_MAX = 300;

type Fields = {
  name: string;
  username: string;
  bio: string;
  website: string;
  category: string;
  tagsText: string;
  location: string;
  contactEmail: string;
  instagram: string;
  tiktok: string;
};

const EMPTY_FIELDS: Fields = {
  name: '', username: '', bio: '', website: '', category: '',
  tagsText: '', location: '', contactEmail: '', instagram: '', tiktok: '',
};

type ImageSlotKey = 'avatar' | 'logo' | 'banner';

// Dev-web preview only (?bt_preview=seller): no signed-in session exists so
// api.seller.getProfile()/updateProfile() and the upload endpoints all 401.
// Seed a local editable profile so the whole screen works end-to-end, and
// simulate the reserved-username / upload round trips below. __DEV__-gated,
// so this is never reachable outside a dev web preview.
const PREVIEW_TAKEN_USERNAMES = new Set(['admin', 'test', 'brandthread', 'shop']);
const PREVIEW_SELLER_FIELDS: Fields = {
  name: 'Preview Studio', username: 'preview_studio', bio: 'Handmade goods, made to order.',
  website: 'https://example.com', category: 'Streetwear', tagsText: 'handmade, small batch',
  location: 'Los Angeles, CA', contactEmail: 'hello@example.com', instagram: '@previewstudio', tiktok: '@previewstudio',
};

/** Quick links into existing seller settings screens — never duplicate those forms here. */
const QUICK_LINKS: { icon: keyof typeof Feather.glyphMap; label: string; description: string; route: string }[] = [
  { icon: 'home', label: 'Store settings', description: 'Storefront identity, localization, checkout', route: '/store-settings' },
  { icon: 'truck', label: 'Shipping & delivery', description: 'Rates, zones, and carriers', route: '/shipping-delivery' },
  { icon: 'dollar-sign', label: 'Payouts', description: 'Bank account and payout history', route: '/payouts' },
  { icon: 'file-text', label: 'Store policies', description: 'Return and cancellation policy', route: '/store-policies' },
];

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const api = useApi();
  const { getToken } = useAuth();
  const { theme } = useAppTheme();
  const preview = __DEV__ && isSellerDevPreview();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [initial, setInitial] = useState<Fields>(EMPTY_FIELDS);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [bannerUri, setBannerUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<ImageSlotKey, boolean>>({ avatar: false, logo: false, banner: false });
  const [uploadProgress, setUploadProgress] = useState<Record<ImageSlotKey, number>>({ avatar: 0, logo: 0, banner: 0 });
  const [uploadError, setUploadError] = useState<Record<ImageSlotKey, string | null>>({ avatar: null, logo: null, banner: null });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});

  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [usernameError, setUsernameError] = useState('');

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
      setToast(t => ({ ...t, visible: false }));
    }, 2500);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const loadProfile = useCallback(() => {
    setProfileError(false);
    if (preview) {
      // No authenticated session to load from — seed a local, fully
      // editable preview profile so every control on this screen works.
      setFields(PREVIEW_SELLER_FIELDS);
      setInitial(PREVIEW_SELLER_FIELDS);
      setProfileLoaded(true);
      return;
    }
    api.seller.getProfile()
      .then((profile) => {
        setAvatarUri(profile.profileImageUrl ?? null);
        setLogoUri(profile.logoUrl ?? null);
        setBannerUri(profile.bannerUrl ?? null);
        const loadedFields: Fields = {
          name: profile.brandName ?? profile.displayName ?? '',
          username: profile.username ?? '',
          bio: profile.bio ?? '',
          website: profile.website ?? '',
          category: profile.category ?? '',
          tagsText: (profile.tags ?? []).join(', '),
          location: profile.location ?? '',
          contactEmail: profile.contactEmail ?? '',
          instagram: profile.socialLinks?.instagram ?? '',
          tiktok: profile.socialLinks?.tiktok ?? '',
        };
        setFields(loadedFields);
        setInitial(loadedFields);
        setProfileLoaded(true);
      })
      .catch(() => setProfileError(true));
  }, [api, preview]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const isDirty = useMemo(
    () => (Object.keys(fields) as (keyof Fields)[]).some(key => fields[key] !== initial[key]),
    [fields, initial],
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty || saving) return;
      e.preventDefault();
      confirmDiscardChanges(() => navigation.dispatch(e.data.action));
    });
    return unsubscribe;
  }, [navigation, isDirty, saving]);

  // Guard the header back button directly too, so the prompt is reliable
  // even in navigation contexts where 'beforeRemove' isn't raised for this
  // particular pop (the listener above stays as extra coverage).
  function handleBackPress() {
    if (isDirty && !saving) { confirmDiscardChanges(() => goBackOr(router)); return; }
    goBackOr(router);
  }

  function set(key: keyof Fields, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  }

  async function checkUsernameAvailability(raw: string): Promise<boolean> {
    const u = raw.trim().toLowerCase();
    if (!u) { setUsernameStatus('invalid'); setUsernameError('Username is required'); return false; }
    if (!USERNAME_RE.test(u)) {
      setUsernameStatus('invalid');
      setUsernameError('Letters, numbers and underscores only (3–30 chars)');
      return false;
    }
    setUsernameStatus('checking');
    if (preview) {
      await new Promise(resolve => setTimeout(resolve, 400));
      if (PREVIEW_TAKEN_USERNAMES.has(u)) {
        setUsernameStatus('taken'); setUsernameError('Username already taken');
        return false;
      }
      setUsernameStatus('ok'); setUsernameError('');
      return true;
    }
    try {
      const result = await api.auth.checkUsername(u);
      if (result.available) { setUsernameStatus('ok'); setUsernameError(''); return true; }
      setUsernameStatus('taken'); setUsernameError(result.error ?? 'Username already taken');
      return false;
    } catch {
      setUsernameStatus('idle'); setUsernameError('');
      return true;
    }
  }

  async function uploadSlot(
    key: ImageSlotKey,
    aspect: [number, number],
    title: string,
    path: string,
    setUri: (uri: string | null) => void,
    responseKey: 'profileImageUrl' | 'logoUrl' | 'bannerUrl',
    setupTaskOnSuccess?: boolean,
  ) {
    const asset = await pickProfileImage({ aspect, title });
    if (!asset) return;
    setUploadError(prev => ({ ...prev, [key]: null }));
    setUploading(prev => ({ ...prev, [key]: true }));
    setUploadProgress(prev => ({ ...prev, [key]: 0 }));
    const previousUri = key === 'avatar' ? avatarUri : key === 'logo' ? logoUri : bannerUri;
    setUri(asset.uri);
    try {
      if (preview) {
        // No upload endpoint to hit in preview mode — simulate progress
        // locally and keep the picked local URI as the "uploaded" result.
        for (const pct of [30, 65, 100]) {
          await new Promise(resolve => setTimeout(resolve, 150));
          setUploadProgress(prev => ({ ...prev, [key]: pct }));
        }
        setUri(asset.uri);
      } else {
        const token = await getToken();
        const result = await uploadImageWithProgress<Record<string, string>>(
          path,
          { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' },
          token,
          (pct) => setUploadProgress(prev => ({ ...prev, [key]: pct })),
        );
        setUri(result[responseKey]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`${title.replace('Update ', '')} updated`);
      if (setupTaskOnSuccess) void completeSetupTaskWhen('customize_store', true);
    } catch {
      setUri(previousUri);
      setUploadError(prev => ({ ...prev, [key]: 'Upload failed. Check your connection and try again.' }));
    } finally {
      setUploading(prev => ({ ...prev, [key]: false }));
    }
  }

  const pickAvatar = () => uploadSlot('avatar', [1, 1], 'Update avatar', '/api/seller/profile/avatar/upload', setAvatarUri, 'profileImageUrl');
  const pickLogo = () => uploadSlot('logo', [1, 1], 'Update logo', '/api/seller/profile/logo/upload', setLogoUri, 'logoUrl', true);
  const pickBanner = () => uploadSlot('banner', [3, 1], 'Update banner', '/api/seller/profile/banner/upload', setBannerUri, 'bannerUrl', true);

  function validate(): boolean {
    const nextErrors: Partial<Record<keyof Fields, string>> = {};
    if (!fields.name.trim()) nextErrors.name = 'Brand name is required';
    if (!fields.username.trim()) nextErrors.username = 'Username is required';
    else if (!USERNAME_RE.test(fields.username.trim())) nextErrors.username = 'Letters, numbers and underscores only (3–30 chars)';
    if (fields.website.trim() && !LINK_RE.test(fields.website.trim())) nextErrors.website = 'Enter a valid website';
    if (fields.contactEmail.trim() && !EMAIL_RE.test(fields.contactEmail.trim())) nextErrors.contactEmail = 'Enter a valid email address';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSave() {
    if (saving || Object.values(uploading).some(Boolean) || !profileLoaded) return;
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
      const tags = fields.tagsText.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
      if (!preview) {
        await api.seller.updateProfile({
          name:        fields.name.trim(),
          brandName:   fields.name.trim(),
          username:    rawUsername,
          bio:         fields.bio.trim(),
          website:     fields.website.trim(),
          category:    fields.category.trim(),
          location:    fields.location.trim(),
          contactEmail: fields.contactEmail.trim(),
          tags,
          socialLinks: {
            instagram: fields.instagram.trim(),
            tiktok:    fields.tiktok.trim(),
          },
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setInitial(fields);
      showToast('Profile updated');
      setTimeout(() => goBackOr(router), 500);
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

  const topPad = insets.top;
  const username = fields.username.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? topPad + 44 : 0}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={handleBackPress}>
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={!isDirty || saving || !profileLoaded} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {saving ? <ActivityIndicator size="small" color={theme.accentLight} /> : (
            <Text style={[styles.saveText, (!isDirty || !profileLoaded) && { opacity: 0.4 }]}>Save</Text>
          )}
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
          <Text style={styles.errorBody}>Check your connection and try again.</Text>
          <Button label="Retry" variant="primary" size="small" style={styles.retryBtn} onPress={loadProfile} />
        </View>
      ) : !profileLoaded ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 20 }}>
          <SkeletonBlock width="100%" height={120} radius={16} />
          <View style={{ alignItems: 'center', gap: 8, marginTop: -40 }}>
            <SkeletonBlock width={80} height={80} radius={40} />
            <SkeletonLine width={140} height={14} />
          </View>
          {[0, 1, 2, 3, 4].map((row) => (
            <View key={row} style={{ gap: 6 }}>
              <SkeletonLine width={90} height={11} />
              <SkeletonBlock width="100%" height={44} radius={12} />
            </View>
          ))}
        </ScrollView>
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}>

        {/* Live storefront header preview */}
        <Text style={styles.sectionLabel}>Storefront preview</Text>
        <View style={styles.previewCard}>
          <View style={styles.previewBannerWrap}>
            {bannerUri ? (
              <Image source={{ uri: bannerUri }} style={styles.previewBanner} />
            ) : (
              <LinearGradient colors={theme.heroGradient as any} style={styles.previewBanner} />
            )}
          </View>
          <View style={styles.previewLogoWrap}>
            {(logoUri ?? avatarUri) ? (
              <Image source={{ uri: (logoUri ?? avatarUri) as string }} style={styles.previewLogo} />
            ) : (
              <LinearGradient colors={theme.primaryGradient as any} style={styles.previewLogo}>
                <Text style={styles.previewLogoText}>{(fields.name || 'B').slice(0, 2).toUpperCase()}</Text>
              </LinearGradient>
            )}
          </View>
          <View style={styles.previewInfo}>
            <Text style={styles.previewName} numberOfLines={1}>{fields.name || 'Your brand name'}</Text>
            <Text style={styles.previewMeta} numberOfLines={1}>
              {[fields.category, fields.location].filter(Boolean).join(' · ') || 'Category · Location'}
            </Text>
          </View>
        </View>

        {/* Banner */}
        <ImageUploadRow
          label="Banner / cover"
          hint="Wide image shown at the top of your storefront"
          uploading={uploading.banner}
          progress={uploadProgress.banner}
          error={uploadError.banner}
          onPress={pickBanner}
          theme={theme}
        >
          <View style={styles.bannerPreviewSlot}>
            {bannerUri ? (
              <Image source={{ uri: bannerUri }} style={styles.bannerPreviewImage} />
            ) : (
              <View style={[styles.bannerPreviewImage, styles.bannerPreviewEmpty]}>
                <Feather name="image" size={20} color={theme.muted} />
              </View>
            )}
          </View>
        </ImageUploadRow>

        {/* Avatar + Logo */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarLogoRow}>
            <View style={styles.avatarColumn}>
              <TouchableOpacity activeOpacity={0.8} onPress={pickAvatar} disabled={uploading.avatar}>
                <View style={styles.avatarWrap}>
                  <Avatar uri={avatarUri} name={fields.name || fields.username} size={84} />
                  {uploading.avatar && (
                    <View style={styles.imageOverlay}>
                      <ActivityIndicator color="#FFF" size="small" />
                      <Text style={styles.imageOverlayText}>{uploadProgress.avatar}%</Text>
                    </View>
                  )}
                  {!uploading.avatar && (
                    <View style={[styles.cameraBadge, { backgroundColor: theme.accent, borderColor: theme.background }]}>
                      <Feather name="camera" size={12} color={theme.onAccent} />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              <Text style={styles.editPhotoLink}>{uploading.avatar ? 'Uploading…' : 'Avatar'}</Text>
              {uploadError.avatar && <RetryLink onPress={pickAvatar} theme={theme} />}
            </View>

            <View style={styles.avatarColumn}>
              <TouchableOpacity activeOpacity={0.8} onPress={pickLogo} disabled={uploading.logo}>
                <View style={styles.avatarWrap}>
                  {logoUri ? (
                    <Image source={{ uri: logoUri }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.logoEmpty]}>
                      <Feather name="award" size={22} color={theme.muted} />
                    </View>
                  )}
                  {uploading.logo && (
                    <View style={styles.imageOverlay}>
                      <ActivityIndicator color="#FFF" size="small" />
                      <Text style={styles.imageOverlayText}>{uploadProgress.logo}%</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              <Text style={styles.editPhotoLink}>{uploading.logo ? 'Uploading…' : 'Logo'}</Text>
              {uploadError.logo && <RetryLink onPress={pickLogo} theme={theme} />}
            </View>
          </View>
        </View>

        {/* Identity */}
        <Text style={styles.sectionLabel}>Identity</Text>
        <View style={[styles.card, { marginBottom: 8 }]}>
          <FieldRow label="Brand name" value={fields.name} onChange={v => set('name', v)} theme={theme} error={errors.name} />
          <Divider theme={theme} />
          <View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Username</Text>
              <TextInput
                style={[
                  styles.rowInput,
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
                placeholder="Username"
                placeholderTextColor={theme.muted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
              />
              {usernameStatus === 'checking' && <ActivityIndicator size="small" color={theme.accent} style={{ marginLeft: 6 }} />}
              {usernameStatus === 'ok' && <Feather name="check-circle" size={17} color={theme.success} style={{ marginLeft: 6 }} />}
              {usernameStatus === 'taken' && <Feather name="x-circle" size={17} color={theme.error} style={{ marginLeft: 6 }} />}
            </View>
            {(usernameError || errors.username) && <Text style={styles.inlineError}>{usernameError || errors.username}</Text>}
          </View>
          <Divider theme={theme} />
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

        {/* Brand bio */}
        <Text style={styles.sectionLabel}>About</Text>
        <View style={[styles.card, { marginBottom: 8 }]}>
          <View style={[styles.row, { alignItems: 'flex-start', paddingVertical: 14 }]}>
            <Text style={styles.rowLabel}>Bio</Text>
            <View style={{ flex: 1 }}>
              <TextInput
                style={[styles.rowInput, { height: 74, textAlignVertical: 'top' }]}
                value={fields.bio}
                onChangeText={v => set('bio', v.slice(0, BIO_MAX))}
                placeholder="Write a short description about your brand"
                placeholderTextColor={theme.muted}
                multiline
                maxLength={BIO_MAX}
              />
              <Text style={[styles.charCounter, fields.bio.length >= BIO_MAX && { color: theme.warning }]}>{fields.bio.length}/{BIO_MAX}</Text>
            </View>
          </View>
          <Divider theme={theme} />
          <FieldRow label="Category" value={fields.category} placeholder="e.g. Streetwear" onChange={v => set('category', v)} theme={theme} />
          <Divider theme={theme} />
          <FieldRow label="Tags" value={fields.tagsText} placeholder="handmade, vintage, sustainable" onChange={v => set('tagsText', v)} theme={theme} />
          <Divider theme={theme} />
          <FieldRow label="Location" value={fields.location} placeholder="City, Country" onChange={v => set('location', v)} theme={theme} />
        </View>

        {/* Contact & links */}
        <Text style={styles.sectionLabel}>Contact & links</Text>
        <View style={[styles.card, { marginBottom: 8 }]}>
          <FieldRow label="Website" value={fields.website} placeholder="Add website" onChange={v => set('website', v)} theme={theme} error={errors.website} keyboardType="url" />
          <Divider theme={theme} />
          <FieldRow label="Contact email" value={fields.contactEmail} placeholder="hello@yourbrand.com" onChange={v => set('contactEmail', v)} theme={theme} error={errors.contactEmail} keyboardType="email-address" />
          <Divider theme={theme} />
          <FieldRow label="Instagram" value={fields.instagram} placeholder="@yourbrand" onChange={v => set('instagram', v)} theme={theme} />
          <Divider theme={theme} />
          <FieldRow label="TikTok" value={fields.tiktok} placeholder="@yourbrand" onChange={v => set('tiktok', v)} theme={theme} />
        </View>

        {/* Quick links to existing seller settings — never duplicated here */}
        <Text style={styles.sectionLabel}>Store settings</Text>
        <View style={{ gap: 8, paddingHorizontal: 14 }}>
          {QUICK_LINKS.map(link => (
            <NavigationCard
              key={link.route}
              icon={link.icon}
              label={link.label}
              description={link.description}
              onPress={() => router.push(link.route as any)}
            />
          ))}
        </View>
      </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

// react-native-web's Alert.alert() is a no-op (RN's Alert has no web
// implementation upstream), so the native Alert.alert below never shows
// anything in a browser — the unsaved-changes prompt would silently vanish
// on web only. Use the browser's own confirm() there; every other platform
// keeps the native two-button alert.
function confirmDiscardChanges(onDiscard: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm('Discard changes? You have unsaved changes. If you leave now, they will be lost.')) {
      onDiscard();
    }
    return;
  }
  Alert.alert(
    'Discard changes?',
    'You have unsaved changes. If you leave now, they will be lost.',
    [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onDiscard },
    ],
  );
}

function Divider({ theme }: { theme: AppThemePreset }) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 16 }} />;
}

function RetryLink({ onPress, theme }: { onPress: () => void; theme: AppThemePreset }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: theme.error, marginTop: 2 }}>Retry</Text>
    </TouchableOpacity>
  );
}

function FieldRow({
  label, value, placeholder, onChange, theme, error, keyboardType,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  theme: AppThemePreset;
  error?: string;
  keyboardType?: 'default' | 'email-address' | 'url';
}) {
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <TextInput
          style={[styles.rowInput, error && { color: theme.error }]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? label}
          placeholderTextColor={theme.muted}
          returnKeyType="done"
          autoCorrect={false}
          autoCapitalize={keyboardType === 'email-address' || keyboardType === 'url' ? 'none' : 'sentences'}
          keyboardType={keyboardType}
        />
      </View>
      {error && <Text style={styles.inlineError}>{error}</Text>}
    </View>
  );
}

function ImageUploadRow({
  label, hint, uploading, progress, error, onPress, theme, children,
}: {
  label: string;
  hint: string;
  uploading: boolean;
  progress: number;
  error: string | null;
  onPress: () => void;
  theme: AppThemePreset;
  children: React.ReactNode;
}) {
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.card, { marginBottom: 8 }]}>
      <TouchableOpacity style={[styles.row, { paddingVertical: 14 }]} activeOpacity={0.8} onPress={onPress} disabled={uploading}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { width: undefined, color: theme.text, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
          <Text style={styles.rowHint}>{uploading ? `Uploading… ${progress}%` : hint}</Text>
          {error && <Text style={styles.inlineErrorNoIndent}>{error} · Tap to retry</Text>}
        </View>
        {children}
      </TouchableOpacity>
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
  retryBtn:   { marginTop: 12 },

  sectionLabel: {
    fontSize: 13, fontFamily: 'Inter_500Medium', color: theme.muted,
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8,
  },

  // Storefront header preview
  previewCard: {
    marginHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.card, overflow: 'hidden', paddingBottom: 14,
  },
  previewBannerWrap: { width: '100%', height: 88 },
  previewBanner: { width: '100%', height: '100%' },
  previewLogoWrap: {
    marginTop: -28, marginLeft: 14, width: 56, height: 56, borderRadius: 16,
    borderWidth: 3, borderColor: theme.card, overflow: 'hidden',
  },
  previewLogo: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  previewLogoText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: theme.onAccent },
  previewInfo: { paddingHorizontal: 14, paddingTop: 8, gap: 2 },
  previewName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: theme.text },
  previewMeta: { fontSize: 12.5, fontFamily: 'Inter_400Regular', color: theme.muted },

  bannerPreviewSlot: { marginLeft: 8 },
  bannerPreviewImage: { width: 64, height: 40, borderRadius: 8 },
  bannerPreviewEmpty: { backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' },

  avatarSection: { paddingVertical: 8 },
  avatarLogoRow: { flexDirection: 'row', justifyContent: 'center', gap: 36 },
  avatarColumn: { alignItems: 'center', gap: 6 },
  avatarWrap: { width: 84, height: 84, borderRadius: 42, position: 'relative' },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  logoEmpty: { backgroundColor: theme.surface },
  cameraBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2.5,
  },
  imageOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 42,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 2, // theme-exempt: scrim over avatar media
  },
  imageOverlayText: { color: '#FFF', fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  editPhotoLink: { fontSize: 12.5, fontFamily: 'Inter_500Medium', color: theme.accentLight },

  card: {
    backgroundColor: theme.card, marginHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border, overflow: 'hidden',
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  rowLabel: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: theme.text, width: 100,
  },
  rowHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: theme.muted, marginTop: 2 },
  rowValue: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: theme.muted,
  },
  rowInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: theme.text,
    padding: 0, textAlign: 'right',
  },
  charCounter: { fontSize: 11, fontFamily: 'Inter_400Regular', color: theme.muted, textAlign: 'right', marginTop: 4 },
  inlineError: { fontSize: 11.5, fontFamily: 'Inter_400Regular', color: theme.error, paddingHorizontal: 16, paddingBottom: 10, marginTop: -6 },
  inlineErrorNoIndent: { fontSize: 11, fontFamily: 'Inter_400Regular', color: theme.error, marginTop: 2 },
});
