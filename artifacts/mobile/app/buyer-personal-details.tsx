import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { loadBuyerProfile, saveBuyerProfile, DEFAULT_BUYER_PROFILE, type BuyerProfileFields } from '@/lib/buyerProfile';
import { updateMyProfile, getMyProfile } from '@/services/socialService';

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

// email and birthday are Clerk-managed and locked in the UI.
const FIELDS: FieldDef[] = [
  { key: 'name',     label: 'Name',      placeholder: 'Your name',         icon: 'user' },
  { key: 'username', label: 'Username',  placeholder: '@username',          icon: 'at-sign' },
  { key: 'email',    label: 'Email',     placeholder: 'your@email.com',     icon: 'mail',    keyboardType: 'email-address', editable: false },
  { key: 'phone',    label: 'Phone',     placeholder: 'Add phone number',   icon: 'phone',   keyboardType: 'phone-pad' },
  { key: 'birthday', label: 'Birthday',  placeholder: 'Managed via Clerk',  icon: 'calendar', editable: false },
  { key: 'pronouns', label: 'Pronouns',  placeholder: 'e.g. they/them',     icon: 'smile' },
];

function Divider() {
  return <View style={{ height: 1, backgroundColor: BORDER, marginLeft: 16 }} />;
}

export default function BuyerPersonalDetails() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const s = makeStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
    if (key === 'email') return '••••@gmail.com';
    if (key === 'birthday') return '';
    const val = (fields as unknown as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : '';
  }

  async function handleSave() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

  if (!loaded) return <View style={{ flex: 1, backgroundColor: BG }} />;

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Personal Details</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 100 }}>
        <Text style={s.sectionDesc}>
          Keep your details up to date. Email and birthday are managed by your sign-in provider.
        </Text>

        <View style={s.card}>
          {FIELDS.map((field, i) => {
            const isEditable = field.editable !== false;
            return (
              <React.Fragment key={field.key}>
                <View style={s.row}>
                  <Feather name={field.icon} size={17} color={PURPLE} style={{ width: 24 }} />
                  <Text style={s.rowLabel}>{field.label}</Text>
                  <TextInput
                    style={[s.input, !isEditable && s.inputDisabled]}
                    value={getValue(field.key)}
                    onChangeText={v => isEditable && set(field.key, v)}
                    placeholder={field.placeholder}
                    placeholderTextColor={SUBTLE}
                    editable={isEditable}
                    keyboardType={field.keyboardType ?? 'default'}
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                  {!isEditable && <Feather name="lock" size={14} color={SUBTLE} />}
                </View>
                {i < FIELDS.length - 1 && <Divider />}
              </React.Fragment>
            );
          })}
        </View>

        {/* Note about locked fields */}
        <View style={s.note}>
          <Feather name="info" size={14} color={MUTED} />
          <Text style={s.noteText}>
            Email and birthday are managed by Clerk, your sign-in provider. To change them, visit Clerk account settings.
          </Text>
        </View>
      </ScrollView>

      {hasChanges && (
        <View style={[s.saveBar, { paddingBottom: insets.bottom + SP.md }]}>
          <TouchableOpacity onPress={handleSave} activeOpacity={0.85} style={{ flex: 1 }}>
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.saveBtn}>
              <Text style={[s.saveBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Save Changes</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  sectionDesc: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18, marginBottom: SP.md },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 10 },
  rowLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, width: 72 },
  input: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: FG, textAlign: 'right', padding: 0 },
  inputDisabled: { color: MUTED },
  note: { flexDirection: 'row', gap: 8, marginTop: SP.md, padding: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'flex-start' },
  noteText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, lineHeight: 17 },
  saveBar: { paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  saveBtn: { height: 50, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: FONT.bold, fontSize: FS.base },
});
