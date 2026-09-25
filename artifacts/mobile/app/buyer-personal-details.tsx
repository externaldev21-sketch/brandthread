import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { loadBuyerProfile, saveBuyerProfile, DEFAULT_BUYER_PROFILE, type BuyerProfileFields } from '@/lib/buyerProfile';
import { updateMyProfile, getMyProfile } from '@/services/socialService';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, StickyBottomCTA } from '@/components/ui';
import { hapticSuccess } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { FONT } from '@/lib/theme';

/** Fields stored in BuyerProfileFields — everything editable is persisted. */
type PersistedKey = keyof Omit<BuyerProfileFields, 'aiCreator' | 'avatarUri'>;

type FieldDef = {
  key: PersistedKey | 'email' | 'birthday';
  label: string;
  placeholder: string;
  icon: keyof typeof Feather.glyphMap;
  editable?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
};

// email and birthday are managed in Login methods and locked in the UI.
const FIELDS: FieldDef[] = [
  { key: 'name',     label: 'Name',      placeholder: 'Your name',         icon: 'user' },
  { key: 'username', label: 'Username',  placeholder: '@username',          icon: 'at-sign' },
  { key: 'email',    label: 'Email',     placeholder: 'your@email.com',     icon: 'mail',    keyboardType: 'email-address', editable: false },
  { key: 'phone',    label: 'Phone',     placeholder: 'Add phone number',   icon: 'phone',   keyboardType: 'phone-pad' },
  { key: 'birthday', label: 'Birthday',  placeholder: 'Set in Login methods', icon: 'calendar', editable: false },
  { key: 'pronouns', label: 'Pronouns',  placeholder: 'e.g. they/them',     icon: 'smile' },
];

/** Masks a real email address, e.g. "jordan@example.com" -> "••••@example.com". */
function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '';
  const [, domain] = email.split('@');
  return `••••@${domain}`;
}

export default function BuyerPersonalDetails() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = makeStyles(palette, theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const [fields, setFields] = useState<BuyerProfileFields>({ ...DEFAULT_BUYER_PROFILE });
  const [loaded, setLoaded] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // Seed from BOTH sources; social profile is authoritative for shared identity.
    Promise.all([loadBuyerProfile(), getMyProfile()]).then(([local, social]) => {
      setFields({
        ...local,
        name:     local.name || social.name,
        username: local.username || social.username || DEFAULT_BUYER_PROFILE.username,
        pronouns: local.pronouns || social.pronouns,
      });
      setLoaded(true);
    });
  }, []);

  function set(key: string, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
    setHasChanges(true);
  }

  function getValue(key: string): string {
    if (key === 'email') return maskEmail(user?.primaryEmailAddress?.emailAddress);
    if (key === 'birthday') return '';
    const val = (fields as unknown as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : '';
  }

  async function handleSave() {
    hapticSuccess();
    // Persist locally; only sync non-empty shared identity fields to the social
    // profile so saving an unrelated field (e.g. phone) never overwrites an
    // already-set name or username with an empty string.
    const socialPatch: Partial<{ name: string; username: string; pronouns: string }> = {};
    if (fields.name.trim()) socialPatch.name = fields.name;
    if (fields.username.trim()) socialPatch.username = fields.username;
    if (fields.pronouns.trim()) socialPatch.pronouns = fields.pronouns;
    await Promise.all([
      saveBuyerProfile(fields),
      Object.keys(socialPatch).length > 0 ? updateMyProfile(socialPatch) : Promise.resolve(),
    ]);
    router.back();
  }

  if (!loaded) return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;

  return (
    <View style={s.page}>
      <ScreenHeader title="Personal Details" />

      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + (hasChanges ? 120 : 40) }}>
        <Text style={s.sectionDesc}>
          Keep your details up to date. Email and birthday are managed by your sign-in provider.
        </Text>

        <Card style={s.card}>
          {FIELDS.map((field, i) => {
            const isEditable = field.editable !== false;
            return (
              <React.Fragment key={field.key}>
                <View style={s.row}>
                  <Feather name={field.icon} size={17} color={theme.accent} style={{ width: 24 }} />
                  <Text style={s.rowLabel}>{field.label}</Text>
                  <TextInput
                    style={[s.input, !isEditable && s.inputDisabled]}
                    value={getValue(field.key)}
                    onChangeText={v => isEditable && set(field.key, v)}
                    placeholder={field.placeholder}
                    placeholderTextColor={palette.mutedForeground}
                    editable={isEditable}
                    keyboardType={field.keyboardType ?? 'default'}
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                  {!isEditable && <Feather name="lock" size={14} color={palette.mutedForeground} />}
                </View>
                {i < FIELDS.length - 1 && <View style={s.divider} />}
              </React.Fragment>
            );
          })}
        </Card>

        {/* Note about locked fields */}
        <View style={s.note}>
          <Feather name="info" size={14} color={palette.mutedForeground} />
          <Text style={s.noteText}>
            Change your email in Login methods.
          </Text>
        </View>
      </ScrollView>

      {hasChanges && (
        <StickyBottomCTA label="Save Changes" onPress={() => { void handleSave(); }} />
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
});
