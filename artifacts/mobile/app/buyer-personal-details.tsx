import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { loadBuyerProfile, saveBuyerProfile, DEFAULT_BUYER_PROFILE, type BuyerProfileFields } from '@/lib/buyerProfile';
import { updateMyProfile, getMyProfile } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { isBuyerDevPreview } from '@/lib/devPreview';
import {
  PRONOUNS_MAX, isValidUsername, normalizeUsername, personalDetailsPatch, profileSaveErrorMessage,
  type PersonalDetailsInput, type ProfileSaveError,
} from '@/lib/profileExtras';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow, StickyBottomCTA } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { FONT } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';

type EditableKey = keyof PersonalDetailsInput;

type FieldDef = {
  key: EditableKey | 'email' | 'phone' | 'birthday';
  label: string;
  placeholder: string;
  icon: keyof typeof Feather.glyphMap;
  editable?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'words';
};

// Name, username and pronouns save to the account (PATCH /api/auth/profile).
// Email and phone are Clerk-verified and change through their own screens;
// birthday is only used at sign-up for the age check and is never stored.
const FIELDS: FieldDef[] = [
  { key: 'name',     label: 'Name',      placeholder: 'Your name',        icon: 'user',    autoCapitalize: 'words' },
  { key: 'username', label: 'Username',  placeholder: 'username',         icon: 'at-sign', autoCapitalize: 'none', maxLength: 30 },
  { key: 'email',    label: 'Email',     placeholder: 'Not added',        icon: 'mail',     editable: false },
  { key: 'phone',    label: 'Phone',     placeholder: 'Not added',        icon: 'phone',    editable: false },
  { key: 'birthday', label: 'Birthday',  placeholder: 'Not set',          icon: 'calendar', editable: false },
  { key: 'pronouns', label: 'Pronouns',  placeholder: 'e.g. they/them',   icon: 'smile',   autoCapitalize: 'none', maxLength: PRONOUNS_MAX },
];

/** Masks a real email address, e.g. "jordan@example.com" -> "••••@example.com". */
function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '';
  const [, domain] = email.split('@');
  return `••••@${domain}`;
}

const EMPTY: PersonalDetailsInput = { name: '', username: '', pronouns: '' };

export default function BuyerPersonalDetails() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = makeStyles(palette, theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  // Dev-web preview has no signed-in account: keep the old local-only save there.
  const preview = __DEV__ && isBuyerDevPreview();
  const [local, setLocal] = useState<BuyerProfileFields>({ ...DEFAULT_BUYER_PROFILE });
  const [fields, setFields] = useState<PersonalDetailsInput>(EMPTY);
  const [saved, setSaved] = useState<PersonalDetailsInput>(EMPTY);
  const [ageVerified, setAgeVerified] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ProfileSaveError | null>(null);

  useEffect(() => {
    // The server account is authoritative (it is what /u/<username> and the
    // QR code resolve); local values are only a fallback when it can't be reached.
    Promise.all([
      loadBuyerProfile(),
      getMyProfile(),
      preview ? Promise.resolve(null) : api.auth.me().catch(() => null),
    ]).then(([localProfile, social, me]) => {
      const initial: PersonalDetailsInput = me
        ? { name: me.displayName || me.name || '', username: me.username || '', pronouns: me.pronouns || '' }
        : {
            name: localProfile.name || social.name,
            username: localProfile.username || social.username || '',
            pronouns: localProfile.pronouns || social.pronouns || '',
          };
      setLocal(localProfile);
      setFields(initial);
      setSaved(me ? initial : EMPTY);
      setAgeVerified(!!me?.ageBand);
      setLoaded(true);
    });
  }, [api, preview]);

  function set(key: EditableKey, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
    setHasChanges(true);
    setError(null);
  }

  function getValue(key: FieldDef['key']): string {
    if (key === 'email') return maskEmail(user?.primaryEmailAddress?.emailAddress);
    if (key === 'phone') return user?.primaryPhoneNumber?.phoneNumber ?? '';
    if (key === 'birthday') return ageVerified ? 'Verified at sign-up' : '';
    return fields[key];
  }

  async function handleSave() {
    if (saving) return;
    if (!fields.name.trim()) { haptic('error'); setError({ field: null, message: 'Name is required.' }); return; }
    if (!isValidUsername(fields.username)) {
      haptic('error');
      setError({ field: 'username', message: 'Letters, numbers and underscores only (3–30 characters).' });
      return;
    }
    const patch = personalDetailsPatch(fields, saved);
    setSaving(true);
    setError(null);
    try {
      let next: PersonalDetailsInput = {
        name: fields.name.trim(),
        username: normalizeUsername(fields.username),
        pronouns: fields.pronouns.trim(),
      };
      if (!preview && Object.keys(patch).length > 0) {
        const updated = await api.auth.updateProfile(patch);
        next = {
          name: updated?.displayName || updated?.name || next.name,
          username: updated?.username || next.username,
          pronouns: updated?.pronouns ?? '',
        };
      }
      // Mirror the saved account values locally so other screens agree.
      await Promise.all([
        saveBuyerProfile({ ...local, ...next }),
        updateMyProfile(next),
      ]);
      haptic('save');
      setSaved(next);
      setHasChanges(false);
      goBackOr(router);
    } catch (err) {
      haptic('error');
      setError(profileSaveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;

  return (
    <View style={s.page}>
      <ScreenHeader title="Personal Details" />

      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + (hasChanges ? 120 : 40) }}>
        <Text style={s.sectionDesc}>
          Your name, username and pronouns appear on your profile. Email and phone are verified by your sign-in.
        </Text>

        <Card style={s.card}>
          {FIELDS.map((field, i) => {
            const isEditable = field.editable !== false;
            const isBirthday = field.key === 'birthday';
            const value = getValue(field.key);
            const row = (
              <View style={s.row}>
                <Feather name={field.icon} size={17} color={theme.accent} style={{ width: 24 }} />
                <Text style={s.rowLabel}>{field.label}</Text>
                {isEditable ? (
                  <TextInput
                    style={s.input}
                    value={value}
                    onChangeText={v => set(field.key as EditableKey, v)}
                    placeholder={field.placeholder}
                    placeholderTextColor={palette.mutedForeground}
                    keyboardType={field.keyboardType ?? 'default'}
                    autoCapitalize={field.autoCapitalize ?? 'sentences'}
                    maxLength={field.maxLength}
                    autoCorrect={false}
                    returnKeyType="done"
                    accessibilityLabel={field.label}
                  />
                ) : (
                  <Text style={[s.input, s.inputDisabled]} numberOfLines={1}>{value || field.placeholder}</Text>
                )}
                {!isEditable && <Feather name="lock" size={14} color={palette.mutedForeground} />}
              </View>
            );
            return (
              <React.Fragment key={field.key}>
                {isBirthday ? (
                  <Pressable
                    onPress={() => router.push('/help' as never)}
                    accessibilityRole="button"
                    accessibilityLabel="Birthday. Contact support to correct it"
                  >
                    {row}
                  </Pressable>
                ) : row}
                {error?.field === field.key && (
                  <Text style={s.fieldError} accessibilityLiveRegion="polite">{error.message}</Text>
                )}
                {i < FIELDS.length - 1 && <View style={s.divider} />}
              </React.Fragment>
            );
          })}
        </Card>

        {error && error.field === null && (
          <Text style={s.formError} accessibilityLiveRegion="polite">{error.message}</Text>
        )}

        {/* Note about locked fields */}
        <View style={s.note}>
          <Feather name="info" size={14} color={palette.mutedForeground} />
          <Text style={s.noteText}>
            Change your email or phone number with the options below. Your birthday is used at sign-up for age verification and isn’t stored — contact support in Help to correct it.
          </Text>
        </View>

        <Card style={[s.card, { marginTop: SPACING.md, paddingHorizontal: SPACING.md }]}>
          <ListRow icon="mail" title="Change email" subtitle="Verify a new email address" chevron onPress={() => router.push('/change-email' as never)} />
          <View style={s.divider} />
          <ListRow icon="phone" title="Change phone number" subtitle="Verify a new phone number" chevron onPress={() => router.push('/change-phone' as never)} />
        </Card>
      </ScrollView>

      {hasChanges && (
        <StickyBottomCTA label="Save Changes" loading={saving} disabled={saving} onPress={() => { void handleSave(); }} />
      )}
    </View>
  );
}

const makeStyles = (palette: ReturnType<typeof useColors>, theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  sectionDesc: { ...TYPE_SCALE.footnote, color: palette.mutedForeground, lineHeight: 18, marginBottom: SPACING.md },
  card: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 14, gap: 10 },
  rowLabel: { ...TYPE_SCALE.footnote, fontFamily: FONT.medium, color: palette.mutedForeground, width: 72 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginLeft: SPACING.md },
  input: { flex: 1, ...TYPE_SCALE.body, color: palette.foreground, textAlign: 'right', padding: 0 },
  inputDisabled: { color: palette.mutedForeground },
  note: { flexDirection: 'row', gap: 8, marginTop: SPACING.md, padding: SPACING.sm, backgroundColor: palette.card, borderRadius: RADII.card, borderWidth: 1, borderColor: palette.border, alignItems: 'flex-start' },
  noteText: { flex: 1, ...TYPE_SCALE.footnote, color: palette.mutedForeground, lineHeight: 17 },
  fieldError: { ...TYPE_SCALE.footnote, color: palette.destructive, paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  formError: { ...TYPE_SCALE.footnote, color: palette.destructive, marginTop: SPACING.sm },
});
