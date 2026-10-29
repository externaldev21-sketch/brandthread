/**
 * My Store → Edit profile: the top of the store (Stan Store's profile card) —
 * photo, name, short bio and social icons. Same header as the rest of the app.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ListRow } from '@/components/ui/ListRow';
import { ErrorState } from '@/components/ui/ErrorState';
import { ShareStoreToast, useToast } from '@/components/store/ShareStoreSheet';
import { StoreSheet } from '@/components/store/StoreSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useStoreSite } from '@/hooks/useStoreSite';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { pickFromLibrary } from '@/lib/pickProfileImage';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { FILL_ELEVATED, FONT } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { saveBio } from '@/services/growthService';

const BIO_MAX = 160;

export const SOCIALS = [
  { key: 'instagram', label: 'Instagram', placeholder: '@handle' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@handle' },
  { key: 'youtube', label: 'YouTube', placeholder: 'youtube.com/@channel' },
  { key: 'x', label: 'X', placeholder: '@handle' },
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/page' },
  { key: 'website', label: 'Website', placeholder: 'yourbrand.com' },
  { key: 'email', label: 'Email', placeholder: 'hello@yourbrand.com' },
] as const;
type SocialKey = (typeof SOCIALS)[number]['key'];

/** "https://www.instagram.com/acme" → "@acme"; "mailto:a@b.co" → "a@b.co". */
export function socialDisplay(key: string, value: string | undefined): string {
  if (!value) return '';
  if (key === 'email') return value.replace(/^mailto:/i, '');
  if (key === 'website') return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const last = value.replace(/\/+$/, '').split('/').pop() ?? value;
  return last.startsWith('@') ? last : `@${last}`;
}

export default function StoreProfileScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  useHideTabBar();
  const insets = useSafeAreaInsets();
  const bottomInset = useScreenBottomInset();
  const { page, failed, reload } = useStoreSite();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; mimeType: string | null } | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SocialKey | null>(null);
  const [value, setValue] = useState('');
  const [toast, flash] = useToast();

  useEffect(() => {
    if (!page || seeded) return;
    setName(page.displayName ?? '');
    setBio(page.bio ?? '');
    setSeeded(true);
  }, [page, seeded]);

  const pick = useCallback(async () => {
    const asset = await pickFromLibrary([1, 1]);
    if (asset) setPhoto({ uri: asset.uri, mimeType: asset.mimeType ?? null });
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The signed-out web preview never uploads; growthService keeps it in memory.
      if (photo && !isSellerDevPreview()) await api.seller.uploadLogo(photo);
      await saveBio({ displayName: name.trim(), bio: bio.trim() });
      router.back();
    } catch {
      flash("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }, [api, bio, busy, flash, name, photo, router]);

  const saveSocial = useCallback(async () => {
    if (!editing || !page) return;
    try {
      await saveBio({ socials: { ...(page.socials ?? {}), [editing]: value.trim() } });
      setEditing(null);
      await reload();
    } catch (e) {
      flash(e instanceof Error && e.message ? e.message.slice(0, 120) : "Couldn't save. Try again.");
    }
  }, [editing, flash, page, reload, value]);

  const header = <ScreenHeader title="Profile" backAccessibilityLabel="Back" />;
  if (failed && !page) return <View style={[s.root, { backgroundColor: theme.background }]}>{header}<ErrorState onRetry={reload} /></View>;

  const shown = photo?.uri ?? page?.logoUrl ?? page?.avatarUrl ?? null;
  const social = SOCIALS.find((f) => f.key === editing);

  return (
    <KeyboardAvoidingView style={[s.root, { backgroundColor: theme.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.root} testID="store-profile-screen">
        {header}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.body, { paddingBottom: 96 + bottomInset }]} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => { void pick(); }} style={s.photoWrap} accessibilityRole="button" accessibilityLabel="Change photo" testID="store-profile-photo">
            {shown
              ? <Image source={{ uri: shown }} style={[s.photo, { backgroundColor: FILL_ELEVATED }]} />
              : <View style={[s.photo, s.center, { backgroundColor: FILL_ELEVATED }]}><Icon name="camera" size={26} color={theme.muted} /></View>}
            <Text style={[s.photoLabel, { color: theme.text }]}>{shown ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>
          <Input label="Name" value={name} onChangeText={setName} maxLength={60} testID="store-profile-name" />
          <Input label="Bio" value={bio} onChangeText={setBio} maxLength={BIO_MAX} multiline testID="store-profile-bio" />
          <Text style={[s.section, { color: theme.text }]}>Socials</Text>
          <View>
            {SOCIALS.map((f, i) => (
              <ListRow
                key={f.key}
                title={f.label}
                value={socialDisplay(f.key, page?.socials?.[f.key]) || 'Add'}
                chevron
                divider={i < SOCIALS.length - 1}
                onPress={() => { setValue(socialDisplay(f.key, page?.socials?.[f.key])); setEditing(f.key); }}
                testID={`store-profile-social-${f.key}`}
              />
            ))}
          </View>
        </ScrollView>
        <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: theme.background }]}>
          <Button label="Save" onPress={() => { void save(); }} loading={busy} fullWidth testID="store-profile-save" />
        </View>
        <StoreSheet visible={!!editing} title={social?.label ?? ''} onClose={() => setEditing(null)} testID="store-profile-social-sheet">
          <View style={s.sheetBody}>
            <Input
              label={social?.placeholder ?? ''}
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={editing === 'email' ? 'email-address' : 'url'}
              // Inputs sit on the #1C1C1E sheet, the same fill as the field: a hairline outline keeps them visible.
              style={[s.field, { borderColor: theme.border }]}
              testID="store-profile-social-value"
            />
            <Button label="Save" onPress={() => { void saveSocial(); }} fullWidth testID="store-profile-social-save" />
          </View>
        </StoreSheet>
        <ShareStoreToast message={toast} top={insets.top + 8} />
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  photoWrap: { alignItems: 'center', gap: 10, marginBottom: 8 },
  photo: { width: 96, height: 96, borderRadius: 48 },
  photoLabel: { fontSize: 15, fontFamily: FONT.semibold },
  section: { fontSize: 17, fontFamily: FONT.semibold, marginTop: 12 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12 },
  sheetBody: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
});
